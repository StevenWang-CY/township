import asyncio
import logging
import random
import re
import uuid
from datetime import UTC, datetime

from ..community import grammar
from ..core.event_bus import EventBus
from ..core.scenario import RoundSpec, Scenario, validate_stance
from ..core.types import (
    AgentMovedEvent,
    AgentSpeechEvent,
    AgentState,
    BallotCastEvent,
    CivicAgentState,
    Conversation,
    ConversationEndedEvent,
    ConversationRecord,
    ConversationStartedEvent,
    CrossTownGossipEvent,
    ElectionResultEvent,
    InfluenceRef,
    NewsInjectedEvent,
    NewsReaction,
    NewsReactionEvent,
    Opinion,
    OpinionChangedEvent,
    OpinionTrigger,
    RoundEndedEvent,
    RoundStartedEvent,
    TownSummary,
    WorldClockTickEvent,
)
from ..core.wire import town_summary_to_wire
from ..tools.schemas import build_tools
from . import attribution
from .influence import InfluenceModel

logger = logging.getLogger(__name__)


class _AdHocNews:
    """A headline with no scenario entry (God's View, tests): no authored effects."""

    def __init__(self, headline: str, description: str = "", *, neutral: bool = False) -> None:
        self.headline = headline
        self.description = description
        self.effects: list = []
        self.towns: list = []
        self.neutral = neutral  # procedural coverage: no keyword fallback push


def clip_text(text: str, limit: int) -> str:
    """Truncate for display events at a word boundary with an ellipsis.

    Replay UIs render these strings verbatim; a hard slice leaves mid-word
    stubs like "so we'r" in transcripts.
    """
    if len(text) <= limit:
        return text
    cut = text[: limit - 1]
    space = cut.rfind(" ")
    if space > limit // 2:
        cut = cut[:space]
    return cut.rstrip(" ,;:") + "…"


class RoundManager:
    """Core simulation engine. Runs rounds of agent deliberation for a single town.

    All content — round plan, news beats, prompt context, cross-town pairs —
    comes from the active Scenario; the engine itself is scenario-agnostic.
    """

    def __init__(
        self,
        anthropic_client,
        event_bus: EventBus,
        scenario: Scenario,
        total_days: int | None = None,
    ):
        self.client = anthropic_client
        self.event_bus = event_bus
        self.scenario = scenario
        self.town_data = scenario.towns
        self._tool_registry = build_tools(scenario)
        # Social bookkeeping: who talked to whom (per town, per round) so
        # pairing can avoid repeats, the in-world clock each town is on, and
        # a draw counter so seeded picks differ within a round.
        self._recent_pairs: dict[str, dict[int, set[frozenset[str]]]] = {}
        self._round_clock: dict[str, tuple[int, int]] = {}
        self._current_round: dict[str, int] = {}
        self._draws = 0
        # Model II: the engine-side influence ledger and its attribution.
        self.model = InfluenceModel(scenario)
        self.total_days = total_days  # campaign length in days, when the run has a calendar
        # Providers that render from the ledger prior (the mock) get it as a
        # kwarg; every other provider keeps the plain contract.
        self._prior_capable = bool(getattr(anthropic_client, "supports_engine_prior", False))
        self.divergence = {"checked": 0, "diverged": 0}
        # Set by the orchestrator: "quick" | "campaign" (stamped on round_started).
        self.preset: str | None = None
        # The district count, stashed by the orchestrator after the results beat
        # so the morning-after headline names the real winner.
        self.district_election: dict | None = None
        # What each town is talking about: issue → salience (renormalised per beat).
        self._salience: dict[str, dict[str, float]] = {}
        self._beat_topics: dict[str, dict[str, float]] = {}

    # ── Seeded randomness ───────────────────────────────────────────
    #
    # Every choice the engine makes (pairs, meeting places, topics) is drawn
    # from a generator seeded by (scenario, town, round, purpose): two runs of
    # the same package under the mock provider make the same choices, and
    # towns running concurrently no longer interleave one global stream.

    def _rng(self, purpose: str, town: str, round_num: int) -> random.Random:
        return random.Random(f"{self.scenario.id}|{town}|{round_num}|{purpose}")

    def _tools(self, names: list[str]) -> list[dict]:
        return [self._tool_registry[n] for n in names if n in self._tool_registry]

    @staticmethod
    def _is_voice(agent: AgentState) -> bool:
        """Voices speak through the model; neighbors live in the ledger only."""
        return getattr(agent.definition, "tier", "voice") == "voice"

    @staticmethod
    def _host_town(agent: AgentState) -> str:
        """The town a resident is in this beat — home unless they commute."""
        return agent.current_town or agent.definition.town

    def _routine_stop_split(
        self, agent: AgentState, clock: tuple[int, int] | None
    ) -> tuple[str, str] | None:
        """(town, landmark) for the routine stop at ``clock``: a
        "<town-id>: <landmark>" stop is a commute to that town."""
        stop = self._routine_stop(agent, clock)
        if not stop:
            return None
        host, sep, landmark = stop.partition(": ")
        if sep and landmark and host in self.town_data:
            return host, landmark
        return agent.definition.town, stop

    def _stop_in(self, agent: AgentState, clock: tuple[int, int] | None, town: str) -> str | None:
        """The resident's routine landmark in ``town`` at ``clock``, if that is where they are."""
        split = self._routine_stop_split(agent, clock)
        return split[1] if split and split[0] == town else None

    def _label(self, stance: str | None) -> str | None:
        if not stance or stance == self.scenario.undecided_id:
            return None
        return self.scenario.option_label.get(stance, stance)

    async def _call(self, *, prior: dict | None = None, **kwargs) -> dict:
        """call_agent, passing the ledger prior only to providers that declare support."""
        if prior is not None and self._prior_capable:
            return await self.client.call_agent(prior=prior, **kwargs)
        return await self.client.call_agent(**kwargs)

    @staticmethod
    def _first_sentence(text: str, limit: int = 160) -> str:
        text = (text or "").strip()
        if not text:
            return ""
        cut = re.split(r"(?<=[.!?])\s+", text, maxsplit=1)[0]
        return clip_text(cut, limit)

    def _trigger_for(
        self, influences: list[InfluenceRef], default: str, agent: AgentState
    ) -> OpinionTrigger:
        """The trigger is whatever the strongest cited influence was."""
        if influences:
            top = max(influences, key=lambda i: i.weight)
            if top.kind == "conversation":
                cid = top.ref.split(":", 1)[1]
                rec = next((c for c in agent.conversations if c.id == cid), None)
                partners = [a for a in (rec.agents if rec else []) if a != agent.agent_id]
                return OpinionTrigger(
                    kind="conversation", conversation_id=cid, partner_ids=partners
                )
            if top.kind == "news":
                nid = top.ref.split(":", 1)[1]
                item = self.scenario.news_by_id.get(nid)
                return OpinionTrigger(
                    kind="news", news_id=nid, headline=item.headline if item else None
                )
            if top.kind == "gossip":
                return OpinionTrigger(
                    kind="gossip",
                    conversation_id=top.ref.split(":", 1)[1],
                    partner_ids=[top.agent_id] if top.agent_id else [],
                )
            if top.kind == "god_view":
                return OpinionTrigger(kind="god_view")
        return OpinionTrigger(kind=default)  # type: ignore[arg-type]

    async def run_town_simulation(
        self, town: str, agent_states: list[AgentState], num_rounds: int | None = None
    ) -> TownSummary:
        """Run full simulation for one town through the scenario's round plan."""
        plan = self.scenario.config.round_plan
        # ScenarioConfig validates the plan is 0-based contiguous and sorted,
        # so "first num_rounds rounds" is a plain slice. None (or an
        # over-large cap) means the whole plan.
        if num_rounds is None:
            num_rounds = len(plan)
        num_rounds = min(num_rounds, len(plan))
        specs = plan[:num_rounds]
        logger.info(
            f"Starting simulation for {town} with {len(agent_states)} agents, "
            f"{len(specs)} rounds (scenario={self.scenario.id})"
        )

        total_conversations = 0

        for spec in specs:
            total_conversations = await self.run_town_round(
                town=town,
                agent_states=agent_states,
                spec=spec,
                total_rounds=num_rounds,
                total_conversations=total_conversations,
            )

        # Build town summary
        return self._build_town_summary(town, agent_states, total_conversations, num_rounds)

    ATTENTION_FLOOR = 0.7
    ATTENTION_CEILING = 1.3
    LATE_DECIDER_WINDOW = 0.2  # the last fifth of the calendar

    def _days_left_frac(self) -> float:
        """Fraction of the campaign still ahead (1.0 without a calendar)."""
        if not self.total_days or self.total_days <= 1:
            return 1.0
        progress = (self.model.attention - self.ATTENTION_FLOOR) / (
            self.ATTENTION_CEILING - self.ATTENTION_FLOOR
        )
        return max(0.0, min(1.0, 1.0 - progress))

    def _attention_for(self, spec: RoundSpec) -> float:
        """Campaign attention: quiet early weeks, a final week where the same
        argument lands harder — the late-decider effect, without deciding for
        anyone. 1.0 when the run has no calendar."""
        if not spec.day or not self.total_days or self.total_days <= 1:
            return 1.0
        progress = min(1.0, max(0.0, (spec.day - 1) / (self.total_days - 1)))
        return self.ATTENTION_FLOOR + (self.ATTENTION_CEILING - self.ATTENTION_FLOOR) * progress

    async def run_town_round(
        self,
        town: str,
        agent_states: list[AgentState],
        spec: RoundSpec,
        total_rounds: int,
        total_conversations: int = 0,
        present: list[AgentState] | None = None,
    ) -> int:
        """Run one declared round and return the cumulative conversation count.

        The orchestrator uses this boundary to keep every town on the same
        round before it emits district weather or runs cross-town gossip.
        ``run_town_simulation`` remains the convenient standalone wrapper.

        ``present`` is who is physically in this town for the beat (the
        orchestrator's presence table: residents minus commuters, plus
        visitors). Conversations and headlines use it; seeds, opinions,
        ballots, results and the summary always use the town's residents.
        """
        round_num = spec.round
        talkers = present if present is not None else agent_states
        self.model.attention = self._attention_for(spec)
        await self.event_bus.publish(
            RoundStartedEvent(
                round=round_num,
                town=town,
                total_rounds=total_rounds,
                day=spec.day,
                date=spec.date,
                weekday=spec.weekday,
                beat=spec.beat,
                label=spec.label,
                preset=self.preset,
            )
        )

        hour, minute = spec.clock_tuple()
        self._round_clock[town] = (hour, minute)
        self._current_round[town] = round_num
        await self.event_bus.publish(
            WorldClockTickEvent(
                hour=hour,
                minute=minute,
                town=town,
                day=spec.day,
                date=spec.date,
            )
        )

        # Campaign event effects land before the beat's phases run.
        if spec.event:
            self._apply_event_effect(town, agent_states, spec)

        news_by_id = self.scenario.news_by_id
        decided_ids: list[str] = []
        for phase in spec.phases:
            if phase == "seed":
                await self._run_seed_round(agent_states, round_num)
            elif phase == "converse":
                total_conversations += await self._run_conversation_round(talkers, round_num)
            elif phase == "news":
                news_events = [
                    {
                        "id": news_id,
                        "headline": news_by_id[news_id].headline,
                        "description": news_by_id[news_id].description,
                        "towns": list(news_by_id[news_id].towns),
                    }
                    for news_id in spec.news_ids
                    if news_id in news_by_id
                    and (not news_by_id[news_id].towns or town in news_by_id[news_id].towns)
                ]
                if news_events:
                    await self._run_news_round(talkers, news_events, round_num)
            elif phase == "opinion":
                await self._run_opinion_round(agent_states, round_num)
            elif phase == "reflect":
                # Sunday: the same read-out, framed as a week's reflection.
                await self._run_opinion_round(agent_states, round_num, reflect=True)
            elif phase == "decide":
                for agent in agent_states:
                    if agent.state == CivicAgentState.ERROR:
                        continue
                    await self._cast_ballot(agent, town, round_num)
                    agent.state = CivicAgentState.DECIDED
                    decided_ids.append(agent.agent_id)
            elif phase == "vote":
                decided_ids.extend(await self._run_vote_beat(town, agent_states, spec))
            elif phase == "results":
                await self._publish_town_result(town, agent_states, spec)
            elif phase == "aftermath":
                await self._run_aftermath(town, agent_states, spec)

        self._end_of_beat(town, agent_states, spec)

        await self.event_bus.publish(
            RoundEndedEvent(
                round=round_num,
                town=town,
                decided_agent_ids=decided_ids,
                summary=[
                    town_summary_to_wire(
                        self._build_town_summary(
                            town,
                            agent_states,
                            total_conversations,
                            round_num + 1,
                        )
                    )
                ],
            )
        )
        return total_conversations

    def build_town_summary(
        self,
        town: str,
        agents: list[AgentState],
        total_conversations: int,
        rounds_completed: int,
    ) -> TownSummary:
        """Build a final town summary after orchestrated round execution."""
        return self._build_town_summary(
            town,
            agents,
            total_conversations,
            rounds_completed,
        )

    async def _run_seed_round(self, agents: list[AgentState], round_num: int = 0):
        """Inject the scenario briefing, get initial opinions from all agents."""
        logger.info(f"Running seed round for {len(agents)} agents")

        # Build the full scenario briefing (options, positions, extras)
        full_context = self.scenario.build_full_context()

        tasks = []
        for agent in agents:
            tasks.append(self._seed_single_agent(agent, full_context, round_num))

        await asyncio.gather(*tasks, return_exceptions=True)

    async def _seed_single_agent(self, agent: AgentState, full_context: str, round_num: int):
        """Seed a single agent with the scenario briefing and get an initial opinion."""
        try:
            agent.state = CivicAgentState.OBSERVING
            town = agent.definition.town
            seed_ref = (
                f"persona:{self.model.match_issue(agent.definition.top_concerns[0]) or 'values'}"
                if agent.definition.top_concerns
                else "persona:values"
            )
            agent.remember(
                "seed",
                round_num,
                f"Round {round_num}: Learned about {self.scenario.title} and where the options stand.",
                refs=[seed_ref],
                salience=0.3,
            )
            # The ledger starts from the persona; the mock renders its read-out,
            # a real model states its own view and the ledger adopts it below.
            agent.beliefs = self.model.seed(
                agent.definition, self._rng(f"seed:{agent.agent_id}", town, round_num)
            )
            prior = self.model.prior_for(agent)

            # Move agent to a starting location
            from_location = agent.current_location
            location = self._pick_location(town)
            agent.current_location = location
            landmark = self._get_landmark(town, location)
            if landmark:
                await self.event_bus.publish(
                    AgentMovedEvent(
                        agent_id=agent.agent_id,
                        agent_name=agent.definition.name,
                        town=town,
                        home_town=agent.definition.town,
                        from_location=from_location,
                        to_location=location,
                        x=landmark.get("x", 400),
                        y=landmark.get("y", 300),
                    )
                )

            if not self._is_voice(agent):
                await self._seed_neighbor(agent, round_num, seed_ref)
                return

            # Ask agent to form initial opinion
            system_prompt = self._build_agent_system_prompt(agent, round_num=round_num)
            messages = [
                {
                    "role": "user",
                    "content": (
                        f"Your community faces a decision: {self.scenario.question}\n\n"
                        f"Here's what you know:\n\n{full_context}\n\n"
                        f"Based on your life experience and priorities, form your initial opinion "
                        f"about which option you're leaning toward. Use the FormOpinion tool."
                    ),
                }
            ]

            result = await self._call(
                prior={**prior, "phase": "seed"},
                system_prompt=system_prompt,
                messages=messages,
                tools=self._tools(["FormOpinion"]),
                max_tokens=1600,
                model=agent.definition.model,
            )

            # Genuine LLM/transport failure — mark ERROR, do NOT mint a
            # confident fallback opinion.
            if result.get("stop_reason") == "error":
                logger.error("Seed call errored for %s: %s", agent.agent_id, result.get("error"))
                agent.state = CivicAgentState.ERROR
                return

            # Process FormOpinion tool use
            if result["tool_use"] and result["tool_use"]["name"] == "FormOpinion":
                tool_input = result["tool_use"]["input"]
                opinion = Opinion(
                    candidate=validate_stance(
                        tool_input.get("candidate", agent.definition.initial_lean),
                        self.scenario,
                    ),
                    confidence=tool_input.get("confidence", 30),
                    reasoning=tool_input.get(
                        "reasoning", "Initial impression based on what I've heard."
                    ),
                    top_issues=tool_input.get("top_issues", agent.definition.top_concerns[:3]),
                    dealbreaker=tool_input.get("dealbreaker"),
                    round_number=round_num,
                )
                agent.opinions.append(opinion)
                agent.remember(
                    "seed",
                    round_num,
                    f"Round {round_num}: Formed initial opinion - leaning {opinion.candidate} "
                    f"(confidence: {opinion.confidence}%). Reasoning: {opinion.reasoning}",
                    refs=[seed_ref],
                    salience=0.4,
                )
                if agent.beliefs is not None:
                    self.model.adopt_stance(
                        agent.beliefs,
                        opinion.candidate,
                        round_num,
                        seed_ref,
                        note="where I start from",
                    )
                    # The stated starting point is the persona's anchor from here on.
                    agent.beliefs.anchor = dict(agent.beliefs.utilities)
                    agent.beliefs.last_reflection_round = round_num
                await self.event_bus.publish(
                    OpinionChangedEvent(
                        agent_id=agent.agent_id,
                        agent_name=agent.definition.name,
                        town=agent.definition.town,
                        old_opinion=None,
                        new_opinion=opinion,
                        round=round_num,
                        trigger=OpinionTrigger(kind="seed"),
                        influences=[
                            InfluenceRef(
                                kind="persona",
                                ref=seed_ref,
                                direction="toward",
                                weight=1.0,
                                note=clip_text(agent.definition.top_concerns[0], 120)
                                if agent.definition.top_concerns
                                else "my circumstances",
                            )
                        ],
                        reason=self._first_sentence(tool_input.get("reason") or opinion.reasoning),
                        delta_confidence=None,
                    )
                )
            else:
                # Fallback: create opinion from initial lean
                opinion = Opinion(
                    candidate=validate_stance(agent.definition.initial_lean, self.scenario),
                    confidence=25,
                    reasoning="Haven't formed a strong view yet.",
                    top_issues=agent.definition.top_concerns[:3],
                    round_number=round_num,
                )
                agent.opinions.append(opinion)

            agent.state = CivicAgentState.IDLE

        except Exception as e:
            logger.error(f"Error seeding agent {agent.agent_id}: {e}")
            agent.state = CivicAgentState.ERROR
            # Fallback opinion so simulation can continue
            if not agent.opinions:
                agent.opinions.append(
                    Opinion(
                        candidate=validate_stance(agent.definition.initial_lean, self.scenario),
                        confidence=20,
                        reasoning="Still figuring things out.",
                        top_issues=agent.definition.top_concerns[:3],
                        round_number=round_num,
                    )
                )

    async def _seed_neighbor(self, agent: AgentState, round_num: int, seed_ref: str) -> None:
        """A neighbor's first opinion is the ledger's read-out — no model call.
        The drawn lean is the authored prior (the town's lean mix), so the
        ledger adopts it the way it adopts a voice's stated stance, and the
        persona anchor is that starting point."""
        self.model.adopt_stance(
            agent.beliefs,
            agent.definition.initial_lean,
            round_num,
            seed_ref,
            note="where I start from",
            soft=agent.beliefs.traits.get("party_loyalty", 0.0) < 0.2,
        )
        agent.beliefs.anchor = dict(agent.beliefs.utilities)
        r = self.model.readout(agent.beliefs)
        undecided = r.stance == self.scenario.undecided_id
        opinion = Opinion(
            candidate=r.stance,
            confidence=r.confidence,
            reasoning="Starting out undecided."
            if undecided
            else f"Starting out leaning {self._label(r.stance)}.",
            top_issues=agent.definition.top_concerns[:3],
            round_number=round_num,
        )
        agent.opinions.append(opinion)
        agent.remember(
            "seed",
            round_num,
            f"Round {round_num}: Formed initial opinion - leaning {opinion.candidate} "
            f"(confidence: {opinion.confidence}%). Reasoning: {opinion.reasoning}",
            refs=[seed_ref],
            salience=0.4,
        )
        agent.beliefs.last_reflection_round = round_num
        self.model.note_readout(agent.beliefs, opinion.candidate)
        agent.state = CivicAgentState.IDLE
        await self.event_bus.publish(
            OpinionChangedEvent(
                agent_id=agent.agent_id,
                agent_name=agent.definition.name,
                town=agent.definition.town,
                old_opinion=None,
                new_opinion=opinion,
                round=round_num,
                trigger=OpinionTrigger(kind="seed"),
                influences=[
                    InfluenceRef(
                        kind="persona",
                        ref=seed_ref,
                        direction="toward",
                        weight=1.0,
                        note="where I start from",
                    )
                ],
                reason=opinion.reasoning,
            )
        )

    NEIGHBOR_TALK_RATE = 0.5

    def _talkers(self, agents: list[AgentState], round_num: int) -> list[AgentState]:
        """Who has a political conversation this beat: every voice, and about
        half the neighbors — most people don't talk politics three times a day."""
        if not agents:
            return []
        rng = self._rng("talkers", self._host_town(agents[0]), round_num)
        out = []
        for a in sorted(agents, key=lambda a: a.agent_id):
            if self._is_voice(a) or rng.random() < self.NEIGHBOR_TALK_RATE:
                out.append(a)
        return out

    async def _run_conversation_round(self, agents: list[AgentState], round_num: int) -> int:
        """Pair agents randomly, run discussions at town locations. Returns number of conversations."""
        pool = self._talkers(agents, round_num)
        pairs = self._random_pairs(pool, count=max(1, len(pool) // 2), round_num=round_num)
        logger.info(f"Running conversation round {round_num} with {len(pairs)} pairs")

        tasks = []
        for agent_a, agent_b in pairs:
            tasks.append(self._run_conversation(agent_a, agent_b, round_num))

        results = await asyncio.gather(*tasks, return_exceptions=True)
        return sum(1 for r in results if not isinstance(r, Exception))

    async def _run_conversation(self, agent_a: AgentState, agent_b: AgentState, round_num: int):
        """Run a 3-exchange conversation between two agents."""
        if not (self._is_voice(agent_a) and self._is_voice(agent_b)):
            return await self._run_templated_conversation(agent_a, agent_b, round_num)
        town = self._host_town(agent_a)
        location = self._meeting_place(
            town, agent_a, agent_b, self._round_clock.get(town), round_num
        )
        from_a = agent_a.current_location
        from_b = agent_b.current_location
        agent_a.current_location = location
        agent_b.current_location = location
        agent_a.state = CivicAgentState.DISCUSSING
        agent_b.state = CivicAgentState.DISCUSSING

        landmark = self._get_landmark(town, location)
        lx = landmark.get("x", 400) if landmark else 400
        ly = landmark.get("y", 300) if landmark else 300

        # Move both agents to location
        await self.event_bus.publish(
            AgentMovedEvent(
                agent_id=agent_a.agent_id,
                agent_name=agent_a.definition.name,
                town=town,
                home_town=agent_a.definition.town,
                from_location=from_a,
                to_location=location,
                x=lx - 30,
                y=ly,
            )
        )
        await self.event_bus.publish(
            AgentMovedEvent(
                agent_id=agent_b.agent_id,
                agent_name=agent_b.definition.name,
                town=town,
                home_town=agent_b.definition.town,
                from_location=from_b,
                to_location=location,
                x=lx + 30,
                y=ly,
            )
        )

        # Pick a conversation topic based on shared concerns
        topic = self._pick_topic(agent_a, agent_b, town, round_num)

        # Build a wire-format Conversation that matches the frontend interface
        convo_id = uuid.uuid4().hex[:8]
        wire_conversation = Conversation(
            id=convo_id,
            participants=[agent_a.agent_id, agent_b.agent_id],
            participant_names=[agent_a.definition.name, agent_b.definition.name],
            town=town,
            location=location,
            topic=topic,
            summary="",
            round=round_num,
            timestamp=datetime.now(UTC).isoformat(),
        )
        await self.event_bus.publish(
            ConversationStartedEvent(
                conversation=wire_conversation,
            )
        )

        dialogue_parts = []
        key_takeaways = {}
        partner_stances: dict[str, str] = {}
        sentiments: dict[str, str] = {}
        conv_ref = f"conv:{convo_id}"
        relationship = self._relationship_strength(agent_a, agent_b)

        # 3 exchanges: A speaks, B responds, A responds
        speakers = [agent_a, agent_b, agent_a]
        listeners = [agent_b, agent_a, agent_b]

        conversation_so_far = ""

        for i, (speaker, listener) in enumerate(zip(speakers, listeners, strict=True)):
            try:
                system_prompt = self._build_agent_system_prompt(speaker, round_num=round_num)
                speaker_stance = (
                    speaker.current_opinion.candidate
                    if speaker.current_opinion
                    else self.scenario.undecided_id
                )
                listener_stance = (
                    listener.current_opinion.candidate
                    if listener.current_opinion
                    else self.scenario.undecided_id
                )
                partner_stances[speaker.agent_id] = speaker_stance
                prior = {
                    "phase": "discuss",
                    "stance": speaker_stance,
                    "partner": listener.definition.name,
                    "partner_stance": listener_stance,
                    "agree": speaker_stance == listener_stance
                    and speaker_stance != self.scenario.undecided_id,
                    "topic": topic,
                }

                if i == 0:
                    user_msg = (
                        f"You run into {listener.definition.name} at {location}. "
                        f"You start talking about {self.scenario.title}, specifically about: {topic}. "
                        f"You know that {listener.definition.name} is a {listener.definition.occupation}. "
                        f"Start the conversation naturally. Use the Discuss tool to respond."
                    )
                else:
                    user_msg = (
                        f"You're talking with {listener.definition.name} at {location} "
                        f"about {self.scenario.title}.\n\n"
                        f"Conversation so far:\n{conversation_so_far}\n\n"
                        f"Continue the conversation naturally. Respond to what they said. "
                        f"Use the Discuss tool."
                    )

                result = await self._call(
                    prior=prior,
                    system_prompt=system_prompt,
                    messages=[{"role": "user", "content": user_msg}],
                    tools=self._tools(["Discuss"]),
                    max_tokens=1200,
                    model=speaker.definition.model,
                )

                if result.get("stop_reason") == "error":
                    logger.error(
                        "Conversation exchange %d errored for %s: %s",
                        i,
                        speaker.agent_id,
                        result.get("error"),
                    )
                    speaker.state = CivicAgentState.ERROR
                    dialogue_parts.append(f"{speaker.definition.name}: [unavailable]")
                    conversation_so_far = "\n".join(dialogue_parts)
                elif result["tool_use"] and result["tool_use"]["name"] == "Discuss":
                    tool_input = result["tool_use"]["input"]
                    response_text = tool_input.get("response", result.get("text", "..."))
                    sentiment = tool_input.get("sentiment", "neutral")
                    takeaway = tool_input.get("key_takeaway", "")
                    gesture = tool_input.get("gesture")

                    dialogue_parts.append(f"{speaker.definition.name}: {response_text}")
                    conversation_so_far = "\n".join(dialogue_parts)
                    key_takeaways[speaker.definition.name] = takeaway
                    sentiments[speaker.agent_id] = sentiment

                    # The argument lands on the listener's ledger.
                    entry = self.model.apply_exchange(
                        listener,
                        speaker,
                        topic,
                        round_num,
                        conv_ref,
                        relationship=relationship,
                        salience=self.salience_for(town),
                    )
                    self._note_topic(town, topic, 0.5)
                    moved = abs(entry.delta) if entry else 0.0
                    speaker.remember(
                        "conversation",
                        round_num,
                        f"Round {round_num}: Talked with {listener.definition.name} at {location} about {topic}. "
                        f"Takeaway: {takeaway}",
                        refs=[conv_ref],
                        salience=0.5,
                    )
                    listener.remember(
                        "conversation",
                        round_num,
                        f"Round {round_num}: {speaker.definition.name} ({speaker_stance}) said at {location}: "
                        f"{clip_text(response_text, 140)}",
                        refs=[conv_ref],
                        salience=min(1.0, 0.45 + moved * 2),
                    )

                    await self.event_bus.publish(
                        AgentSpeechEvent(
                            agent_id=speaker.agent_id,
                            agent_name=speaker.definition.name,
                            town=town,
                            text=clip_text(response_text, 150),
                            location=location,
                            sentiment=sentiment,
                            gesture=gesture,
                        )
                    )
                else:
                    # Use text response as fallback (model didn't call the tool)
                    text = result.get("text", "...")[:200]
                    dialogue_parts.append(f"{speaker.definition.name}: {text}")
                    conversation_so_far = "\n".join(dialogue_parts)

            except Exception as e:
                logger.error(f"Error in conversation exchange {i} for {speaker.agent_id}: {e}")
                dialogue_parts.append(f"{speaker.definition.name}: [conversation interrupted]")
                conversation_so_far = "\n".join(dialogue_parts)

        # Record the conversation (internal persisted format)
        convo = ConversationRecord(
            agents=[agent_a.agent_id, agent_b.agent_id],
            location=location,
            topic=topic,
            dialogue="\n".join(dialogue_parts),
            key_takeaways=key_takeaways,
            round_number=round_num,
            id=convo_id,
            partner_stances=partner_stances,
            sentiments=sentiments,
        )
        agent_a.conversations.append(convo)
        agent_b.conversations.append(convo)
        same_stance = (
            len(set(partner_stances.values())) == 1
            and self.scenario.undecided_id not in partner_stances.values()
        )
        self._grow_relationship(agent_a, agent_b, same_stance)
        # Preserve ERROR state set by a failed exchange; otherwise return to idle.
        if agent_a.state != CivicAgentState.ERROR:
            agent_a.state = CivicAgentState.IDLE
        if agent_b.state != CivicAgentState.ERROR:
            agent_b.state = CivicAgentState.IDLE

        await self._note_cross_town(
            agent_a, agent_b, topic, f"conv:{convo_id}", key_takeaways, staged=True
        )

        # Emit a ConversationEnded so the frontend can finalize bubbles / log entry
        try:
            await self.event_bus.publish(
                ConversationEndedEvent(
                    conversation_id=convo_id,
                    summary=clip_text("; ".join(key_takeaways.values()), 200),
                )
            )
        except Exception:  # pragma: no cover — defensive
            pass

    # ── Neighbors: templated exchanges (no model) ──────────────────────

    SPEECH_RATE_MIXED = 0.35
    SPEECH_RATE_NEIGHBOR = 0.15

    async def _run_templated_conversation(
        self, agent_a: AgentState, agent_b: AgentState, round_num: int
    ) -> None:
        """A conversation involving at least one neighbor: three grammar lines,
        every one landing on the listener's ledger; speech reaches the wire at a
        sampled rate so the town murmurs instead of shouting. A voice in the
        pair gets conversation_started/ended so the scene can stage it."""
        town = self._host_town(agent_a)
        any_voice = self._is_voice(agent_a) or self._is_voice(agent_b)
        location = self._meeting_place(
            town, agent_a, agent_b, self._round_clock.get(town), round_num
        )
        for agent in (agent_a, agent_b):
            if agent.current_location != location:
                landmark = self._get_landmark(town, location)
                await self.event_bus.publish(
                    AgentMovedEvent(
                        agent_id=agent.agent_id,
                        agent_name=agent.definition.name,
                        town=town,
                        home_town=agent.definition.town,
                        from_location=agent.current_location,
                        to_location=location,
                        x=(landmark.get("x", 400) if landmark else 400)
                        + (-30 if agent is agent_a else 30),
                        y=landmark.get("y", 300) if landmark else 300,
                    )
                )
                agent.current_location = location
        topic = self._pick_topic(agent_a, agent_b, town, round_num)
        convo_id = uuid.uuid4().hex[:8]
        conv_ref = f"conv:{convo_id}"
        rate = self.SPEECH_RATE_MIXED if any_voice else self.SPEECH_RATE_NEIGHBOR
        rng = self._rng(f"templated:{agent_a.agent_id}:{agent_b.agent_id}", town, round_num)
        if any_voice:
            await self.event_bus.publish(
                ConversationStartedEvent(
                    conversation=Conversation(
                        id=convo_id,
                        participants=[agent_a.agent_id, agent_b.agent_id],
                        participant_names=[agent_a.definition.name, agent_b.definition.name],
                        town=town,
                        location=location,
                        topic=topic,
                        summary="",
                        round=round_num,
                        timestamp=datetime.now(UTC).isoformat(),
                    )
                )
            )
        relationship = self._relationship_strength(agent_a, agent_b)
        partner_stances: dict[str, str] = {}
        sentiments: dict[str, str] = {}
        takeaways: dict[str, str] = {}
        dialogue: list[str] = []
        undecided_id = self.scenario.undecided_id
        turns = ((agent_a, agent_b), (agent_b, agent_a), (agent_a, agent_b))
        for i, (speaker, listener) in enumerate(turns):
            s_stance = (
                speaker.current_opinion.candidate if speaker.current_opinion else undecided_id
            )
            l_stance = (
                listener.current_opinion.candidate if listener.current_opinion else undecided_id
            )
            partner_stances[speaker.agent_id] = s_stance
            undecided = s_stance == undecided_id
            line, sentiment, takeaway = grammar.speak(
                speaker_name=speaker.definition.name,
                speaker_language=speaker.definition.language,
                speaker_occupation=speaker.definition.occupation,
                listener_name=listener.definition.name,
                topic=topic,
                stance_label=self._label(s_stance),
                listener_stance_label=self._label(l_stance),
                undecided=undecided,
                agree=(s_stance == l_stance and not undecided),
                seed=f"{self.scenario.id}|{convo_id}|{i}",
            )
            sentiments[speaker.agent_id] = sentiment
            takeaways[speaker.definition.name] = takeaway
            dialogue.append(f"{speaker.definition.name}: {line}")
            entry = self.model.apply_exchange(
                listener,
                speaker,
                topic,
                round_num,
                conv_ref,
                relationship=relationship,
                # a neighbor's grammar line is small talk, not a voice making a case
                kappa=1.0 if self._is_voice(speaker) else 0.7,
                salience=self.salience_for(town),
            )
            self._note_topic(town, topic, 0.5)
            moved = abs(entry.delta) if entry else 0.0
            speaker.remember(
                "conversation",
                round_num,
                f"Round {round_num}: Talked with {listener.definition.name} at {location} about {topic}. {takeaway}",
                refs=[conv_ref],
                salience=0.4,
            )
            listener.remember(
                "conversation",
                round_num,
                f"Round {round_num}: {speaker.definition.name} ({s_stance}) said at {location}: {clip_text(line, 120)}",
                refs=[conv_ref],
                salience=min(1.0, 0.4 + moved * 2),
            )
            if self._is_voice(speaker) or rng.random() < rate:
                await self.event_bus.publish(
                    AgentSpeechEvent(
                        agent_id=speaker.agent_id,
                        agent_name=speaker.definition.name,
                        town=town,
                        text=clip_text(line, 150),
                        location=location,
                        sentiment=sentiment,  # type: ignore[arg-type]
                    )
                )
        convo = ConversationRecord(
            agents=[agent_a.agent_id, agent_b.agent_id],
            location=location,
            topic=topic,
            dialogue="\n".join(dialogue),
            key_takeaways=takeaways,
            round_number=round_num,
            id=convo_id,
            partner_stances=partner_stances,
            sentiments=sentiments,
        )
        agent_a.conversations.append(convo)
        agent_b.conversations.append(convo)
        stances = set(partner_stances.values())
        self._grow_relationship(agent_a, agent_b, len(stances) == 1 and undecided_id not in stances)
        await self._note_cross_town(agent_a, agent_b, topic, conv_ref, takeaways, staged=any_voice)
        if any_voice:
            await self.event_bus.publish(
                ConversationEndedEvent(
                    conversation_id=convo_id, summary=clip_text("; ".join(takeaways.values()), 200)
                )
            )

    async def _note_cross_town(
        self,
        agent_a: AgentState,
        agent_b: AgentState,
        topic: str,
        conv_ref: str,
        takeaways: dict[str, str],
        *,
        staged: bool,
    ) -> None:
        """A conversation between residents of different towns: both carry the
        topic home to retell (pending_topics feeds _pick_topic), and when a
        voice was in it the feed hears it as cross-town gossip both ways."""
        if agent_a.definition.town == agent_b.definition.town:
            return
        for holder in (agent_a, agent_b):
            if [topic, conv_ref] not in holder.pending_topics:
                holder.pending_topics.append([topic, conv_ref])
        if not staged:
            return
        for src, dst in ((agent_a, agent_b), (agent_b, agent_a)):
            msg = (
                takeaways.get(src.definition.name) or f"{src.definition.name} talked about {topic}"
            )
            await self.event_bus.publish(
                CrossTownGossipEvent(
                    from_town=src.definition.town,
                    to_town=dst.definition.town,
                    from_agent=src.agent_id,
                    to_agent=dst.agent_id,
                    message=clip_text(str(msg), 160),
                )
            )

    async def _neighbor_news(
        self, agent: AgentState, news: dict, round_num: int, speak: bool
    ) -> None:
        """A headline lands on a neighbor's ledger; one neighbor per town says a line."""
        news_id = news.get("id") or clip_text(news["headline"], 24).lower().replace(" ", "-")
        news_ref = f"news:{news_id}"
        item = self.scenario.news_by_id.get(news.get("id", "")) or _AdHocNews(
            news["headline"], news.get("description", ""), neutral=bool(news.get("neutral"))
        )
        town = self._host_town(agent)
        entries, derived = self.model.apply_news(
            agent, item, round_num, news_ref, salience=self.salience_for(town)
        )
        self._note_topic(town, news["headline"], 1.0)
        moved = sum(abs(e.delta) for e in entries)
        agent.remember(
            "news",
            round_num,
            f"Round {round_num}: Heard news '{news['headline']}'. Impact: {derived['impact_on_vote']}.",
            refs=[news_ref],
            salience=min(1.0, 0.35 + moved * 2),
        )
        if not speak:
            return
        concern = agent.definition.top_concerns[0] if agent.definition.top_concerns else "all of it"
        line = grammar.react(
            name=agent.definition.name,
            language=agent.definition.language,
            headline=news["headline"],
            impact=derived["impact_on_vote"],
            emotion=derived["emotional_response"],
            concern=concern,
            seed=f"{self.scenario.id}|{news_ref}|{agent.agent_id}",
        )
        emotion = derived["emotional_response"]
        sentiment = (
            "negative"
            if emotion in ("angry", "anxious")
            else ("positive" if emotion == "hopeful" else "neutral")
        )
        await self.event_bus.publish(
            AgentSpeechEvent(
                agent_id=agent.agent_id,
                agent_name=agent.definition.name,
                town=town,
                text=clip_text(line, 150),
                location=agent.current_location,
                sentiment=sentiment,  # type: ignore[arg-type]
            )
        )

    async def _neighbor_opinion(self, agent: AgentState, round_num: int, *, reflect: bool) -> None:
        """The ledger's read-out becomes the neighbor's opinion; the wire hears
        about it only on a change of mind or a real swing in confidence."""
        if agent.beliefs is None:
            return
        before = agent.current_opinion
        r = self.model.readout(agent.beliefs)
        since = agent.beliefs.last_reflection_round + 1
        changed = before is None or before.candidate != r.stance
        swing = before is not None and abs(before.confidence - r.confidence) >= 10
        label = self._label(r.stance)
        lean = f"Leaning {label}" if label else "Still undecided"
        opinion = Opinion(
            candidate=r.stance,
            confidence=r.confidence,
            reasoning=f"{lean} after this week." if reflect else f"{lean}.",
            top_issues=agent.definition.top_concerns[:3],
            round_number=round_num,
        )
        influences = attribution.from_ledger(agent, since, r.stance)
        agent.beliefs.last_reflection_round = round_num
        self.model.note_readout(agent.beliefs, r.stance)
        if not (changed or swing):
            return
        agent.opinions.append(opinion)
        top = influences[0] if influences else None
        trigger = (
            OpinionTrigger(kind="reflection")
            if reflect or top is None
            else self._trigger_for(influences, "reflection", agent)
        )
        await self.event_bus.publish(
            OpinionChangedEvent(
                agent_id=agent.agent_id,
                agent_name=agent.definition.name,
                town=agent.definition.town,
                old_opinion=before,
                new_opinion=opinion,
                round=round_num,
                trigger=trigger,
                influences=influences,
                reason=(top.note[:160] if top and top.note else opinion.reasoning),
                delta_confidence=(opinion.confidence - before.confidence) if before else None,
            )
        )

    # ── Long-run dynamics at the beat boundary ─────────────────────────

    def _note_topic(self, town: str, text: str, weight: float) -> None:
        issue = self.model.match_issue(text)
        if issue:
            bucket = self._beat_topics.setdefault(town, {})
            bucket[issue] = bucket.get(issue, 0.0) + weight

    def salience_for(self, town: str) -> dict[str, float]:
        return self._salience.get(town, {})

    def _end_of_beat(self, town: str, agents: list[AgentState], spec: RoundSpec) -> None:
        # Town salience: 0.9 × old + 0.1 × this beat's talk, renormalised.
        fresh = self._beat_topics.pop(town, {})
        old = self._salience.get(town, {})
        keys = set(old) | set(fresh)
        if keys:
            total_fresh = sum(fresh.values()) or 1.0
            mixed = {
                k: 0.9 * old.get(k, 0.0) + 0.1 * (fresh.get(k, 0.0) / total_fresh) for k in keys
            }
            norm = sum(mixed.values()) or 1.0
            self._salience[town] = {k: v / norm for k, v in mixed.items()}
        # Drift toward the persona anchor; a Sunday reflection resets habituation.
        for agent in sorted(agents, key=lambda a: a.agent_id):
            if agent.beliefs is None or agent.ballot is not None:
                continue
            self.model.end_of_beat(agent.beliefs)
            if "reflect" in spec.phases:
                self.model.weekly_reset(agent.beliefs)

    @staticmethod
    def _grow_relationship(a: AgentState, b: AgentState, same_stance: bool) -> None:
        for x, y in ((a, b), (b, a)):
            t = x.relationships_dyn.get(y.agent_id, 0.0)
            x.relationships_dyn[y.agent_id] = round(
                min(1.0, t + 0.06 * (1.0 - t) * (1.0 if same_stance else 0.3)), 4
            )

    # ── Campaign beats ─────────────────────────────────────────────────

    VOTE_SHARES = {"early": 0.35, "midday": 0.30}

    async def _run_vote_beat(
        self, town: str, agents: list[AgentState], spec: RoundSpec
    ) -> list[str]:
        """Election day: a share of the residents goes to the polls on each
        beat (the evening takes everyone who is left). Each voter rolls
        turnout inside the ballot; failures abstain. Stances freeze once the
        ballot is in."""
        round_num = spec.round
        share = self.VOTE_SHARES.get(spec.beat or "")
        pending = [a for a in agents if a.state != CivicAgentState.ERROR and a.ballot is None]
        if not pending:
            return []
        rng = self._rng(f"vote:{spec.beat}", town, round_num)
        if share is None:
            voters = list(pending)
        else:
            order = sorted(pending, key=lambda a: rng.random())
            voters = order[: max(1, round(len(agents) * share))]
        decided: list[str] = []
        for agent in voters:
            await self._cast_ballot(agent, town, round_num)
            agent.state = CivicAgentState.DECIDED
            decided.append(agent.agent_id)
        return decided

    async def _publish_town_result(
        self, town: str, agents: list[AgentState], spec: RoundSpec
    ) -> None:
        election = self._election_for(agents, {s: 0 for s in self.scenario.valid_stance_ids})
        await self.event_bus.publish(
            ElectionResultEvent(
                town=town,
                per_town={town: election},
                district=None,
                round=spec.round,
                day=spec.day,
                date=spec.date,
            )
        )

    async def _run_aftermath(self, town: str, agents: list[AgentState], spec: RoundSpec) -> None:
        """The morning after: residents react to the result as a headline."""
        election = self.district_election or self._election_for(
            agents, {s: 0 for s in self.scenario.valid_stance_ids}
        )
        winner = election.get("winner")
        label = self.scenario.option_label.get(winner, winner) if winner else None
        headline = (
            f"Result: {label} carries {self.scenario.title}"
            if winner
            else f"Result: {self.scenario.title} ends without a clear winner"
        )
        tally = ", ".join(
            f"{self.scenario.option_label.get(o, o)} {n}" for o, n in election["tally"].items()
        )
        news = {
            "id": f"result-{spec.day or spec.round}",
            "neutral": True,
            "headline": headline,
            "description": f"The count: {tally}. Turnout {round(election.get('turnout', 0) * 100)}%.",
            "towns": [],
        }
        await self.event_bus.publish(
            NewsInjectedEvent(
                headline=news["headline"],
                description=news["description"],
                round=spec.round,
                news_id=news["id"],
                towns=[town],
            )
        )
        tasks = [
            self._react_to_news(agent, news, spec.round)
            for agent in agents
            if agent.state != CivicAgentState.ERROR
        ]
        await asyncio.gather(*tasks, return_exceptions=True)

    def _apply_event_effect(self, town: str, agents: list[AgentState], spec: RoundSpec) -> None:
        """Authored campaign events push the ledger directly (presence is Phase 7)."""
        event = spec.event or {}
        effect = event.get("effect") or {}
        kind = effect.get("kind")
        if not kind:
            return
        towns = effect.get("towns") or []
        if towns and town not in towns:
            return
        ref = f"event:{spec.day or spec.round}-{event.get('kind', 'event')}"
        rng = self._rng(f"event:{ref}", town, spec.round)
        for agent in agents:
            if agent.beliefs is None or agent.ballot is not None:
                continue
            if kind == "confidence":
                # A shared moment firms everyone up a little.
                agent.beliefs.evidence += 1
                top = self.model.readout(agent.beliefs).top
                if top:
                    self.model.apply_event(
                        agent,
                        top,
                        float(effect.get("delta", 4)) / 100.0,
                        spec.round,
                        ref,
                        note=event.get("label", ""),
                    )
            elif kind == "undecided_nudge":
                r = self.model.readout(agent.beliefs)
                if r.stance == self.scenario.undecided_id and r.top and rng.random() < 0.6:
                    self.model.apply_event(
                        agent,
                        r.top,
                        float(effect.get("delta", 0.15)),
                        spec.round,
                        ref,
                        note=event.get("label", ""),
                    )
            elif kind == "alignment":
                option, issue = effect.get("option"), effect.get("issue")
                delta = float(effect.get("delta", 0.0))
                if option in self.model.alignment and issue in self.model.alignment[option]:
                    self.model.alignment[option][issue] = max(
                        -1.0, min(1.0, self.model.alignment[option][issue] + delta)
                    )
                break  # alignment is global; apply once

    async def _cast_ballot(self, agent: AgentState, town: str, round_num: int) -> None:
        """Decision day: the ballot follows the ledger and the stated opinion;
        turnout is a seeded roll. Abstainers still count as decided."""
        rng = self._rng(f"ballot:{agent.agent_id}", town, round_num)
        ballot = self.model.ballot(agent, rng, round_num)
        agent.ballot = ballot
        agent.remember(
            "ballot",
            round_num,
            f"Round {round_num}: {'Voted ' + ballot.option if ballot.option else 'Did not cast a ballot'}. {ballot.reason}",
            refs=[],
            salience=0.6,
        )
        await self.event_bus.publish(
            BallotCastEvent(
                agent_id=agent.agent_id,
                agent_name=agent.definition.name,
                town=town,
                option=ballot.option,
                confidence=ballot.confidence,
                reason=ballot.reason,
                round=round_num,
            )
        )

    async def _run_news_round(
        self, agents: list[AgentState], news_events: list[dict], round_num: int
    ):
        """Inject news and get reactions from all agents."""
        logger.info(f"Running news round {round_num} with {len(news_events)} events")

        for news in news_events:
            await self.event_bus.publish(
                NewsInjectedEvent(
                    headline=news["headline"],
                    description=news["description"],
                    round=round_num,
                    news_id=news.get("id"),
                    towns=list(news.get("towns") or []),
                )
            )

            tasks = []
            neighbors = sorted(
                a.agent_id
                for a in agents
                if not self._is_voice(a) and a.state != CivicAgentState.ERROR
            )
            host = self._host_town(agents[0]) if agents else "*"
            news_key = news.get("id") or news["headline"][:16]
            speaker_id = (
                self._rng(f"news-voice:{news_key}", host, round_num).choice(neighbors)
                if neighbors
                else None
            )
            for agent in agents:
                if self._is_voice(agent):
                    tasks.append(self._react_to_news(agent, news, round_num))
                else:
                    tasks.append(
                        self._neighbor_news(
                            agent, news, round_num, speak=(agent.agent_id == speaker_id)
                        )
                    )
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _react_to_news(self, agent: AgentState, news: dict, round_num: int):
        """Get a single agent's reaction to a news event."""
        try:
            agent.state = CivicAgentState.OBSERVING
            news_id = news.get("id") or clip_text(news["headline"], 24).lower().replace(" ", "-")
            news_ref = f"news:{news_id}"
            item = self.scenario.news_by_id.get(news.get("id", ""))
            if item is None:
                item = _AdHocNews(
                    news["headline"], news.get("description", ""), neutral=bool(news.get("neutral"))
                )
            entries, derived = self.model.apply_news(
                agent, item, round_num, news_ref, salience=self.salience_for(self._host_town(agent))
            )
            self._note_topic(
                self._host_town(agent), f"{news['headline']} {news.get('description', '')}", 1.0
            )
            moved = sum(abs(e.delta) for e in entries)
            prior = {"phase": "news", **derived, "headline": news["headline"]}
            system_prompt = self._build_agent_system_prompt(agent, round_num=round_num)

            messages = [
                {
                    "role": "user",
                    "content": (
                        f"Breaking news that's affecting {self.scenario.title}:\n\n"
                        f"**{news['headline']}**\n\n"
                        f"{news['description']}\n\n"
                        f"React to this news based on how it affects you personally, "
                        f"your family, and your community. Use the ReactToNews tool."
                    ),
                }
            ]

            result = await self._call(
                prior=prior,
                system_prompt=system_prompt,
                messages=messages,
                tools=self._tools(["ReactToNews"]),
                max_tokens=1200,
                model=agent.definition.model,
            )

            if result.get("stop_reason") == "error":
                logger.error(
                    "News reaction errored for %s: %s", agent.agent_id, result.get("error")
                )
                agent.state = CivicAgentState.ERROR
                return

            if result["tool_use"] and result["tool_use"]["name"] == "ReactToNews":
                tool_input = result["tool_use"]["input"]
                emotional = tool_input.get("emotional_response", "indifferent")
                impact = tool_input.get("impact_on_vote", "no_effect")
                reasoning = tool_input.get("reasoning", "No strong reaction.")

                agent.remember(
                    "news",
                    round_num,
                    f"Round {round_num}: Heard news '{news['headline']}'. "
                    f"Felt {emotional}. Impact on vote: {impact}. {reasoning}",
                    refs=[news_ref],
                    salience=min(1.0, 0.4 + moved * 2),
                )

                # Speech bubble for the visible reaction
                sentiment = (
                    "negative"
                    if emotional in ("angry", "anxious")
                    else ("positive" if emotional == "hopeful" else "neutral")
                )
                await self.event_bus.publish(
                    AgentSpeechEvent(
                        agent_id=agent.agent_id,
                        agent_name=agent.definition.name,
                        town=self._host_town(agent),
                        text=f"Re: {clip_text(news['headline'], 50)} — {clip_text(reasoning, 100)}",
                        location=agent.current_location,
                        sentiment=sentiment,
                    )
                )

                # A structured NewsReactionEvent for the dashboard / news ticker
                try:
                    await self.event_bus.publish(
                        NewsReactionEvent(
                            reaction=NewsReaction(
                                agent_id=agent.agent_id,
                                agent_name=agent.definition.name,
                                town=self._host_town(agent),
                                headline=news["headline"],
                                event=news["headline"],
                                emotional_response=emotional,
                                impact_on_vote=impact,
                                reasoning=reasoning,
                            ),
                        )
                    )
                except Exception:  # pragma: no cover
                    pass

            agent.state = CivicAgentState.IDLE

        except Exception as e:
            logger.error(f"Error in news reaction for {agent.agent_id}: {e}")
            agent.state = CivicAgentState.ERROR

    async def _run_opinion_round(
        self, agents: list[AgentState], round_num: int, *, reflect: bool = False
    ):
        """Get updated FormOpinion from all agents (a week's reflection on Sundays)."""
        logger.info(f"Running opinion round {round_num}{' (reflect)' if reflect else ''}")

        tasks = []
        days_left_frac = self._days_left_frac()
        for agent in agents:
            if agent.ballot is not None:
                continue  # stances freeze once the ballot is in
            if agent.beliefs is not None and days_left_frac <= self.LATE_DECIDER_WINDOW:
                self.model.deadline_nudge(
                    agent.beliefs,
                    round_num,
                    self._rng(f"deadline:{agent.agent_id}", self._host_town(agent), round_num),
                    days_left_frac,
                )
            if self._is_voice(agent):
                tasks.append(self._form_opinion(agent, round_num, reflect=reflect))
            else:
                tasks.append(self._neighbor_opinion(agent, round_num, reflect=reflect))
        await asyncio.gather(*tasks, return_exceptions=True)

    async def _form_opinion(self, agent: AgentState, round_num: int, *, reflect: bool = False):
        """Get a single agent's updated opinion."""
        try:
            agent.state = CivicAgentState.REFLECTING
            system_prompt = self._build_agent_system_prompt(agent, round_num=round_num)

            # The reflection window: everything since the last read-out, with
            # bracketed ids the model may cite, and where the options stand.
            since = (agent.beliefs.last_reflection_round + 1) if agent.beliefs is not None else 0
            digest = attribution.build_digest(agent, since, self.model, round_num)
            prior = {**self.model.prior_for(agent, since), "phase": "opinion"}

            messages = [
                {
                    "role": "user",
                    "content": (
                        f"{'It is Sunday evening — take stock of the week.' if reflect else f'It is round {round_num} of the deliberation.'} "
                        f"Take a moment to reflect on everything you've heard and experienced.\n\n"
                        f"{digest}\n\n"
                        f"Now, considering all of this — your conversations, the news, your personal "
                        f"circumstances — update your opinion on the question: {self.scenario.question} "
                        f"Which option are you leaning toward and why? Use the FormOpinion tool."
                    ),
                }
            ]

            result = await self._call(
                prior=prior,
                system_prompt=system_prompt,
                messages=messages,
                tools=self._tools(["FormOpinion"]),
                max_tokens=1600,
                model=agent.definition.model,
            )

            if result.get("stop_reason") == "error":
                logger.error("Opinion call errored for %s: %s", agent.agent_id, result.get("error"))
                agent.state = CivicAgentState.ERROR
                return

            before = agent.current_opinion

            if result["tool_use"] and result["tool_use"]["name"] == "FormOpinion":
                tool_input = result["tool_use"]["input"]
                opinion = Opinion(
                    candidate=validate_stance(
                        tool_input.get(
                            "candidate",
                            before.candidate if before else self.scenario.undecided_id,
                        ),
                        self.scenario,
                    ),
                    confidence=tool_input.get("confidence", 50),
                    reasoning=tool_input.get("reasoning", "Reflecting on recent events."),
                    top_issues=tool_input.get("top_issues", agent.definition.top_concerns[:3]),
                    dealbreaker=tool_input.get("dealbreaker"),
                    round_number=round_num,
                )
                agent.opinions.append(opinion)

                # Causes: the model's own citations, validated against the
                # ledger; the ledger fills in when it cites nothing.
                influences, _cited = attribution.validate_influences(
                    tool_input.get("influences"), agent, since, opinion.candidate
                )
                if agent.beliefs is not None:
                    ledger_stance = self.model.readout(agent.beliefs).stance
                    self.divergence["checked"] += 1
                    if ledger_stance != opinion.candidate:
                        self.divergence["diverged"] += 1
                        logger.info(
                            "Ledger prior (%s) and stated stance (%s) diverge for %s in round %s",
                            ledger_stance,
                            opinion.candidate,
                            agent.agent_id,
                            round_num,
                        )
                        self.model.adopt_stance(
                            agent.beliefs,
                            opinion.candidate,
                            round_num,
                            f"reflection:r{round_num}",
                            note=f"settled on {opinion.candidate} after reflecting",
                        )
                    agent.beliefs.last_reflection_round = round_num
                    self.model.note_readout(agent.beliefs, opinion.candidate)
                reason = self._first_sentence(tool_input.get("reason") or opinion.reasoning)
                agent.remember(
                    "reflection",
                    round_num,
                    f"Round {round_num}: Updated opinion - now leaning {opinion.candidate} "
                    f"(confidence: {opinion.confidence}%). {reason}",
                    refs=[],
                    salience=0.5,
                )

                await self.event_bus.publish(
                    OpinionChangedEvent(
                        agent_id=agent.agent_id,
                        agent_name=agent.definition.name,
                        town=agent.definition.town,
                        old_opinion=before,
                        new_opinion=opinion,
                        round=round_num,
                        trigger=OpinionTrigger(kind="reflection")
                        if reflect
                        else self._trigger_for(influences, "reflection", agent),
                        influences=influences,
                        reason=reason,
                        delta_confidence=(opinion.confidence - before.confidence)
                        if before
                        else None,
                    )
                )

            agent.state = CivicAgentState.IDLE

        except Exception as e:
            logger.error(f"Error in opinion round for {agent.agent_id}: {e}")
            agent.state = CivicAgentState.ERROR

    def _build_agent_system_prompt(
        self, agent_state: AgentState, round_num: int | None = None
    ) -> str:
        """Compose full system prompt: persona + memories + opinions + scenario context."""
        parts = []

        # Base persona from markdown file
        parts.append(agent_state.definition.system_prompt)

        # Current scenario context
        parts.append("\n\n--- CONTEXT ---\n" + self.scenario.context_block())

        # Where they live and who they know (scenario data, never invented)
        town = self.town_data.get(agent_state.definition.town, {}) or {}
        town_line = town.get("name") or agent_state.definition.town
        pop = (town.get("demographics") or {}).get("population")
        character = town.get("character") or town.get("description")
        town_bits = [f"You live in {town_line}"]
        if pop:
            town_bits.append(f"population about {int(pop):,}")
        if character:
            town_bits.append(str(character))
        host = agent_state.current_town
        if host and host != agent_state.definition.town:
            host_name = (self.town_data.get(host, {}) or {}).get("name") or host
            town_bits.append(
                f"Today you are in {host_name} — the people around you live there, "
                "and what you hear there you carry home"
            )
        parts.append("\n\n--- YOUR TOWN ---\n" + ". ".join(town_bits) + ".")
        known = [
            r
            for r in agent_state.definition.relationships
            if isinstance(r, dict) and r.get("agent")
        ][:6]
        if known:
            lines = []
            for r in known:
                who = str(r.get("agent", "")).replace("-", " ").title()
                rel = r.get("type", "acquaintance")
                ctx = r.get("context")
                lines.append(f"- {who} ({rel})" + (f": {clip_text(str(ctx), 100)}" if ctx else ""))
            parts.append("\n\n--- PEOPLE YOU KNOW ---\n" + "\n".join(lines))

        # Recent memories
        recent = agent_state.get_recent_memories(10)
        if recent:
            parts.append(
                "\n\n--- YOUR RECENT EXPERIENCES ---\n" + "\n".join(f"- {m}" for m in recent)
            )

        # Current opinion
        opinion = agent_state.current_opinion
        if opinion:
            parts.append(
                f"\n\n--- YOUR CURRENT STANCE ---\n"
                f"You are currently leaning toward: {opinion.candidate} "
                f"(confidence: {opinion.confidence}%)\n"
                f"Reasoning: {opinion.reasoning}\n"
                f"Top issues: {', '.join(opinion.top_issues)}"
            )
            if opinion.dealbreaker:
                parts.append(f"Dealbreaker: {opinion.dealbreaker}")

        # ── Per-round goal (from agent definition frontmatter) ────────
        goals = agent_state.definition.goals
        if goals:
            # Resolve the effective round number: caller-supplied wins, else
            # last opinion's round, else 0.
            if round_num is None:
                round_num = agent_state.opinions[-1].round_number if agent_state.opinions else 0
            key = f"round_{round_num}"
            current_goal = goals.get(key)
            if current_goal:
                parts.append(f"\n\n--- YOUR GOAL THIS ROUND ---\n{current_goal}")

        # Instructions
        parts.append(
            "\n\n--- INSTRUCTIONS ---\n"
            "Stay completely in character. Speak in your own voice with your own speech patterns. "
            "Your opinions should reflect your real life circumstances, not abstract political theory. "
            "Reference specific local places, people, and experiences from your life. "
            "You can change your mind if you hear compelling arguments. "
            "Be authentic — if you're confused or torn, say so."
        )

        return "\n".join(parts)

    # ── Cross-Town Gossip Pairs (from the scenario manifest) ───

    def _create_cross_town_pairs(
        self, all_agent_states: dict[str, list[AgentState]]
    ) -> list[tuple[AgentState, AgentState, str]]:
        """
        Create strategic cross-town conversation pairs based on shared concerns.

        Returns a list of (agent_a, agent_b, connection_story) tuples.
        Falls back to random cross-town pairing if specific agents aren't found.
        """
        # Flatten all agents into a name->agent lookup
        all_agents: list[AgentState] = []
        name_lookup: dict[str, AgentState] = {}
        for town_agents in all_agent_states.values():
            for agent in town_agents:
                all_agents.append(agent)
                # Index by lowercase name for flexible matching
                name_lookup[agent.definition.name.lower()] = agent

        matched_pairs: list[tuple[AgentState, AgentState, str]] = []
        used_agents: set[str] = set()

        # Try to match the scenario's predefined strategic pairs
        for pair_def in self.scenario.config.cross_town_pairs:
            name_a, name_b = pair_def.agents
            agent_a = name_lookup.get(name_a.lower())
            agent_b = name_lookup.get(name_b.lower())

            if (
                agent_a
                and agent_b
                and agent_a.agent_id not in used_agents
                and agent_b.agent_id not in used_agents
            ):
                matched_pairs.append((agent_a, agent_b, pair_def.connection))
                used_agents.add(agent_a.agent_id)
                used_agents.add(agent_b.agent_id)

        # Fallback: pair remaining unmatched agents across towns (seeded)
        remaining = [a for a in all_agents if a.agent_id not in used_agents]
        self._rng("cross-town", "*", 0).shuffle(remaining)

        chance_connection = (
            f"They met by chance at {self.scenario.config.cross_town_meeting_place} and "
            f"discovered they share concerns about {self.scenario.title}."
        )
        for i in range(0, len(remaining) - 1, 2):
            a, b = remaining[i], remaining[i + 1]
            # Prefer cross-town pairs
            if a.definition.town != b.definition.town:
                matched_pairs.append((a, b, chance_connection))
            elif i + 2 < len(remaining) and remaining[i + 2].definition.town != a.definition.town:
                # Swap to get a cross-town pair
                remaining[i + 1], remaining[i + 2] = remaining[i + 2], remaining[i + 1]
                b = remaining[i + 1]
                matched_pairs.append((a, b, chance_connection))

        logger.info(
            f"Created {len(matched_pairs)} cross-town pairs ({len([p for p in matched_pairs if p[2] != ''])} with connection stories)"
        )
        return matched_pairs

    async def run_cross_town_conversation(
        self, agent_a: AgentState, agent_b: AgentState, connection_story: str, round_num: int
    ):
        """Run a cross-town conversation between two agents with connection context."""
        # Neutral meeting place shared by every town (from the scenario)
        location = self.scenario.config.cross_town_meeting_place
        agent_a.state = CivicAgentState.DISCUSSING
        agent_b.state = CivicAgentState.DISCUSSING

        # Pick a conversation topic based on shared concerns
        topic = self._pick_topic(agent_a, agent_b, "*", round_num)

        convo_id = uuid.uuid4().hex[:8]
        await self.event_bus.publish(
            ConversationStartedEvent(
                conversation=Conversation(
                    id=convo_id,
                    participants=[agent_a.agent_id, agent_b.agent_id],
                    participant_names=[agent_a.definition.name, agent_b.definition.name],
                    town=agent_a.definition.town,
                    location=location,
                    topic=topic,
                    summary="",
                    round=round_num,
                    timestamp=datetime.now(UTC).isoformat(),
                )
            )
        )

        dialogue_parts = []
        key_takeaways = {}
        partner_stances: dict[str, str] = {}
        sentiments: dict[str, str] = {}
        conv_ref = f"gossip:{convo_id}"

        # 3 exchanges: A speaks, B responds, A responds
        speakers = [agent_a, agent_b, agent_a]
        listeners = [agent_b, agent_a, agent_b]

        conversation_so_far = ""

        for i, (speaker, listener) in enumerate(zip(speakers, listeners, strict=True)):
            try:
                system_prompt = self._build_agent_system_prompt(speaker, round_num=round_num)
                speaker_stance = (
                    speaker.current_opinion.candidate
                    if speaker.current_opinion
                    else self.scenario.undecided_id
                )
                listener_stance = (
                    listener.current_opinion.candidate
                    if listener.current_opinion
                    else self.scenario.undecided_id
                )
                partner_stances[speaker.agent_id] = speaker_stance
                prior = {
                    "phase": "discuss",
                    "stance": speaker_stance,
                    "partner": listener.definition.name,
                    "partner_stance": listener_stance,
                    "agree": speaker_stance == listener_stance
                    and speaker_stance != self.scenario.undecided_id,
                    "topic": topic,
                }

                if i == 0:
                    user_msg = (
                        f"You run into {listener.definition.name} from {listener.definition.town}. "
                        f"Connection: {connection_story} "
                        f"You start talking about {self.scenario.title}, specifically about: {topic}. "
                        f"You know that {listener.definition.name} is a {listener.definition.occupation} "
                        f"from {listener.definition.town}. "
                        f"Start the conversation naturally, acknowledging you're from different towns. "
                        f"Use the Discuss tool to respond."
                    )
                else:
                    user_msg = (
                        f"You're talking with {listener.definition.name} from {listener.definition.town} "
                        f"about {self.scenario.title}.\n\n"
                        f"Conversation so far:\n{conversation_so_far}\n\n"
                        f"Continue the conversation naturally. You may have different perspectives "
                        f"since you live in different towns. Use the Discuss tool."
                    )

                result = await self._call(
                    prior=prior,
                    system_prompt=system_prompt,
                    messages=[{"role": "user", "content": user_msg}],
                    tools=self._tools(["Discuss"]),
                    max_tokens=1200,
                    model=speaker.definition.model,
                )

                if result.get("stop_reason") == "error":
                    logger.error(
                        "Cross-town exchange %d errored for %s: %s",
                        i,
                        speaker.agent_id,
                        result.get("error"),
                    )
                    speaker.state = CivicAgentState.ERROR
                    dialogue_parts.append(
                        f"{speaker.definition.name} ({speaker.definition.town}): [unavailable]"
                    )
                    conversation_so_far = "\n".join(dialogue_parts)
                elif result["tool_use"] and result["tool_use"]["name"] == "Discuss":
                    tool_input = result["tool_use"]["input"]
                    response_text = tool_input.get("response", result.get("text", "..."))
                    sentiment = tool_input.get("sentiment", "neutral")
                    takeaway = tool_input.get("key_takeaway", "")
                    gesture = tool_input.get("gesture")

                    dialogue_parts.append(
                        f"{speaker.definition.name} ({speaker.definition.town}): {response_text}"
                    )
                    conversation_so_far = "\n".join(dialogue_parts)
                    key_takeaways[speaker.definition.name] = takeaway
                    sentiments[speaker.agent_id] = sentiment

                    # Gossip lands at a quarter of the gain, and the listener
                    # carries the topic home to retell it.
                    entry = self.model.apply_gossip(listener, speaker, topic, round_num, conv_ref)
                    moved = abs(entry.delta) if entry else 0.0
                    if [topic, conv_ref] not in listener.pending_topics:
                        listener.pending_topics.append([topic, conv_ref])
                    speaker.remember(
                        "gossip",
                        round_num,
                        f"Round {round_num}: Cross-town talk with {listener.definition.name} "
                        f"from {listener.definition.town} about {topic}. "
                        f"Takeaway: {takeaway}",
                        refs=[conv_ref],
                        salience=0.5,
                    )
                    listener.remember(
                        "gossip",
                        round_num,
                        f"Round {round_num}: Heard from {speaker.definition.name} in {speaker.definition.town} "
                        f"({speaker_stance}): {clip_text(response_text, 120)}",
                        refs=[conv_ref],
                        salience=min(1.0, 0.45 + moved * 2),
                    )

                    await self.event_bus.publish(
                        AgentSpeechEvent(
                            agent_id=speaker.agent_id,
                            agent_name=speaker.definition.name,
                            town=speaker.definition.town,
                            text=clip_text(response_text, 150),
                            location=location,
                            sentiment=sentiment,
                            gesture=gesture,
                        )
                    )
                else:
                    text = result.get("text", "...")[:200]
                    dialogue_parts.append(
                        f"{speaker.definition.name} ({speaker.definition.town}): {text}"
                    )
                    conversation_so_far = "\n".join(dialogue_parts)

            except Exception as e:
                logger.error(
                    f"Error in cross-town conversation exchange {i} for {speaker.agent_id}: {e}"
                )
                dialogue_parts.append(f"{speaker.definition.name}: [conversation interrupted]")
                conversation_so_far = "\n".join(dialogue_parts)

        # Record the conversation for both agents (internal persisted format)
        convo = ConversationRecord(
            agents=[agent_a.agent_id, agent_b.agent_id],
            location=location,
            topic=topic,
            dialogue="\n".join(dialogue_parts),
            key_takeaways=key_takeaways,
            round_number=round_num,
            id=convo_id,
            partner_stances=partner_stances,
            sentiments=sentiments,
        )
        agent_a.conversations.append(convo)
        agent_b.conversations.append(convo)
        # Preserve ERROR state set by a failed exchange; otherwise return to idle.
        if agent_a.state != CivicAgentState.ERROR:
            agent_a.state = CivicAgentState.IDLE
        if agent_b.state != CivicAgentState.ERROR:
            agent_b.state = CivicAgentState.IDLE

        try:
            await self.event_bus.publish(
                ConversationEndedEvent(
                    conversation_id=convo_id,
                    summary=clip_text("; ".join(key_takeaways.values()), 200),
                )
            )
        except Exception:  # pragma: no cover
            pass

        # Publish a CrossTownGossipEvent for each direction so the frontend
        # (which already listens for `cross_town_gossip`) can show the
        # gossip-toast in the receiving town. The message is the speaker's
        # takeaway truncated to ~120 chars.
        try:
            takeaway_a = key_takeaways.get(agent_a.definition.name, "") or topic
            takeaway_b = key_takeaways.get(agent_b.definition.name, "") or topic
            await self.event_bus.publish(
                CrossTownGossipEvent(
                    from_town=agent_a.definition.town,
                    to_town=agent_b.definition.town,
                    from_agent=agent_a.agent_id,
                    to_agent=agent_b.agent_id,
                    message=clip_text(takeaway_a, 120),
                )
            )
            await self.event_bus.publish(
                CrossTownGossipEvent(
                    from_town=agent_b.definition.town,
                    to_town=agent_a.definition.town,
                    from_agent=agent_b.agent_id,
                    to_agent=agent_a.agent_id,
                    message=clip_text(takeaway_b, 120),
                )
            )
        except Exception:  # pragma: no cover
            pass

    # ── Who talks to whom, and where ────────────────────────────────

    @staticmethod
    def _relationship_strength(agent_a: AgentState, agent_b: AgentState) -> float:
        """Strongest declared tie between two residents (0 when none).

        Persona relationships name the other resident by id or by display
        name; both spellings are honoured, case-insensitively.
        """
        best = 0.0
        for src, dst in ((agent_a, agent_b), (agent_b, agent_a)):
            keys = {dst.agent_id.lower(), dst.definition.name.lower()}
            for rel in src.definition.relationships:
                target = str(rel.get("agent", "")).strip().lower()
                if target in keys:
                    try:
                        best = max(best, float(rel.get("strength", 0.5)))
                    except (TypeError, ValueError):
                        best = max(best, 0.5)
        # Ties that grew during the run count too.
        best = max(
            best,
            agent_a.relationships_dyn.get(agent_b.agent_id, 0.0),
            agent_b.relationships_dyn.get(agent_a.agent_id, 0.0),
        )
        return best

    def _recently_paired(self, town: str, key: frozenset[str], round_num: int) -> bool:
        history = self._recent_pairs.get(town, {})
        return any(key in history.get(r, set()) for r in (round_num - 1, round_num - 2))

    def _random_pairs(
        self, agents: list[AgentState], count: int = 3, round_num: int = 0
    ) -> list[tuple]:
        """Pair residents for a conversation round.

        Greedy maximum-weight matching over the authored social graph:
        declared relationships and shared concerns pull two people together,
        having just talked in the last two rounds pushes them apart, and a
        small seeded jitter keeps the town from repeating itself exactly.
        The name survives from the uniform-random era.
        """
        if len(agents) < 2:
            return []
        town = self._host_town(agents[0])
        rng = self._rng("pairs", town, round_num)
        ordered = sorted(agents, key=lambda a: a.agent_id)
        scored: list[tuple[float, str, str, AgentState, AgentState]] = []
        for i, a in enumerate(ordered):
            for b in ordered[i + 1 :]:
                key = frozenset((a.agent_id, b.agent_id))
                shared = set(a.definition.top_concerns) & set(b.definition.top_concerns)
                weight = 1.0
                weight += 2.0 * self._relationship_strength(a, b)
                weight += 0.5 * len(shared)
                if self._is_voice(a) and self._is_voice(b):
                    weight += 1.0  # the model's airtime goes to voice–voice pairs first
                sa = a.current_opinion.candidate if a.current_opinion else None
                sb = b.current_opinion.candidate if b.current_opinion else None
                if sa and sa == sb and sa != self.scenario.undecided_id:
                    weight += 0.8  # homophily: politics gets talked about among the like-minded
                if self._recently_paired(town, key, round_num):
                    weight -= 1.5
                weight += 0.5 * rng.random()
                scored.append((weight, a.agent_id, b.agent_id, a, b))
        scored.sort(key=lambda row: (-row[0], row[1], row[2]))

        used: set[str] = set()
        pairs: list[tuple[AgentState, AgentState]] = []
        for _, id_a, id_b, a, b in scored:
            if id_a in used or id_b in used:
                continue
            pairs.append((a, b))
            used.update((id_a, id_b))
            if len(pairs) >= count:
                break

        history = self._recent_pairs.setdefault(town, {}).setdefault(round_num, set())
        for a, b in pairs:
            history.add(frozenset((a.agent_id, b.agent_id)))
        return pairs

    def _pick_topic(
        self, agent_a: AgentState, agent_b: AgentState, town: str, round_num: int
    ) -> str:
        shared = sorted(set(agent_a.definition.top_concerns) & set(agent_b.definition.top_concerns))
        rng = self._rng(f"topic:{agent_a.agent_id}:{agent_b.agent_id}", town, round_num)
        # Something heard from another town gets retold half the time (and
        # then it is spent: gossip travels one more hop, not forever).
        pending = [(a, t) for a in (agent_a, agent_b) for t in a.pending_topics]
        if pending and rng.random() < 0.5:
            holder, item = pending[rng.randrange(len(pending))]
            holder.pending_topics.remove(item)
            return item[0]
        if shared:
            return rng.choice(shared)
        return rng.choice(agent_a.definition.top_concerns + agent_b.definition.top_concerns)

    @staticmethod
    def _routine_stop(agent: AgentState, clock: tuple[int, int] | None) -> str | None:
        """Where the persona's routine has them at ``clock`` (the latest stop
        at or before that time; the day's last stop before its first)."""
        entries = agent.definition.routine
        if not entries:
            return None
        if clock is None:
            return str(entries[0].get("location") or "") or None
        target = clock[0] * 60 + clock[1]
        best: tuple[int, str] | None = None
        latest: tuple[int, str] | None = None
        for entry in entries:
            try:
                hh, mm = str(entry.get("time", "")).split(":")
                minutes = int(hh) * 60 + int(mm)
            except ValueError:
                continue
            location = str(entry.get("location") or "").strip()
            if not location:
                continue
            if minutes <= target and (best is None or minutes > best[0]):
                best = (minutes, location)
            if latest is None or minutes > latest[0]:
                latest = (minutes, location)
        chosen = best or latest
        return chosen[1] if chosen else None

    _MIDDAY_PLACES = re.compile(
        r"restaurant|diner|caf[eé]|bodega|library|coffee|deli|pizz|bakery|market|grill",
        re.IGNORECASE,
    )
    _EVENING_PLACES = re.compile(
        r"park|church|temple|congregational|station|transit|green|commons|square|plaza",
        re.IGNORECASE,
    )
    _MIDDAY_TYPES = {"restaurant", "cafe", "library", "shop", "commercial"}
    _EVENING_TYPES = {"park", "church", "religious", "transport", "transit"}

    def _meeting_place(
        self,
        town: str,
        agent_a: AgentState,
        agent_b: AgentState,
        clock: tuple[int, int] | None,
        round_num: int = 0,
    ) -> str:
        """Where two residents meet, read off their routines and the clock.

        Both at the same stop → they talk there. Otherwise the hour picks a
        kind of place — lunch spots through the afternoon, parks, churches
        and the station in the evening — preferring one of the pair's own
        stops when it fits, then the initiator's stop, then any landmark.
        """
        stop_a = self._stop_in(agent_a, clock, town)
        stop_b = self._stop_in(agent_b, clock, town)
        known = lambda name: name is not None and self._get_landmark(town, name) is not None  # noqa: E731
        if stop_a and stop_a == stop_b and known(stop_a):
            return stop_a

        hour = clock[0] if clock else 12
        if 11 <= hour < 17:
            pattern, types = self._MIDDAY_PLACES, self._MIDDAY_TYPES
        elif hour >= 17:
            pattern, types = self._EVENING_PLACES, self._EVENING_TYPES
        else:
            pattern, types = None, set()

        if pattern is not None:
            fits = lambda lm: bool(  # noqa: E731
                pattern.search(str(lm.get("name", ""))) or str(lm.get("type", "")).lower() in types
            )
            for stop in (stop_a, stop_b):
                lm = self._get_landmark(town, stop) if stop else None
                if lm is not None and fits(lm):
                    return str(lm["name"])
            pool = sorted(
                str(lm["name"])
                for lm in self.town_data.get(town, {}).get("landmarks", [])
                if fits(lm)
            )
            if pool:
                rng = self._rng(f"meet:{agent_a.agent_id}:{agent_b.agent_id}", town, round_num)
                return rng.choice(pool)

        for stop in (stop_a, stop_b):
            if stop and known(stop):
                return stop
        return self._pick_location(town)

    def _pick_location(self, town: str) -> str:
        """Pick a landmark for an arrival or a conversation with no better
        anchor. Seeded per (town, round, draw) so it stays deterministic."""
        self._draws += 1
        rng = self._rng(f"location:{self._draws}", town, self._current_round.get(town, 0))
        town_info = self.town_data.get(town, {})
        landmarks = town_info.get("landmarks", [])
        if landmarks:
            return rng.choice(landmarks)["name"]
        # Fallback locations
        return rng.choice(["Town Center", "Main Street", "Community Center", "Local Park"])

    def _get_landmark(self, town: str, location_name: str) -> dict | None:
        """Get landmark data by name."""
        town_info = self.town_data.get(town, {})
        landmarks = town_info.get("landmarks", [])
        for lm in landmarks:
            if lm["name"] == location_name:
                return lm
        return None

    def _build_town_summary(
        self,
        town: str,
        agents: list[AgentState],
        total_conversations: int,
        rounds_completed: int,
    ) -> TownSummary:
        """Build summary of town simulation results."""
        # Opinion distribution — seeded with every valid stance so the wire
        # always carries the full roster (zeros included).
        opinion_dist: dict[str, int] = {s: 0 for s in self.scenario.valid_stance_ids}
        all_issues: dict[str, int] = {}
        agent_summaries = []
        failed_agents = 0

        for agent in agents:
            if agent.state == CivicAgentState.ERROR:
                failed_agents += 1

            final_opinion = agent.current_opinion
            if final_opinion:
                # Defensive: tolerate an unexpected candidate value mid-run.
                opinion_dist[final_opinion.candidate] = (
                    opinion_dist.get(final_opinion.candidate, 0) + 1
                )
                for issue in final_opinion.top_issues:
                    all_issues[issue] = all_issues.get(issue, 0) + 1
            else:
                undecided = self.scenario.undecided_id
                opinion_dist[undecided] = opinion_dist.get(undecided, 0) + 1

            agent_summaries.append(
                {
                    "agent_id": agent.agent_id,
                    "name": agent.definition.name,
                    "occupation": agent.definition.occupation,
                    "final_candidate": final_opinion.candidate
                    if final_opinion
                    else self.scenario.undecided_id,
                    "final_confidence": final_opinion.confidence if final_opinion else 0,
                    "final_reasoning": final_opinion.reasoning if final_opinion else "",
                    "opinion_trajectory": [
                        {
                            "candidate": o.candidate,
                            "confidence": o.confidence,
                            "round": o.round_number,
                        }
                        for o in agent.opinions
                    ],
                    "total_memories": len(agent.memories),
                    "total_conversations": len(agent.conversations),
                }
            )

        # Sort issues by frequency, compute importance as fraction
        total_agents = len(agents) or 1
        top_issues = sorted(
            [{"issue": k, "importance": round(v / total_agents, 2)} for k, v in all_issues.items()],
            key=lambda x: x["importance"],
            reverse=True,
        )[:10]

        return TownSummary(
            town=town,
            opinion_distribution=opinion_dist,
            top_issues=top_issues,
            agent_summaries=agent_summaries,
            total_conversations=total_conversations,
            rounds_completed=rounds_completed,
            failed_agents=failed_agents,
            election=self._election_for(agents, opinion_dist),
            notable_conversations=self._notable_conversations(agents),
            consensus_points=self._consensus_points(agents),
            by_tier=self._by_tier(agents),
        )

    def _by_tier(self, agents: list[AgentState]) -> dict[str, dict[str, int]]:
        """Stance counts per tier so voices stay separable from the background."""
        out: dict[str, dict[str, int]] = {}
        undecided = self.scenario.undecided_id
        for a in agents:
            tier = getattr(a.definition, "tier", "voice")
            bucket = out.setdefault(tier, dict.fromkeys(self.scenario.valid_stance_ids, 0))
            c = a.current_opinion.candidate if a.current_opinion else undecided
            bucket[c] = bucket.get(c, 0) + 1
        return out

    def _election_for(self, agents: list[AgentState], opinion_dist: dict[str, int]) -> dict:
        """Ballot tally when ballots were cast, else the standing straw poll."""
        undecided = self.scenario.undecided_id
        voted = [a for a in agents if a.ballot is not None]
        if voted:
            tally = {o: 0 for o in self.scenario.option_ids}
            abstained = 0
            for a in voted:
                if a.ballot.option and a.ballot.option in tally:
                    tally[a.ballot.option] += 1
                else:
                    abstained += 1
            mode = "ballots"
            eligible = len([a for a in agents if a.state != CivicAgentState.ERROR])
            turnout = (len(voted) - abstained) / eligible if eligible else 0.0
            undecided_n = 0
        else:
            tally = {o: opinion_dist.get(o, 0) for o in self.scenario.option_ids}
            abstained = 0
            mode = "straw_poll"
            eligible = len(agents)
            turnout = 0.0
            undecided_n = opinion_dist.get(undecided, 0)
        ranked = sorted(tally.values(), reverse=True)
        top = ranked[0] if ranked else 0
        second = ranked[1] if len(ranked) > 1 else 0
        leaders = [o for o, n in tally.items() if n == top and top > 0]
        decided_total = sum(tally.values())
        return {
            "mode": mode,
            "tally": tally,
            "winner": leaders[0] if len(leaders) == 1 else None,
            "margin": top - second,
            "margin_pct": round((top - second) / decided_total, 4) if decided_total else 0.0,
            "turnout": round(turnout, 4),
            "undecided": undecided_n,
            "abstained": abstained,
            "eligible": eligible,
        }

    def _notable_conversations(self, agents: list[AgentState], limit: int = 3) -> list[str]:
        """The conversations whose arguments moved people most, as one line each."""
        moved: dict[str, float] = {}
        records: dict[str, ConversationRecord] = {}
        names = {a.agent_id: a.definition.name for a in agents}
        for a in agents:
            for c in a.conversations:
                if c.id:
                    records.setdefault(c.id, c)
            if a.beliefs is None:
                continue
            for e in a.beliefs.ledger:
                if e.kind in ("conversation", "gossip") and ":" in e.ref:
                    key = e.ref.split(":", 1)[1]
                    moved[key] = moved.get(key, 0.0) + abs(e.delta)
        out = []
        for cid, total in sorted(moved.items(), key=lambda kv: -kv[1]):
            rec = records.get(cid)
            if rec is None or total <= 0:
                continue
            who = " & ".join(names.get(x, x.replace("-", " ").title()) for x in rec.agents)
            out.append(f"{who} at {rec.location} (r{rec.round_number}): {clip_text(rec.topic, 60)}")
            if len(out) >= limit:
                break
        return out

    def _consensus_points(self, agents: list[AgentState], share: float = 0.7) -> list[str]:
        """Issues most residents rank among their top concerns right now."""
        counts: dict[str, int] = {}
        labels = {i.id: i.label for i in self.model.issues}
        n = 0
        for a in agents:
            op = a.current_opinion
            if not op:
                continue
            n += 1
            seen = set()
            for text in op.top_issues:
                iid = self.model.match_issue(text)
                if iid and iid not in seen:
                    seen.add(iid)
                    counts[iid] = counts.get(iid, 0) + 1
        if not n:
            return []
        return [
            labels.get(i, i)
            for i, c in sorted(counts.items(), key=lambda kv: -kv[1])
            if c / n >= share
        ][:5]
