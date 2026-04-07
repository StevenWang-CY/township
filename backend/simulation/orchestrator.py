import asyncio
import json
import logging
from collections import Counter
from pathlib import Path
from typing import Optional

from ..core.agent_loader import load_all_agents
from ..core.event_bus import EventBus
from ..core.types import (
    AgentState,
    CivicAgentState,
    DistrictSummary,
    GodViewInjectionEvent,
    NewsReaction,
    Opinion,
    SimulationCompleteEvent,
    TownSummary,
)
from ..providers.anthropic_client import AnthropicClient
from ..simulation.round_manager import RoundManager
from ..tools.schemas import get_tools

logger = logging.getLogger(__name__)


class SimulationOrchestrator:
    """Runs simulations across all towns in parallel."""

    def __init__(
        self,
        anthropic_client: AnthropicClient,
        event_bus: EventBus,
        data_dir: str = "data",
        agents_dir: str = "agents",
    ):
        self.client = anthropic_client
        self.event_bus = event_bus
        self.data_dir = Path(data_dir)
        self.agents_dir = agents_dir

        # Load data files
        self.candidate_data = self._load_candidates()
        self.debate_excerpts = self._load_json("debate-excerpts.json")
        self.town_data = self._load_towns()
        self.election_logistics = self._load_json("election-logistics.json")

        # Load all agents grouped by town
        self.agent_definitions = load_all_agents(agents_dir)

        # Runtime state
        self.agent_states: dict[str, list[AgentState]] = {}
        self.town_summaries: dict[str, TownSummary] = {}
        self.district_summary: Optional[DistrictSummary] = None
        self.is_running = False
        self.current_round = 0

        # Initialize agent states
        self._init_agent_states()

        logger.info(
            f"Orchestrator initialized: {sum(len(v) for v in self.agent_definitions.values())} agents "
            f"across {len(self.agent_definitions)} towns"
        )

    def _load_json(self, filename: str) -> dict:
        """Load a JSON file from the data directory."""
        filepath = self.data_dir / filename
        if filepath.exists():
            with open(filepath) as f:
                return json.load(f)
        logger.warning(f"Data file not found: {filepath}")
        return {}

    def _load_candidates(self) -> dict[str, dict]:
        """Load all candidate JSON files."""
        candidates = {}
        cand_dir = self.data_dir / "candidates"
        if cand_dir.exists():
            for f in sorted(cand_dir.glob("*.json")):
                with open(f) as fh:
                    candidates[f.stem] = json.load(fh)
        return candidates

    def _load_towns(self) -> dict[str, dict]:
        """Load all town JSON files."""
        towns = {}
        town_dir = self.data_dir / "towns"
        if town_dir.exists():
            for f in sorted(town_dir.glob("*.json")):
                with open(f) as fh:
                    towns[f.stem] = json.load(fh)
        return towns

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

    def get_agent_state(self, agent_id: str) -> Optional[AgentState]:
        """Find an agent state by ID across all towns."""
        for town_agents in self.agent_states.values():
            for agent in town_agents:
                if agent.agent_id == agent_id:
                    return agent
        return None

    async def _run_cross_town_gossip(self):
        """Run cross-town gossip conversations between agents from different towns."""
        logger.info("Running cross-town gossip round")
        rm = RoundManager(
            anthropic_client=self.client,
            event_bus=self.event_bus,
            candidate_data=self.candidate_data,
            debate_excerpts=self.debate_excerpts,
            town_data=self.town_data,
        )
        cross_pairs = rm._create_cross_town_pairs(self.agent_states)
        tasks = []
        for agent_a, agent_b, connection_story in cross_pairs:
            tasks.append(rm.run_cross_town_conversation(agent_a, agent_b, connection_story, round_num=3))
        results = await asyncio.gather(*tasks, return_exceptions=True)
        successful = sum(1 for r in results if not isinstance(r, Exception))
        logger.info(f"Cross-town gossip complete: {successful}/{len(tasks)} conversations succeeded")

    async def run_full_simulation(self, num_rounds: int = 5) -> DistrictSummary:
        """Run all towns in parallel, compute district summary."""
        self.is_running = True
        self.current_round = 0
        logger.info(f"Starting full simulation: {num_rounds} rounds across {len(self.agent_states)} towns")

        try:
            # Run all towns in parallel
            tasks = []
            for town in self.agent_states:
                tasks.append(self._run_town_with_tracking(town, num_rounds))

            town_results = await asyncio.gather(*tasks, return_exceptions=True)

            # Run cross-town gossip after town simulations complete
            try:
                await self._run_cross_town_gossip()
            except Exception as e:
                logger.error(f"Cross-town gossip failed: {e}")

            # Collect results
            for town, result in zip(self.agent_states.keys(), town_results):
                if isinstance(result, Exception):
                    logger.error(f"Town {town} simulation failed: {result}")
                    # Create empty summary for failed town
                    self.town_summaries[town] = TownSummary(
                        town=town,
                        opinion_distribution={"undecided": len(self.agent_states.get(town, []))},
                        top_issues=[],
                        agent_summaries=[],
                        total_conversations=0,
                        rounds_completed=0,
                    )
                else:
                    self.town_summaries[town] = result

            # Compute district summary
            self.district_summary = self._compute_district_summary(self.town_summaries)

            await self.event_bus.publish(SimulationCompleteEvent(
                district_summary=self.district_summary,
            ))

            # Save cache
            await self.save_cache()

            return self.district_summary

        finally:
            self.is_running = False

    async def _run_town_with_tracking(self, town: str, num_rounds: int) -> TownSummary:
        """Wrapper to run a single town's simulation with the RoundManager."""
        rm = RoundManager(
            anthropic_client=self.client,
            event_bus=self.event_bus,
            candidate_data=self.candidate_data,
            debate_excerpts=self.debate_excerpts,
            town_data=self.town_data,
        )
        return await rm.run_town_simulation(
            town=town,
            agent_states=self.agent_states[town],
            num_rounds=num_rounds,
        )

    async def run_single_town(self, town: str, num_rounds: int = 5) -> TownSummary:
        """Run simulation for just one town."""
        if town not in self.agent_states:
            raise ValueError(f"Unknown town: {town}. Available: {list(self.agent_states.keys())}")

        self.is_running = True
        try:
            result = await self._run_town_with_tracking(town, num_rounds)
            self.town_summaries[town] = result

            # Recompute district summary if we have results
            if self.town_summaries:
                self.district_summary = self._compute_district_summary(self.town_summaries)

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

        for town, summary in town_summaries.items():
            for candidate, count in summary.opinion_distribution.items():
                total_opinions[candidate] += count
                total_agents += count
            total_conversations += summary.total_conversations

            # Track issues per town for fault line analysis
            town_issues = {}
            for issue_entry in summary.top_issues:
                issue_name = issue_entry.get("issue", "")
                importance = issue_entry.get("importance", 0.0)
                if issue_name:
                    town_issues[issue_name] = importance
            all_issues_by_town[town] = town_issues

        # Prediction: percentage per candidate
        prediction = {}
        if total_agents > 0:
            for candidate, count in total_opinions.items():
                prediction[candidate] = round((count / total_agents) * 100, 1)
        else:
            prediction = {"mejia": 0, "hathaway": 0, "bond": 0, "undecided": 100}

        # Consensus zones: issues mentioned by 70%+ of agents across all towns
        all_issue_counts: Counter = Counter()
        for town, summary in town_summaries.items():
            town_agent_count = sum(summary.opinion_distribution.values())
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
        )

    async def save_cache(self, filepath: str = "data/simulation_cache.json"):
        """Save event log for replay."""
        event_log = self.event_bus.get_event_log()
        serialized = []
        for event in event_log:
            if hasattr(event, "model_dump"):
                serialized.append(event.model_dump())
            else:
                serialized.append({"type": "unknown", "data": str(event)})

        cache_data = {
            "events": serialized,
            "district_summary": self.district_summary.model_dump() if self.district_summary else None,
            "usage": self.client.get_usage_report(),
        }

        cache_path = Path(filepath)
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        with open(cache_path, "w") as f:
            json.dump(cache_data, f, indent=2, default=str)

        logger.info(f"Saved simulation cache to {filepath} ({len(serialized)} events)")

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
                    f"BREAKING DEVELOPMENT in the NJ-11 election:\n\n"
                    f"{description}\n\n"
                    f"React to this development. How does it affect you personally? "
                    f"Does it change how you're thinking about your vote? "
                    f"Use the ReactToNews tool."
                ),
            }
        ]

        result = await self.client.call_agent(
            system_prompt=system_prompt,
            messages=messages,
            tools=get_tools(["ReactToNews"]),
            max_tokens=400,
            model=agent.definition.model,
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

        return NewsReaction(
            agent_name=agent.definition.name,
            event=description,
            emotional_response=emotional,
            impact_on_vote=impact,
            reasoning=reasoning,
        )

    def _build_god_view_prompt(self, agent: AgentState) -> str:
        """Build system prompt for God's View reactions."""
        parts = [agent.definition.system_prompt]

        parts.append(
            "\n\n--- ELECTION CONTEXT ---\n"
            "You are a voter in NJ-11. Special election is April 16, 2026.\n"
            "Candidates: Mejia (D), Hathaway (R), Bond (I)."
        )

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
