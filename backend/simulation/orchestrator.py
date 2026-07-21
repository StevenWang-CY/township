import asyncio
import logging
import os
import re
import shutil
import tempfile
import threading
import uuid
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

from ..core.agent_loader import agent_id_from_name
from ..core.artifacts import artifact_version_fields
from ..core.event_bus import EventBus
from ..core.scenario import CANONICAL_CORE_NOTICE, Scenario, validate_stance
from ..core.storage import PROJECT_ROOT as APPLICATION_ROOT
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
    is_private_event,
)
from ..core.wire import agent_state_to_wire, district_summary_to_wire
from ..simulation.recap import generate_recap
from ..simulation.round_manager import RoundManager
from ..tools.schemas import build_tools

logger = logging.getLogger(__name__)

# In a source checkout, core.storage resolves this to the repository. In an
# installed wheel, it deliberately resolves to the launch directory instead
# of a read-only site-packages parent.
DEFAULT_CACHE_PATH = APPLICATION_ROOT / "data" / "simulation_cache.json"

_USAGE_COUNTER_KEYS = (
    "total_input_tokens",
    "total_output_tokens",
    "total_cache_read_tokens",
    "total_cache_write_tokens",
    "total_tokens",
    "total_cost",
    "total_calls",
)


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
        self._run_usage_baseline: dict = {}
        self._last_run_events: list = []
        self._recording_token: str | None = None

        # Admission is reserved synchronously, before a background task is
        # scheduled. This closes the check-then-schedule race between live
        # simulations and replays.
        self._operation_lock = threading.Lock()
        self._active_operation: tuple[str, str] | None = None

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
                agent_id = agent_id_from_name(defn.name)
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

    @property
    def active_operation(self) -> str | None:
        """The admitted shared-state operation kind, if any."""
        with self._operation_lock:
            return self._active_operation[1] if self._active_operation else None

    def try_reserve_operation(self, kind: str) -> str | None:
        """Atomically reserve the single shared-state mutation slot."""
        if kind not in {"simulation", "replay", "god_view"}:
            raise ValueError(f"Unknown operation kind: {kind}")
        with self._operation_lock:
            if self._active_operation is not None or self.is_running:
                return None
            token = uuid.uuid4().hex
            self._active_operation = (token, kind)
            if kind == "simulation":
                self.is_running = True
            return token

    def release_operation(self, token: str) -> None:
        """Release a matching reservation; stale/double releases are harmless."""
        with self._operation_lock:
            if self._active_operation is None or self._active_operation[0] != token:
                return
            _, kind = self._active_operation
            self._active_operation = None
            if kind == "simulation":
                self.is_running = False

    def _claim_simulation_operation(self, token: str | None) -> str:
        if token is None:
            token = self.try_reserve_operation("simulation")
            if token is None:
                raise RuntimeError("Another simulation or replay is already running")
            return token
        with self._operation_lock:
            if self._active_operation != (token, "simulation"):
                raise RuntimeError("Simulation operation reservation is missing or stale")
        return token

    def _claim_god_view_operation(self, token: str | None) -> str:
        if token is None:
            token = self.try_reserve_operation("god_view")
            if token is None:
                raise RuntimeError("Another simulation, replay, or injection is already running")
            return token
        with self._operation_lock:
            if self._active_operation != (token, "god_view"):
                raise RuntimeError("God's View operation reservation is missing or stale")
        return token

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

    def _resolve_round_specs(self, num_rounds: int | None):
        plan = self.scenario.config.round_plan
        resolved = len(plan) if num_rounds is None else min(num_rounds, len(plan))
        if resolved < 1:
            raise ValueError("num_rounds must be at least 1")
        return plan[:resolved]

    def _begin_run(self, total_rounds: int) -> None:
        """Reset every run-owned mutable value and begin a complete capture."""
        self._init_agent_states()
        self.town_summaries = {}
        self.district_summary = None
        self.current_round = 0
        self.total_rounds = total_rounds
        self._run_started_at = datetime.now(UTC)
        self._run_usage_baseline = dict(self.client.get_usage_report())
        self._last_run_events = []
        if self._recording_token is not None:  # pragma: no cover - defensive
            self.event_bus.stop_recording(self._recording_token)
        self._recording_token = self.event_bus.start_recording()

    def _stop_run_recording(self) -> list:
        if self._recording_token is None:
            return list(self._last_run_events)
        token = self._recording_token
        self._recording_token = None
        self._last_run_events = self.event_bus.stop_recording(token)
        return list(self._last_run_events)

    def _run_usage_report(self) -> dict:
        """Return this run's usage delta while retaining provider lifetime totals."""
        current = dict(self.client.get_usage_report())
        baseline = self._run_usage_baseline
        report = {
            "provider": current.get("provider", baseline.get("provider", "unknown")),
            "default_model": current.get("default_model", baseline.get("default_model", "unknown")),
        }
        token_keys = _USAGE_COUNTER_KEYS[:4]
        for key in token_keys:
            report[key] = max(
                0,
                int(current.get(key, 0) or 0) - int(baseline.get(key, 0) or 0),
            )
        report["total_tokens"] = sum(report[key] for key in token_keys)
        report["total_cost"] = round(
            max(
                0.0,
                float(current.get("total_cost", 0.0) or 0.0)
                - float(baseline.get("total_cost", 0.0) or 0.0),
            ),
            4,
        )
        report["total_calls"] = max(
            0,
            int(current.get("total_calls", 0) or 0) - int(baseline.get("total_calls", 0) or 0),
        )
        return report

    def _responsible_use_snapshot(self) -> dict[str, str]:
        spec = getattr(self.scenario, "responsible_use", None)
        if spec is None:
            spec = getattr(self.scenario.config, "responsible_use", None)
        if hasattr(spec, "model_dump"):
            raw = spec.model_dump()
        elif isinstance(spec, dict):
            raw = spec
        else:
            raw = {}
        return {
            "core_notice": str(raw.get("core_notice") or CANONICAL_CORE_NOTICE),
            "residents_notice": str(raw.get("residents_notice") or ""),
            "subjects_notice": str(raw.get("subjects_notice") or ""),
            "outputs_notice": str(raw.get("outputs_notice") or ""),
        }

    def _add_responsible_use_notice(self, recap: str) -> str:
        notice = self._responsible_use_snapshot()["core_notice"]
        block = f"> **Responsible-use notice:** {notice}"
        if not recap or block in recap:
            return recap
        lines = recap.splitlines()
        # Keep the generated newspaper headline as line one so recap_headline()
        # and run listings continue to expose a useful title.
        if lines and lines[0].startswith("# "):
            lines[1:1] = ["", block]
            if len(lines) == 3 or lines[3] != "":
                lines.insert(3, "")
            return "\n".join(lines)
        return f"{block}\n\n{recap}"

    def _agent_roster(self, towns: list[str]) -> list[dict]:
        roster: list[dict] = []
        for town in towns:
            for agent in self.agent_states[town]:
                try:
                    roster.append(agent_state_to_wire(agent, self.scenario))
                except Exception as e:
                    logger.warning("roster wire failed for %s: %s", agent.agent_id, e)
                    roster.append(
                        {
                            "id": agent.agent_id,
                            "name": agent.definition.name,
                            "town": agent.definition.town,
                            "occupation": agent.definition.occupation,
                            "opinion": None,
                            "location": agent.current_location,
                            "current_activity": "idle",
                        }
                    )
        return roster

    async def _emit_weather(self, schedule_index: int) -> None:
        schedule = self.scenario.config.weather_schedule
        if schedule_index >= len(schedule):
            return
        await self.event_bus.publish(
            WeatherChangedEvent(
                weather=schedule[schedule_index],
                town=None,
            )
        )

    async def _run_cross_town_gossip(
        self,
        round_num: int = 3,
        eligible_towns: list[str] | None = None,
    ):
        """Run configured cross-town conversations at an outer-round barrier."""
        logger.info("Running cross-town gossip round (round=%s)", round_num)
        rm = RoundManager(
            anthropic_client=self.client,
            event_bus=self.event_bus,
            scenario=self.scenario,
        )
        included = set(self.agent_states if eligible_towns is None else eligible_towns)
        eligible_states = {
            town: [agent for agent in agents if agent.state != CivicAgentState.ERROR]
            for town, agents in self.agent_states.items()
            if town in included
        }
        cross_pairs = rm._create_cross_town_pairs(eligible_states)
        tasks = [
            rm.run_cross_town_conversation(
                agent_a,
                agent_b,
                connection_story,
                round_num=round_num,
            )
            for agent_a, agent_b, connection_story in cross_pairs
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        successful = sum(1 for result in results if not isinstance(result, Exception))
        logger.info(
            "Cross-town gossip complete: %s/%s conversations succeeded",
            successful,
            len(tasks),
        )

    async def _run_coordinated_rounds(
        self,
        towns: list[str],
        specs: list,
        *,
        include_gossip: bool,
    ) -> dict[str, TownSummary]:
        managers = {
            town: RoundManager(
                anthropic_client=self.client,
                event_bus=self.event_bus,
                scenario=self.scenario,
            )
            for town in towns
        }
        conversations = {town: 0 for town in towns}
        completed = {town: 0 for town in towns}
        failed: set[str] = set()

        for schedule_index, spec in enumerate(specs):
            self.current_round = spec.round
            await self._emit_weather(schedule_index)

            active_towns = [town for town in towns if town not in failed]
            results = await asyncio.gather(
                *[
                    managers[town].run_town_round(
                        town=town,
                        agent_states=self.agent_states[town],
                        spec=spec,
                        total_rounds=len(specs),
                        total_conversations=conversations[town],
                    )
                    for town in active_towns
                ],
                return_exceptions=True,
            )
            for town, result in zip(active_towns, results, strict=True):
                if isinstance(result, Exception):
                    logger.error(
                        "Town %s failed during round %s: %s",
                        town,
                        spec.round,
                        result,
                    )
                    failed.add(town)
                    for agent in self.agent_states[town]:
                        agent.state = CivicAgentState.ERROR
                else:
                    conversations[town] = result
                    completed[town] += 1

            # Gossip is intentionally after the town barrier: no town can be
            # two rounds ahead, and memories arrive before the next round.
            if (
                include_gossip
                and len(towns) > 1
                and spec.round in self.scenario.config.gossip_rounds
            ):
                try:
                    await self._run_cross_town_gossip(
                        round_num=spec.round,
                        eligible_towns=[town for town in towns if town not in failed],
                    )
                except Exception as e:  # pragma: no cover - defensive
                    logger.error("Cross-town gossip round %s failed: %s", spec.round, e)

        return {
            town: managers[town].build_town_summary(
                town,
                self.agent_states[town],
                conversations[town],
                completed[town],
            )
            for town in towns
        }

    async def _publish_run_started(self, towns: list[str]) -> None:
        await self.event_bus.publish(
            SimulationStartedEvent(
                agents=self._agent_roster(towns),
                towns=towns,
            )
        )

    async def _publish_run_ended(self) -> None:
        await self.event_bus.publish(
            SimulationEndedEvent(
                summary=district_summary_to_wire(self.district_summary, self.scenario),
            )
        )

    async def run_full_simulation(
        self,
        num_rounds: int | None = None,
        *,
        _operation_token: str | None = None,
    ) -> DistrictSummary:
        """Run all towns in deterministic outer-round coordination."""
        operation_token = self._claim_simulation_operation(_operation_token)
        try:
            specs = self._resolve_round_specs(num_rounds)
            self._begin_run(len(specs))
            towns = list(self.agent_states)
            logger.info(
                "Starting full simulation: %s rounds across %s towns",
                len(specs),
                len(towns),
            )
            await self._publish_run_started(towns)
            self.town_summaries = await self._run_coordinated_rounds(
                towns,
                specs,
                include_gossip=True,
            )
            self.district_summary = self._compute_district_summary(self.town_summaries)
            await self._publish_run_ended()
            events = self._stop_run_recording()
            await self._finalize_run(events)
            return self.district_summary
        finally:
            self._stop_run_recording()
            self.release_operation(operation_token)

    async def _run_town_with_tracking(self, town: str, num_rounds: int) -> TownSummary:
        """Compatibility wrapper for direct single-town engine callers."""
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

    async def run_single_town(
        self,
        town: str,
        num_rounds: int | None = None,
        *,
        _operation_token: str | None = None,
    ) -> TownSummary:
        """Run a freshly initialized simulation for one town."""
        if town not in self.agent_definitions:
            raise ValueError(f"Unknown town: {town}. Available: {list(self.agent_definitions)}")
        operation_token = self._claim_simulation_operation(_operation_token)
        try:
            specs = self._resolve_round_specs(num_rounds)
            self._begin_run(len(specs))
            await self._publish_run_started([town])
            self.town_summaries = await self._run_coordinated_rounds(
                [town],
                specs,
                include_gossip=False,
            )
            result = self.town_summaries[town]
            self.district_summary = self._compute_district_summary(self.town_summaries)
            await self._publish_run_ended()
            events = self._stop_run_recording()
            await self._finalize_run(events)
            return result
        finally:
            self._stop_run_recording()
            self.release_operation(operation_token)

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
            issue for issue, town_count in all_issue_counts.items() if town_count / num_towns >= 0.7
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

        usage = self._run_usage_report()

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

    def _serialized_events(self, events: list | None = None) -> list[dict]:
        """Serialize one explicit run capture (never the global diagnostic tail)."""
        serialized = []
        source = self._last_run_events if events is None else events
        for event in source:
            if is_private_event(event):
                continue
            if hasattr(event, "model_dump"):
                serialized.append(event.model_dump())
            else:
                serialized.append({"type": "unknown", "data": str(event)})
        return serialized

    @staticmethod
    def _default_cache_path() -> Path:
        override = os.environ.get("TOWNSHIP_CACHE_PATH")
        if not override:
            return DEFAULT_CACHE_PATH
        path = Path(override).expanduser()
        return path if path.is_absolute() else APPLICATION_ROOT / path

    async def save_cache(
        self,
        filepath: str | None = None,
        *,
        events: list | None = None,
        usage: dict | None = None,
    ):
        """Save event log for replay.

        Defaults to the storage module's application root (the repository in a
        checkout, launch directory in an installed wheel), with an optional
        ``TOWNSHIP_CACHE_PATH`` override. Writes atomically via
        storage.save_json_atomic (temp file + os.replace).
        """
        serialized = self._serialized_events(events)
        cache_data = {
            **artifact_version_fields(),
            "events": serialized,
            "district_summary": self.district_summary.model_dump()
            if self.district_summary
            else None,
            "usage": usage or self._run_usage_report(),
            "responsible_use": self._responsible_use_snapshot(),
        }

        cache_path = Path(filepath) if filepath else self._default_cache_path()
        save_json_atomic(cache_path, cache_data)
        logger.info(f"Saved simulation cache to {cache_path} ({len(serialized)} events)")

    # ── Run persistence + narrative recap ─────────────────────────

    async def _finalize_run(self, events: list) -> None:
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
                    events,
                    self.client,
                )
                recap = self._add_responsible_use_notice(recap)
        except Exception as e:
            logger.error(f"Recap generation failed: {e}")

        # Once this run has completed, never pair an older recap/run id with
        # the new results if either best-effort persistence step fails.
        self.last_recap = recap
        self.last_run_dir = None

        usage = self._run_usage_report()
        try:
            await self.save_cache(events=events, usage=usage)
        except Exception as e:
            logger.error(f"Simulation cache persistence failed: {e}")

        try:
            self.last_run_dir = self._persist_run(recap, events, usage)
            logger.info(f"Persisted run to {self.last_run_dir}")
        except Exception as e:
            logger.error(f"Run persistence failed: {e}")

    def _persist_run(self, recap: str | None, events: list, usage: dict) -> Path:
        """Atomically publish one complete run directory under ``runs/``."""
        started = self._run_started_at or datetime.now(UTC)
        ended = datetime.now(UTC)
        slug = re.sub(r"[^a-z0-9-]+", "-", self.scenario.id.lower()).strip("-") or "scenario"
        # Keep the public id within routes.runs.RUN_ID_RE while making
        # cross-process collisions vanishingly unlikely.
        slug = slug[:60].rstrip("-") or "scenario"
        run_id = f"{started.strftime('%Y%m%d-%H%M%S')}-{slug}-{uuid.uuid4().hex[:8]}"

        root = runs_root()
        root.mkdir(parents=True, exist_ok=True)
        run_dir = root / run_id
        staging_dir = Path(tempfile.mkdtemp(prefix=".township-run-", dir=root))

        try:
            serialized = self._serialized_events(events)
            responsible_use = self._responsible_use_snapshot()
            versions = artifact_version_fields()
            # events.json shares the replay-cache shape ({"events": [...]})
            # so a run can be replayed or staged once its privacy marker has
            # been verified.
            save_json_atomic(
                staging_dir / "events.json",
                {
                    **versions,
                    "events": serialized,
                    "responsible_use": responsible_use,
                },
                minify=True,
            )

            district_wire = (
                district_summary_to_wire(self.district_summary, self.scenario)
                if self.district_summary
                else None
            )
            summary = {
                **versions,
                "run_id": run_id,
                "scenario_id": self.scenario.id,
                "scenario_title": self.scenario.title,
                "started_at": started.isoformat(),
                "ended_at": ended.isoformat(),
                "district_summary": district_wire,
                "usage": usage,
                "responsible_use": responsible_use,
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
            save_json_atomic(staging_dir / "summary.json", summary)

            if recap:
                (staging_dir / "recap.md").write_text(recap, encoding="utf-8")

            # A valid run id is invisible until all files are complete. The
            # sibling rename is atomic on the same filesystem.
            os.rename(staging_dir, run_dir)
            return run_dir
        except Exception:
            shutil.rmtree(staging_dir, ignore_errors=True)
            raise

    async def inject_god_view(
        self,
        description: str,
        *,
        _operation_token: str | None = None,
    ) -> list[NewsReaction]:
        """Inject a variable into all agents and collect reactions."""
        owns_operation = _operation_token is None
        operation_token = self._claim_god_view_operation(_operation_token)
        try:
            return await self._inject_god_view(description)
        finally:
            if owns_operation:
                self.release_operation(operation_token)

    async def _inject_god_view(self, description: str) -> list[NewsReaction]:
        """Run an already-admitted God's View mutation."""
        logger.info("God's View injection: %s", description)

        await self.event_bus.publish(
            GodViewInjectionEvent(
                variable="god_view",
                description=description,
            )
        )

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
                agent.agent_id,
                result.get("error"),
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

        agent.add_memory(
            f"God's View event: {description[:100]}. Reaction: {emotional}, impact: {impact}"
        )

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
                agent.agent_id,
                result.get("error"),
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
            await self.event_bus.publish(
                OpinionChangedEvent(
                    agent_id=agent.agent_id,
                    agent_name=agent.definition.name,
                    town=agent.definition.town,
                    old_opinion=prev,
                    new_opinion=new_opinion,
                )
            )
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
            parts.append("\n\n--- RECENT MEMORIES ---\n" + "\n".join(f"- {m}" for m in recent))

        parts.append(
            "\n\n--- INSTRUCTIONS ---\n"
            "Stay in character. React authentically based on your life circumstances. "
            "Be specific about how this affects you, your family, and your community."
        )

        return "\n".join(parts)
