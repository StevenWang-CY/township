import asyncio
import logging
import random
import uuid
from datetime import UTC, datetime

from ..core.event_bus import EventBus
from ..core.scenario import Scenario, validate_stance
from ..core.types import (
    AgentMovedEvent,
    AgentSpeechEvent,
    AgentState,
    CivicAgentState,
    Conversation,
    ConversationEndedEvent,
    ConversationRecord,
    ConversationStartedEvent,
    CrossTownGossipEvent,
    NewsInjectedEvent,
    NewsReaction,
    NewsReactionEvent,
    Opinion,
    OpinionChangedEvent,
    RoundEndedEvent,
    RoundStartedEvent,
    TownSummary,
    WorldClockTickEvent,
)
from ..core.wire import town_summary_to_wire
from ..tools.schemas import build_tools

logger = logging.getLogger(__name__)


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
    ):
        self.client = anthropic_client
        self.event_bus = event_bus
        self.scenario = scenario
        self.town_data = scenario.towns
        self._tool_registry = build_tools(scenario)

    def _tools(self, names: list[str]) -> list[dict]:
        return [self._tool_registry[n] for n in names if n in self._tool_registry]

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

        news_by_id = self.scenario.news_by_id
        total_conversations = 0

        for spec in specs:
            round_num = spec.round
            await self.event_bus.publish(RoundStartedEvent(
                round=round_num,
                town=town,
                total_rounds=num_rounds,
            ))

            # Emit a world-clock tick once per round (cosmetic on the frontend)
            hour, minute = spec.clock_tuple()
            await self.event_bus.publish(WorldClockTickEvent(
                hour=hour, minute=minute, town=town,
            ))

            # Phases run in the order the scenario declares them.
            for phase in spec.phases:
                if phase == "seed":
                    await self._run_seed_round(agent_states, round_num)
                elif phase == "converse":
                    convos = await self._run_conversation_round(agent_states, round_num)
                    total_conversations += convos
                elif phase == "news":
                    news_events = [
                        {"headline": news_by_id[i].headline, "description": news_by_id[i].description}
                        for i in spec.news_ids
                        if i in news_by_id
                    ]
                    if news_events:
                        await self._run_news_round(agent_states, news_events, round_num)
                elif phase == "opinion":
                    await self._run_opinion_round(agent_states, round_num)
                elif phase == "decide":
                    # Mark all (non-errored) agents as decided
                    for agent in agent_states:
                        if agent.state != CivicAgentState.ERROR:
                            agent.state = CivicAgentState.DECIDED

            # Emit a per-town RoundEndedEvent so the frontend can update HUD/timeline.
            # _build_town_summary is safe to call mid-run — it aggregates whatever
            # opinions the agents currently hold.
            await self.event_bus.publish(RoundEndedEvent(
                round=round_num,
                town=town,
                summary=[town_summary_to_wire(
                    self._build_town_summary(town, agent_states, total_conversations, round_num + 1)
                )],
            ))

        # Build town summary
        return self._build_town_summary(town, agent_states, total_conversations, num_rounds)

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
            agent.add_memory(
                f"Round {round_num}: Learned about {self.scenario.title} and where the options stand."
            )

            # Move agent to a starting location
            town = agent.definition.town
            from_location = agent.current_location
            location = self._pick_location(town)
            agent.current_location = location
            landmark = self._get_landmark(town, location)
            if landmark:
                await self.event_bus.publish(AgentMovedEvent(
                    agent_id=agent.agent_id,
                    agent_name=agent.definition.name,
                    town=town,
                    from_location=from_location,
                    to_location=location,
                    x=landmark.get("x", 400),
                    y=landmark.get("y", 300),
                ))

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

            result = await self.client.call_agent(
                system_prompt=system_prompt,
                messages=messages,
                tools=self._tools(["FormOpinion"]),
                max_tokens=1600,
                model=agent.definition.model,
            )

            # Genuine LLM/transport failure — mark ERROR, do NOT mint a
            # confident fallback opinion.
            if result.get("stop_reason") == "error":
                logger.error(
                    "Seed call errored for %s: %s", agent.agent_id, result.get("error")
                )
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
                    reasoning=tool_input.get("reasoning", "Initial impression based on what I've heard."),
                    top_issues=tool_input.get("top_issues", agent.definition.top_concerns[:3]),
                    dealbreaker=tool_input.get("dealbreaker"),
                    round_number=round_num,
                )
                agent.opinions.append(opinion)
                agent.add_memory(
                    f"Round {round_num}: Formed initial opinion - leaning {opinion.candidate} "
                    f"(confidence: {opinion.confidence}%). Reasoning: {opinion.reasoning}"
                )
                await self.event_bus.publish(OpinionChangedEvent(
                    agent_id=agent.agent_id,
                    agent_name=agent.definition.name,
                    town=agent.definition.town,
                    old_opinion=None,
                    new_opinion=opinion,
                ))
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
                agent.opinions.append(Opinion(
                    candidate=validate_stance(agent.definition.initial_lean, self.scenario),
                    confidence=20,
                    reasoning="Still figuring things out.",
                    top_issues=agent.definition.top_concerns[:3],
                    round_number=round_num,
                ))

    async def _run_conversation_round(self, agents: list[AgentState], round_num: int) -> int:
        """Pair agents randomly, run discussions at town locations. Returns number of conversations."""
        pairs = self._random_pairs(agents, count=max(1, len(agents) // 2))
        logger.info(f"Running conversation round {round_num} with {len(pairs)} pairs")

        tasks = []
        for agent_a, agent_b in pairs:
            tasks.append(self._run_conversation(agent_a, agent_b, round_num))

        results = await asyncio.gather(*tasks, return_exceptions=True)
        return sum(1 for r in results if not isinstance(r, Exception))

    async def _run_conversation(self, agent_a: AgentState, agent_b: AgentState, round_num: int):
        """Run a 3-exchange conversation between two agents."""
        town = agent_a.definition.town
        location = self._pick_location(town)
        agent_a.current_location = location
        agent_b.current_location = location
        agent_a.state = CivicAgentState.DISCUSSING
        agent_b.state = CivicAgentState.DISCUSSING

        landmark = self._get_landmark(town, location)
        lx = landmark.get("x", 400) if landmark else 400
        ly = landmark.get("y", 300) if landmark else 300

        # Move both agents to location
        await self.event_bus.publish(AgentMovedEvent(
            agent_id=agent_a.agent_id,
            agent_name=agent_a.definition.name,
            town=town,
            from_location=agent_a.current_location,
            to_location=location,
            x=lx - 30, y=ly,
        ))
        await self.event_bus.publish(AgentMovedEvent(
            agent_id=agent_b.agent_id,
            agent_name=agent_b.definition.name,
            town=town,
            from_location=agent_b.current_location,
            to_location=location,
            x=lx + 30, y=ly,
        ))

        # Pick a conversation topic based on shared concerns
        shared_concerns = set(agent_a.definition.top_concerns) & set(agent_b.definition.top_concerns)
        if shared_concerns:
            topic = random.choice(list(shared_concerns))
        else:
            all_concerns = agent_a.definition.top_concerns + agent_b.definition.top_concerns
            topic = random.choice(all_concerns)

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
        await self.event_bus.publish(ConversationStartedEvent(
            conversation=wire_conversation,
        ))

        dialogue_parts = []
        key_takeaways = {}

        # 3 exchanges: A speaks, B responds, A responds
        speakers = [agent_a, agent_b, agent_a]
        listeners = [agent_b, agent_a, agent_b]

        conversation_so_far = ""

        for i, (speaker, listener) in enumerate(zip(speakers, listeners, strict=True)):
            try:
                system_prompt = self._build_agent_system_prompt(speaker, round_num=round_num)

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

                result = await self.client.call_agent(
                    system_prompt=system_prompt,
                    messages=[{"role": "user", "content": user_msg}],
                    tools=self._tools(["Discuss"]),
                    max_tokens=1200,
                    model=speaker.definition.model,
                )

                if result.get("stop_reason") == "error":
                    logger.error(
                        "Conversation exchange %d errored for %s: %s",
                        i, speaker.agent_id, result.get("error"),
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

                    speaker.add_memory(
                        f"Round {round_num}: Talked with {listener.definition.name} at {location} about {topic}. "
                        f"Takeaway: {takeaway}"
                    )

                    await self.event_bus.publish(AgentSpeechEvent(
                        agent_id=speaker.agent_id,
                        agent_name=speaker.definition.name,
                        town=town,
                        text=response_text[:150],
                        location=location,
                        sentiment=sentiment,
                        gesture=gesture,
                    ))
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
        )
        agent_a.conversations.append(convo)
        agent_b.conversations.append(convo)
        # Preserve ERROR state set by a failed exchange; otherwise return to idle.
        if agent_a.state != CivicAgentState.ERROR:
            agent_a.state = CivicAgentState.IDLE
        if agent_b.state != CivicAgentState.ERROR:
            agent_b.state = CivicAgentState.IDLE

        # Emit a ConversationEnded so the frontend can finalize bubbles / log entry
        try:
            await self.event_bus.publish(ConversationEndedEvent(
                conversation_id=convo_id,
                summary="; ".join(key_takeaways.values())[:200],
            ))
        except Exception:  # pragma: no cover — defensive
            pass

    async def _run_news_round(self, agents: list[AgentState], news_events: list[dict], round_num: int):
        """Inject news and get reactions from all agents."""
        logger.info(f"Running news round {round_num} with {len(news_events)} events")

        for news in news_events:
            await self.event_bus.publish(NewsInjectedEvent(
                headline=news["headline"],
                description=news["description"],
                round=round_num,
            ))

            tasks = []
            for agent in agents:
                tasks.append(self._react_to_news(agent, news, round_num))
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _react_to_news(self, agent: AgentState, news: dict, round_num: int):
        """Get a single agent's reaction to a news event."""
        try:
            agent.state = CivicAgentState.OBSERVING
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

            result = await self.client.call_agent(
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

                agent.add_memory(
                    f"Round {round_num}: Heard news '{news['headline']}'. "
                    f"Felt {emotional}. Impact on vote: {impact}. {reasoning}"
                )

                # Speech bubble for the visible reaction
                sentiment = (
                    "negative" if emotional in ("angry", "anxious")
                    else ("positive" if emotional == "hopeful" else "neutral")
                )
                await self.event_bus.publish(AgentSpeechEvent(
                    agent_id=agent.agent_id,
                    agent_name=agent.definition.name,
                    town=agent.definition.town,
                    text=f"Re: {news['headline'][:50]}... - {reasoning[:100]}",
                    location=agent.current_location,
                    sentiment=sentiment,
                ))

                # A structured NewsReactionEvent for the dashboard / news ticker
                try:
                    await self.event_bus.publish(NewsReactionEvent(
                        reaction=NewsReaction(
                            agent_id=agent.agent_id,
                            agent_name=agent.definition.name,
                            town=agent.definition.town,
                            headline=news["headline"],
                            event=news["headline"],
                            emotional_response=emotional,
                            impact_on_vote=impact,
                            reasoning=reasoning,
                        ),
                    ))
                except Exception:  # pragma: no cover
                    pass

            agent.state = CivicAgentState.IDLE

        except Exception as e:
            logger.error(f"Error in news reaction for {agent.agent_id}: {e}")
            agent.state = CivicAgentState.ERROR

    async def _run_opinion_round(self, agents: list[AgentState], round_num: int):
        """Get updated FormOpinion from all agents."""
        logger.info(f"Running opinion round {round_num}")

        tasks = []
        for agent in agents:
            tasks.append(self._form_opinion(agent, round_num))
        await asyncio.gather(*tasks, return_exceptions=True)

    async def _form_opinion(self, agent: AgentState, round_num: int):
        """Get a single agent's updated opinion."""
        try:
            agent.state = CivicAgentState.REFLECTING
            system_prompt = self._build_agent_system_prompt(agent, round_num=round_num)

            # Build context about recent conversations and memories
            recent_memories = agent.get_recent_memories(10)
            memories_text = "\n".join(f"- {m}" for m in recent_memories) if recent_memories else "No recent events."

            messages = [
                {
                    "role": "user",
                    "content": (
                        f"It's round {round_num} of the deliberation. Take a moment to reflect "
                        f"on everything you've heard and experienced:\n\n"
                        f"Recent experiences:\n{memories_text}\n\n"
                        f"Now, considering all of this — your conversations, the news, your personal "
                        f"circumstances — update your opinion on the question: {self.scenario.question} "
                        f"Which option are you leaning toward and why? Use the FormOpinion tool."
                    ),
                }
            ]

            result = await self.client.call_agent(
                system_prompt=system_prompt,
                messages=messages,
                tools=self._tools(["FormOpinion"]),
                max_tokens=1400,
                model=agent.definition.model,
            )

            if result.get("stop_reason") == "error":
                logger.error(
                    "Opinion call errored for %s: %s", agent.agent_id, result.get("error")
                )
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
                agent.add_memory(
                    f"Round {round_num}: Updated opinion - now leaning {opinion.candidate} "
                    f"(confidence: {opinion.confidence}%). {opinion.reasoning}"
                )

                await self.event_bus.publish(OpinionChangedEvent(
                    agent_id=agent.agent_id,
                    agent_name=agent.definition.name,
                    town=agent.definition.town,
                    old_opinion=before,
                    new_opinion=opinion,
                ))

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

        # Recent memories
        recent = agent_state.get_recent_memories(10)
        if recent:
            parts.append(
                "\n\n--- YOUR RECENT EXPERIENCES ---\n"
                + "\n".join(f"- {m}" for m in recent)
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
                round_num = (
                    agent_state.opinions[-1].round_number if agent_state.opinions else 0
                )
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

            if agent_a and agent_b and agent_a.agent_id not in used_agents and agent_b.agent_id not in used_agents:
                matched_pairs.append((agent_a, agent_b, pair_def.connection))
                used_agents.add(agent_a.agent_id)
                used_agents.add(agent_b.agent_id)

        # Fallback: pair remaining unmatched agents across towns randomly
        remaining = [a for a in all_agents if a.agent_id not in used_agents]
        random.shuffle(remaining)

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

        logger.info(f"Created {len(matched_pairs)} cross-town pairs ({len([p for p in matched_pairs if p[2] != ''])} with connection stories)")
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
        shared_concerns = set(agent_a.definition.top_concerns) & set(agent_b.definition.top_concerns)
        if shared_concerns:
            topic = random.choice(list(shared_concerns))
        else:
            all_concerns = agent_a.definition.top_concerns + agent_b.definition.top_concerns
            topic = random.choice(all_concerns)

        convo_id = uuid.uuid4().hex[:8]
        await self.event_bus.publish(ConversationStartedEvent(
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
        ))

        dialogue_parts = []
        key_takeaways = {}

        # 3 exchanges: A speaks, B responds, A responds
        speakers = [agent_a, agent_b, agent_a]
        listeners = [agent_b, agent_a, agent_b]

        conversation_so_far = ""

        for i, (speaker, listener) in enumerate(zip(speakers, listeners, strict=True)):
            try:
                system_prompt = self._build_agent_system_prompt(speaker, round_num=round_num)

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

                result = await self.client.call_agent(
                    system_prompt=system_prompt,
                    messages=[{"role": "user", "content": user_msg}],
                    tools=self._tools(["Discuss"]),
                    max_tokens=1200,
                    model=speaker.definition.model,
                )

                if result.get("stop_reason") == "error":
                    logger.error(
                        "Cross-town exchange %d errored for %s: %s",
                        i, speaker.agent_id, result.get("error"),
                    )
                    speaker.state = CivicAgentState.ERROR
                    dialogue_parts.append(f"{speaker.definition.name} ({speaker.definition.town}): [unavailable]")
                    conversation_so_far = "\n".join(dialogue_parts)
                elif result["tool_use"] and result["tool_use"]["name"] == "Discuss":
                    tool_input = result["tool_use"]["input"]
                    response_text = tool_input.get("response", result.get("text", "..."))
                    sentiment = tool_input.get("sentiment", "neutral")
                    takeaway = tool_input.get("key_takeaway", "")
                    gesture = tool_input.get("gesture")

                    dialogue_parts.append(f"{speaker.definition.name} ({speaker.definition.town}): {response_text}")
                    conversation_so_far = "\n".join(dialogue_parts)
                    key_takeaways[speaker.definition.name] = takeaway

                    speaker.add_memory(
                        f"Round {round_num}: Cross-town talk with {listener.definition.name} "
                        f"from {listener.definition.town} about {topic}. "
                        f"Takeaway: {takeaway}"
                    )

                    await self.event_bus.publish(AgentSpeechEvent(
                        agent_id=speaker.agent_id,
                        agent_name=speaker.definition.name,
                        town=speaker.definition.town,
                        text=response_text[:150],
                        location=location,
                        sentiment=sentiment,
                        gesture=gesture,
                    ))
                else:
                    text = result.get("text", "...")[:200]
                    dialogue_parts.append(f"{speaker.definition.name} ({speaker.definition.town}): {text}")
                    conversation_so_far = "\n".join(dialogue_parts)

            except Exception as e:
                logger.error(f"Error in cross-town conversation exchange {i} for {speaker.agent_id}: {e}")
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
        )
        agent_a.conversations.append(convo)
        agent_b.conversations.append(convo)
        # Preserve ERROR state set by a failed exchange; otherwise return to idle.
        if agent_a.state != CivicAgentState.ERROR:
            agent_a.state = CivicAgentState.IDLE
        if agent_b.state != CivicAgentState.ERROR:
            agent_b.state = CivicAgentState.IDLE

        try:
            await self.event_bus.publish(ConversationEndedEvent(
                conversation_id=convo_id,
                summary="; ".join(key_takeaways.values())[:200],
            ))
        except Exception:  # pragma: no cover
            pass

        # Publish a CrossTownGossipEvent for each direction so the frontend
        # (which already listens for `cross_town_gossip`) can show the
        # gossip-toast in the receiving town. The message is the speaker's
        # takeaway truncated to ~120 chars.
        try:
            takeaway_a = key_takeaways.get(agent_a.definition.name, "") or topic
            takeaway_b = key_takeaways.get(agent_b.definition.name, "") or topic
            await self.event_bus.publish(CrossTownGossipEvent(
                from_town=agent_a.definition.town,
                to_town=agent_b.definition.town,
                from_agent=agent_a.agent_id,
                to_agent=agent_b.agent_id,
                message=takeaway_a[:120],
            ))
            await self.event_bus.publish(CrossTownGossipEvent(
                from_town=agent_b.definition.town,
                to_town=agent_a.definition.town,
                from_agent=agent_b.agent_id,
                to_agent=agent_a.agent_id,
                message=takeaway_b[:120],
            ))
        except Exception:  # pragma: no cover
            pass

    def _random_pairs(self, agents: list[AgentState], count: int = 3) -> list[tuple]:
        """Create random conversation pairs from agent list."""
        if len(agents) < 2:
            return []

        shuffled = list(agents)
        random.shuffle(shuffled)

        pairs = []
        for i in range(0, len(shuffled) - 1, 2):
            pairs.append((shuffled[i], shuffled[i + 1]))
            if len(pairs) >= count:
                break

        return pairs

    def _pick_location(self, town: str) -> str:
        """Pick a random landmark location for a conversation."""
        town_info = self.town_data.get(town, {})
        landmarks = town_info.get("landmarks", [])
        if landmarks:
            return random.choice(landmarks)["name"]
        # Fallback locations
        return random.choice(["Town Center", "Main Street", "Community Center", "Local Park"])

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
                opinion_dist[final_opinion.candidate] = opinion_dist.get(final_opinion.candidate, 0) + 1
                for issue in final_opinion.top_issues:
                    all_issues[issue] = all_issues.get(issue, 0) + 1
            else:
                undecided = self.scenario.undecided_id
                opinion_dist[undecided] = opinion_dist.get(undecided, 0) + 1

            agent_summaries.append({
                "agent_id": agent.agent_id,
                "name": agent.definition.name,
                "occupation": agent.definition.occupation,
                "final_candidate": final_opinion.candidate if final_opinion else self.scenario.undecided_id,
                "final_confidence": final_opinion.confidence if final_opinion else 0,
                "final_reasoning": final_opinion.reasoning if final_opinion else "",
                "opinion_trajectory": [
                    {"candidate": o.candidate, "confidence": o.confidence, "round": o.round_number}
                    for o in agent.opinions
                ],
                "total_memories": len(agent.memories),
                "total_conversations": len(agent.conversations),
            })

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
        )
