import asyncio
import logging
import re
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

from ..core.event_bus import EventBus
from ..core.scenario import Scenario, validate_stance
from ..core.storage import runs_root, save_json_atomic
from ..core.types import (
    AgentState,
    CivicAgentState,
    DistrictSummary,
    GodViewInjectionEvent,
    NewsReaction,
    Opinion,
    OpinionChangedEvent,
    SimulationEndedEvent,
    SimulationStartedEvent,
    TownSummary,
    WeatherChangedEvent,
)
from ..core.wire import agent_state_to_wire, district_summary_to_wire
from ..simulation.recap import generate_recap
from ..simulation.round_manager import RoundManager
from ..tools.schemas import build_tools

logger = logging.getLogger(__name__)

# township/ — anchor for the default simulation-cache path so it doesn't depend
# on the process's current working directory.
PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CACHE_PATH = PROJECT_ROOT / "data" / "simulation_cache.json"


class SimulationOrchestrator:
    """Runs simulations across all towns in parallel."""

    def __init__(
        self,
        anthropic_client,
        event_bus: EventBus,
        scenario: Scenario,
    ):
        self.client = anthropic_client
        self.event_bus = event_bus
        self.scenario = scenario

        # All content comes from the scenario package
        self.town_data = scenario.towns
        self.agent_definitions = scenario.agents
        self._tool_registry = build_tools(scenario)

        # Runtime state
        self.agent_states: dict[str, list[AgentState]] = {}
        self.town_summaries: dict[str, TownSummary] = {}
        self.district_summary: DistrictSummary | None = None
        self.is_running = False
        self.current_round = 0
        self.total_rounds = scenario.total_rounds

        # Set by _finalize_run() after each completed simulation.
        self.last_recap: str | None = None
        self.last_run_dir: Path | None = None
        self._run_started_at: datetime | None = None

        # Initialize agent states
        self._init_agent_states()

        logger.info(
            f"Orchestrator initialized (scenario={scenario.id}): "
            f"{sum(len(v) for v in self.agent_definitions.values())} agents "
            f"across {len(self.agent_definitions)} towns"
        )

    def _tools(self, names: list[str]) -> list[dict]:
        return [self._tool_registry[n] for n in names if n in self._tool_registry]

    def _init_agent_states(self):
        """Initialize AgentState objects from definitions."""
        self.agent_states = {}
        for town, definitions in self.agent_definitions.items():
            states = []
            for defn in definitions:
                # Generate agent_id from name slug
                agent_id = defn.name.lower().replace(" ", "-").replace(".", "")
                town_info = self.town_data.get(town, {})
                landmarks = town_info.get("landmarks", [])
                initial_location = landmarks[0]["name"] if landmarks else "Town Center"

                state = AgentState(
                    agent_id=agent_id,
                    definition=defn,
                    current_location=initial_location,
                )
                states.append(state)
            self.agent_states[town] = states

    def get_all_agent_states(self) -> dict[str, list[AgentState]]:
        """Return all agent states grouped by town."""
        return self.agent_states

    def get_agent_state(self, agent_id: str) -> AgentState | None:
        """Find an agent state by ID across all towns."""
        for town_agents in self.agent_states.values():
            for agent in town_agents:
                if agent.agent_id == agent_id:
                    return agent
        return None

    async def _run_cross_town_gossip(self, round_num: int = 3):
        """Run cross-town gossip conversations between agents from different towns."""
        logger.info(f"Running cross-town gossip round (round={round_num})")
        rm = RoundManager(
            anthropic_client=self.client,
            event_bus=self.event_bus,
            scenario=self.scenario,
        )
        cross_pairs = rm._create_cross_town_pairs(self.agent_states)
        tasks = []
        for agent_a, agent_b, connection_story in cross_pairs:
            tasks.append(
                rm.run_cross_town_conversation(agent_a, agent_b, connection_story, round_num=round_num)
            )
        results = await asyncio.gather(*tasks, return_exceptions=True)
        successful = sum(1 for r in results if not isinstance(r, Exception))
        logger.info(f"Cross-town gossip complete: {successful}/{len(tasks)} conversations succeeded")

    async def run_full_simulation(self, num_rounds: int | None = None) -> DistrictSummary:
        """Run all towns in parallel, compute district summary."""
        if num_rounds is None:
            num_rounds = self.scenario.total_rounds
        num_rounds = min(num_rounds, self.scenario.total_rounds)
        self.is_running = True
        self.current_round = 0
        self.total_rounds = num_rounds
        self._run_started_at = datetime.now(UTC)
        logger.info(f"Starting full simulation: {num_rounds} rounds across {len(self.agent_states)} towns")

        try:
            # ── Announce the simulation start with the agent roster ──
            agent_roster: list[dict] = []
            for town_agents in self.agent_states.values():
                for agent in town_agents:
                    try:
                        agent_roster.append(agent_state_to_wire(agent, self.scenario))
                    except Exception as e:
                        logger.warning("roster wire failed for %s: %s", agent.agent_id, e)
                        # Still append a minimal fallback so the agent renders.
                        agent_roster.append({
                            "id": agent.agent_id,
                            "name": agent.definition.name,
                            "town": agent.definition.town,
                            "occupation": agent.definition.occupation,
                            "opinion": None,
                            "location": agent.current_location,
                            "current_activity": "idle",
                        })
            try:
                await self.event_bus.publish(SimulationStartedEvent(
                    agents=agent_roster,
                    towns=list(self.agent_states.keys()),
                ))
            except Exception as e:  # pragma: no cover — defensive
                logger.warning(f"SimulationStartedEvent publish failed: {e}")

            # Pre-scripted weather across the cycle (one entry per round),
            # straight from the scenario manifest.
            weather_schedule: list[str] = list(self.scenario.config.weather_schedule)

            async def _emit_weather(idx: int) -> None:
                if idx < 0 or idx >= len(weather_schedule):
                    return
                try:
                    await self.event_bus.publish(WeatherChangedEvent(
                        weather=weather_schedule[idx],
                        town=None,  # district-wide
                    ))
                except Exception as e:  # pragma: no cover
                    logger.warning(f"WeatherChangedEvent publish failed: {e}")

            # Kick off the round-0 weather before the towns start. The towns
            # themselves don't know about weather; we drive it from here.
            await _emit_weather(0)

            # Run all towns in parallel
            tasks = []
            for town in self.agent_states:
                tasks.append(self._run_town_with_tracking(town, num_rounds))

            # Background helper: emit subsequent weather changes + interleave
            # cross-town gossip at rounds 2 and 3. We can't reach inside each
            # parallel town run, so we schedule these on a rough timeline.
            async def _atmosphere_and_cross_town():
                # Stagger the weather updates a little so they ripple in during the
                # simulation rather than all at once.
                for idx in range(1, len(weather_schedule)):
                    await asyncio.sleep(2.0)
                    await _emit_weather(idx)
                # Cross-town pairs at the scenario's gossip rounds
                for gossip_round in self.scenario.config.gossip_rounds:
                    try:
                        await self._run_cross_town_gossip(round_num=gossip_round)
                    except Exception as e:
                        logger.error(
                            f"Cross-town gossip (round {gossip_round}) failed: {e}"
                        )

            atmosphere_task = asyncio.create_task(_atmosphere_and_cross_town())

            town_results = await asyncio.gather(*tasks, return_exceptions=True)

            # Ensure atmospheric task has a chance to finish
            try:
                await asyncio.wait_for(atmosphere_task, timeout=60.0)
            except TimeoutError:
                logger.warning("Atmosphere task didn't finish within timeout")
            except Exception as e:  # pragma: no cover
                logger.warning(f"Atmosphere task error: {e}")

            # Collect results
            for town, result in zip(self.agent_states.keys(), town_results, strict=True):
                if isinstance(result, Exception):
                    logger.error(f"Town {town} simulation failed: {result}")
                    # Create empty summary for failed town
                    self.town_summaries[town] = TownSummary(
                        town=town,
                        opinion_distribution={
                            self.scenario.undecided_id: len(self.agent_states.get(town, []))
                        },
                        top_issues=[],
                        agent_summaries=[],
                        total_conversations=0,
                        rounds_completed=0,
                    )
                else:
                    self.town_summaries[town] = result

            # Compute district summary
            self.district_summary = self._compute_district_summary(self.town_summaries)

            # Emit the past-tense simulation_ended event with wire-format
            # district summary. The legacy `SimulationCompleteEvent` publish
            # was redundant — the frontend already ignored it — so it's gone.
            try:
                await self.event_bus.publish(SimulationEndedEvent(
                    summary=district_summary_to_wire(self.district_summary, self.scenario),
                ))
            except Exception as e:  # pragma: no cover
                logger.warning(f"SimulationEndedEvent publish failed: {e}")

            # Save cache
            await self.save_cache()

            # Persist the run + narrative recap. Best-effort by contract:
            # a broken disk or recap bug must never fail a finished sim.
            await self._finalize_run()

            return self.district_summary

        finally:
            self.is_running = False

    async def _run_town_with_tracking(self, town: str, num_rounds: int) -> TownSummary:
        """Wrapper to run a single town's simulation with the RoundManager."""
        rm = RoundManager(
            anthropic_client=self.client,
            event_bus=self.event_bus,
            scenario=self.scenario,
        )
        return await rm.run_town_simulation(
            town=town,
            agent_states=self.agent_states[town],
            num_rounds=num_rounds,
        )

    async def run_single_town(self, town: str, num_rounds: int | None = None) -> TownSummary:
        """Run simulation for just one town."""
        if town not in self.agent_states:
            raise ValueError(f"Unknown town: {town}. Available: {list(self.agent_states.keys())}")

        if num_rounds is None:
            num_rounds = self.scenario.total_rounds
        num_rounds = min(num_rounds, self.scenario.total_rounds)
        self.is_running = True
        self.total_rounds = num_rounds
        self._run_started_at = datetime.now(UTC)
        try:
            # Announce the run with this town's roster (mirrors the full-run
            # path) so the frontend receives agent colors/locations over WS.
            agent_roster: list[dict] = []
            for agent in self.agent_states[town]:
                try:
                    agent_roster.append(agent_state_to_wire(agent, self.scenario))
                except Exception as e:
                    logger.warning("roster wire failed for %s: %s", agent.agent_id, e)
                    agent_roster.append({
                        "id": agent.agent_id,
                        "name": agent.definition.name,
                        "town": agent.definition.town,
                        "occupation": agent.definition.occupation,
                        "opinion": None,
                        "location": agent.current_location,
                        "current_activity": "idle",
                    })
            try:
                await self.event_bus.publish(SimulationStartedEvent(
                    agents=agent_roster,
                    towns=[town],
                ))
            except Exception as e:  # pragma: no cover — defensive
                logger.warning(f"SimulationStartedEvent publish failed: {e}")

            result = await self._run_town_with_tracking(town, num_rounds)
            self.town_summaries[town] = result

            # Recompute district summary if we have results
            if self.town_summaries:
                self.district_summary = self._compute_district_summary(self.town_summaries)

            try:
                await self.event_bus.publish(SimulationEndedEvent(
                    summary=district_summary_to_wire(self.district_summary, self.scenario),
                ))
            except Exception as e:  # pragma: no cover — defensive
                logger.warning(f"SimulationEndedEvent publish failed: {e}")

            await self._finalize_run()

            return result
        finally:
            self.is_running = False

    def _compute_district_summary(self, town_summaries: dict[str, TownSummary]) -> DistrictSummary:
        """Aggregate town results into district-level insights."""
        # Aggregate opinion distribution
        total_opinions: dict[str, int] = Counter()
        all_issues_by_town: dict[str, dict[str, float]] = {}
        total_agents = 0
        total_conversations = 0
        total_failed_agents = 0

        for town, summary in town_summaries.items():
            for candidate, count in summary.opinion_distribution.items():
                total_opinions[candidate] += count
                total_agents += count
            total_conversations += summary.total_conversations
            total_failed_agents += summary.failed_agents

            # Track issues per town for fault line analysis
            town_issues = {}
            for issue_entry in summary.top_issues:
                issue_name = issue_entry.get("issue", "")
                importance = issue_entry.get("importance", 0.0)
                if issue_name:
                    town_issues[issue_name] = importance
            all_issues_by_town[town] = town_issues

        # Prediction: percentage per stance (seeded so every roster stance
        # appears even at zero)
        prediction = {stance: 0.0 for stance in self.scenario.valid_stance_ids}
        if total_agents > 0:
            for candidate, count in total_opinions.items():
                prediction[candidate] = round((count / total_agents) * 100, 1)
        else:
            prediction[self.scenario.undecided_id] = 100

        # Consensus zones: issues mentioned by 70%+ of agents across all towns
        all_issue_counts: Counter = Counter()
        for summary in town_summaries.values():
            for issue_entry in summary.top_issues:
                issue_name = issue_entry.get("issue", "")
                importance = issue_entry.get("importance", 0.0)
                if issue_name and importance >= 0.3:
                    all_issue_counts[issue_name] += 1

        num_towns = len(town_summaries) or 1
        consensus_zones = [
            issue for issue, town_count in all_issue_counts.items()
            if town_count / num_towns >= 0.7
        ]

        # Fault lines: issues with highest variance between towns
        fault_lines = []
        all_issues_union = set()
        for issues in all_issues_by_town.values():
            all_issues_union.update(issues.keys())

        issue_variance = {}
        for issue in all_issues_union:
            values = [all_issues_by_town[t].get(issue, 0.0) for t in all_issues_by_town]
            if len(values) >= 2:
                mean = sum(values) / len(values)
                variance = sum((v - mean) ** 2 for v in values) / len(values)
                issue_variance[issue] = variance

        # Top 5 most divisive issues
        fault_lines = sorted(issue_variance, key=issue_variance.get, reverse=True)[:5]

        usage = self.client.get_usage_report()

        return DistrictSummary(
            by_town=town_summaries,
            consensus_zones=consensus_zones,
            fault_lines=fault_lines,
            prediction=prediction,
            total_agents=total_agents,
            total_conversations=total_conversations,
            total_cost=usage["total_cost"],
            failed_agents=total_failed_agents,
        )

    def _serialized_events(self) -> list[dict]:
        """The event log as plain dicts (replay-cache / run-persistence shape)."""
        serialized = []
        for event in self.event_bus.get_event_log():
            if hasattr(event, "model_dump"):
                serialized.append(event.model_dump())
            else:
                serialized.append({"type": "unknown", "data": str(event)})
        return serialized

    async def save_cache(self, filepath: str | None = None):
        """Save event log for replay.

        Defaults to <project_root>/data/simulation_cache.json so the cache lands
        in the same place regardless of the process working directory. Writes
        atomically via storage.save_json_atomic (temp file + os.replace).
        """
        serialized = self._serialized_events()
        cache_data = {
            "events": serialized,
            "district_summary": self.district_summary.model_dump() if self.district_summary else None,
            "usage": self.client.get_usage_report(),
        }

        cache_path = Path(filepath) if filepath else DEFAULT_CACHE_PATH
        save_json_atomic(cache_path, cache_data)
        logger.info(f"Saved simulation cache to {cache_path} ({len(serialized)} events)")

    # ── Run persistence + narrative recap ─────────────────────────

    async def _finalize_run(self) -> None:
        """Generate the narrative recap and persist the run under runs/.

        Strictly best-effort: any failure here is logged and swallowed so a
        finished simulation is never failed by its own paperwork.
        """
        recap: str | None = None
        try:
            if self.district_summary is not None:
                recap = await generate_recap(
                    self.scenario,
                    self.district_summary,
                    self.event_bus.get_event_log(),
                    self.client,
                )
                self.last_recap = recap
        except Exception as e:
            logger.error(f"Recap generation failed: {e}")

        try:
            self.last_run_dir = self._persist_run(recap)
            logger.info(f"Persisted run to {self.last_run_dir}")
        except Exception as e:
            logger.error(f"Run persistence failed: {e}")

    def _persist_run(self, recap: str | None) -> Path:
        """Write runs/<YYYYMMDD-HHMMSS>-<scenario-id>/{events,summary,recap}."""
        started = self._run_started_at or datetime.now(UTC)
        ended = datetime.now(UTC)
        slug = re.sub(r"[^a-z0-9-]+", "-", self.scenario.id.lower()).strip("-") or "scenario"
        run_id = f"{started.strftime('%Y%m%d-%H%M%S')}-{slug}"

        run_dir = runs_root() / run_id
        suffix = 2
        while run_dir.exists():  # two runs in the same second (tests, mock)
            run_dir = runs_root() / f"{run_id}-{suffix}"
            suffix += 1
        run_dir.mkdir(parents=True, exist_ok=True)

        serialized = self._serialized_events()
        # events.json shares the replay-cache shape ({"events": [...]}) so a
        # run can be replayed or dropped into the demo player unchanged.
        save_json_atomic(run_dir / "events.json", {"events": serialized}, minify=True)

        district_wire = (
            district_summary_to_wire(self.district_summary, self.scenario)
            if self.district_summary
            else None
        )
        summary = {
            "run_id": run_dir.name,
            "scenario_id": self.scenario.id,
            "scenario_title": self.scenario.title,
            "started_at": started.isoformat(),
            "ended_at": ended.isoformat(),
            "district_summary": district_wire,
            "usage": self.client.get_usage_report(),
            "counts": {
                "events": len(serialized),
                "towns": len(self.town_summaries),
                "agents": self.district_summary.total_agents if self.district_summary else 0,
                "conversations": (
                    self.district_summary.total_conversations if self.district_summary else 0
                ),
            },
            "recap_markdown": recap,
        }
        save_json_atomic(run_dir / "summary.json", summary)

        if recap:
            (run_dir / "recap.md").write_text(recap, encoding="utf-8")

        return run_dir

    async def inject_god_view(self, description: str) -> list[NewsReaction]:
        """Inject a variable into all agents and collect reactions."""
        logger.info(f"God's View injection: {description}")

        await self.event_bus.publish(GodViewInjectionEvent(
            variable="god_view",
            description=description,
        ))

        reactions = []
        tasks = []

        all_agents = []
        for town_agents in self.agent_states.values():
            all_agents.extend(town_agents)

        for agent in all_agents:
            tasks.append(self._god_view_react(agent, description))

        results = await asyncio.gather(*tasks, return_exceptions=True)

        for result in results:
            if isinstance(result, NewsReaction):
                reactions.append(result)
            elif isinstance(result, Exception):
                logger.error(f"God's view reaction error: {result}")

        return reactions

    async def _god_view_react(self, agent: AgentState, description: str) -> NewsReaction:
        """Get a single agent's reaction to a God's View injection."""
        system_prompt = self._build_god_view_prompt(agent)

        messages = [
            {
                "role": "user",
                "content": (
                    f"BREAKING DEVELOPMENT affecting {self.scenario.title}:\n\n"
                    f"{description}\n\n"
                    f"React to this development. How does it affect you personally? "
                    f"Does it change how you're thinking about your decision? "
                    f"Use the ReactToNews tool."
                ),
            }
        ]

        result = await self.client.call_agent(
            system_prompt=system_prompt,
            messages=messages,
            tools=self._tools(["ReactToNews"]),
            max_tokens=400,
            model=agent.definition.model,
        )

        if result.get("stop_reason") == "error":
            logger.error(
                "God's view ReactToNews errored for %s: %s",
                agent.agent_id, result.get("error"),
            )
            agent.state = CivicAgentState.ERROR
            return NewsReaction(
                agent_id=agent.agent_id,
                agent_name=agent.definition.name,
                town=agent.definition.town,
                headline=description,
                event=description,
                emotional_response="indifferent",
                impact_on_vote="no_effect",
                reasoning="(no reaction — agent unavailable)",
            )

        emotional = "indifferent"
        impact = "no_effect"
        reasoning = "No strong reaction."

        if result["tool_use"] and result["tool_use"]["name"] == "ReactToNews":
            tool_input = result["tool_use"]["input"]
            emotional = tool_input.get("emotional_response", "indifferent")
            impact = tool_input.get("impact_on_vote", "no_effect")
            reasoning = tool_input.get("reasoning", "No strong reaction.")

        agent.add_memory(f"God's View event: {description[:100]}. Reaction: {emotional}, impact: {impact}")

        # If the development actually moved the agent, re-evaluate their opinion
        # so opinion_shifts populates and live ripples fire on the frontend.
        if impact != "no_effect":
            await self._god_view_form_opinion(agent, description, impact, reasoning)

        return NewsReaction(
            agent_id=agent.agent_id,
            agent_name=agent.definition.name,
            town=agent.definition.town,
            headline=description,
            event=description,
            emotional_response=emotional,
            impact_on_vote=impact,
            reasoning=reasoning,
        )

    async def _god_view_form_opinion(
        self, agent: AgentState, description: str, impact: str, reaction_reasoning: str
    ) -> None:
        """Re-run FormOpinion after a God's View development that moved an agent.

        Appends a new Opinion and publishes an OpinionChangedEvent so both the
        before/after opinion_shifts (gods_view route) and the live frontend
        ripple are driven by a real model decision.
        """
        prev = agent.current_opinion
        system_prompt = self._build_god_view_prompt(agent)
        messages = [
            {
                "role": "user",
                "content": (
                    f"BREAKING DEVELOPMENT affecting {self.scenario.title}:\n\n{description}\n\n"
                    f"Your gut reaction: {reaction_reasoning}\n\n"
                    f"Now reconsider your stance in light of this. Which option are you "
                    f"leaning toward, and how confident are you? Use the FormOpinion tool."
                ),
            }
        ]

        result = await self.client.call_agent(
            system_prompt=system_prompt,
            messages=messages,
            tools=self._tools(["FormOpinion"]),
            max_tokens=700,
            model=agent.definition.model,
        )

        if result.get("stop_reason") == "error":
            logger.error(
                "God's view FormOpinion errored for %s: %s",
                agent.agent_id, result.get("error"),
            )
            agent.state = CivicAgentState.ERROR
            return

        if not (result["tool_use"] and result["tool_use"]["name"] == "FormOpinion"):
            return

        tool_input = result["tool_use"]["input"]
        new_opinion = Opinion(
            candidate=validate_stance(
                tool_input.get(
                    "candidate",
                    prev.candidate if prev else self.scenario.undecided_id,
                ),
                self.scenario,
            ),
            confidence=tool_input.get("confidence", prev.confidence if prev else 50),
            reasoning=tool_input.get("reasoning", "Reconsidered after the development."),
            top_issues=tool_input.get(
                "top_issues",
                list(prev.top_issues) if prev else agent.definition.top_concerns[:3],
            ),
            dealbreaker=tool_input.get("dealbreaker"),
            round_number=((prev.round_number if prev else 0) or 0) + 1,
        )
        agent.opinions.append(new_opinion)
        agent.add_memory(
            f"God's View shifted my view: now leaning {new_opinion.candidate} "
            f"(confidence: {new_opinion.confidence}%)."
        )

        try:
            await self.event_bus.publish(OpinionChangedEvent(
                agent_id=agent.agent_id,
                agent_name=agent.definition.name,
                town=agent.definition.town,
                old_opinion=prev,
                new_opinion=new_opinion,
            ))
        except Exception as e:  # pragma: no cover — defensive
            logger.warning(f"God's view OpinionChangedEvent publish failed: {e}")

    def _build_god_view_prompt(self, agent: AgentState) -> str:
        """Build system prompt for God's View reactions."""
        parts = [agent.definition.system_prompt]

        parts.append("\n\n--- CONTEXT ---\n" + self.scenario.context_short())

        opinion = agent.current_opinion
        if opinion:
            parts.append(
                f"\n\n--- YOUR CURRENT STANCE ---\n"
                f"Leaning: {opinion.candidate} (confidence: {opinion.confidence}%)\n"
                f"Reasoning: {opinion.reasoning}"
            )

        recent = agent.get_recent_memories(5)
        if recent:
            parts.append(
                "\n\n--- RECENT MEMORIES ---\n"
                + "\n".join(f"- {m}" for m in recent)
            )

        parts.append(
            "\n\n--- INSTRUCTIONS ---\n"
            "Stay in character. React authentically based on your life circumstances. "
            "Be specific about how this affects you, your family, and your community."
        )

        return "\n".join(parts)
