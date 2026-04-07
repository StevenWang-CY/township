import asyncio
import json
import logging
import random
from typing import Optional

from ..core.types import (
    AgentState,
    CivicAgentState,
    Conversation,
    NewsReaction,
    Opinion,
    TownSummary,
    AgentMoveEvent,
    ConversationStartEvent,
    NewsInjectionEvent,
    OpinionChangeEvent,
    RoundAdvanceEvent,
    SpeechBubbleEvent,
)
from ..core.event_bus import EventBus
from ..providers.anthropic_client import AnthropicClient
from ..tools.schemas import get_tools

logger = logging.getLogger(__name__)


class RoundManager:
    """Core simulation engine. Runs rounds of agent deliberation for a single town."""

    def __init__(
        self,
        anthropic_client: AnthropicClient,
        event_bus: EventBus,
        candidate_data: dict[str, dict],
        debate_excerpts: dict,
        town_data: dict[str, dict],
    ):
        self.client = anthropic_client
        self.event_bus = event_bus
        self.candidate_data = candidate_data
        self.debate_excerpts = debate_excerpts
        self.town_data = town_data

    async def run_town_simulation(
        self, town: str, agent_states: list[AgentState], num_rounds: int = 5
    ) -> TownSummary:
        """Run full simulation for one town through all rounds."""
        logger.info(f"Starting simulation for {town} with {len(agent_states)} agents, {num_rounds} rounds")

        # News events to inject at round 1
        news_events = [
            {
                "headline": "ACA Subsidies at Risk in One Big Beautiful Bill",
                "description": (
                    "Congressional Republicans are pushing the 'One Big Beautiful Bill' which would "
                    "end enhanced ACA subsidies. For NJ-11, this could mean 40,000+ residents losing "
                    "health insurance subsidies worth $400-$800/month per family."
                ),
            },
            {
                "headline": "ICE Enforcement Increases in Morris County",
                "description": (
                    "Immigration and Customs Enforcement has increased operations in Morris County, "
                    "with reports of workplace raids in Dover and Parsippany. Community organizations "
                    "report a chilling effect on residents seeking public services."
                ),
            },
            {
                "headline": "Property Tax Reassessment Coming to Morris County",
                "description": (
                    "Morris County has announced a county-wide property tax reassessment for 2027. "
                    "Homeowners in rapidly appreciating areas like Montclair and Randolph could see "
                    "significant increases, while some Dover properties may see decreases."
                ),
            },
        ]

        total_conversations = 0

        for round_num in range(num_rounds):
            await self.event_bus.publish(RoundAdvanceEvent(
                round_number=round_num,
                town=town,
            ))

            if round_num == 0:
                # Seed round: inject candidate info, get initial opinions
                await self._run_seed_round(agent_states, round_num)

            elif round_num == 1:
                # Local conversations + news reaction
                convos = await self._run_conversation_round(agent_states, round_num)
                total_conversations += convos
                await self._run_news_round(agent_states, news_events[:2], round_num)

            elif round_num == 2:
                # More conversations + reflection/opinion update
                convos = await self._run_conversation_round(agent_states, round_num)
                total_conversations += convos
                await self._run_opinion_round(agent_states, round_num)

            elif round_num == 3:
                # Cross-town gossip round + more news + opinion update
                await self._run_news_round(agent_states, news_events[2:], round_num)
                convos = await self._run_conversation_round(agent_states, round_num)
                total_conversations += convos
                await self._run_opinion_round(agent_states, round_num)

            elif round_num == 4:
                # Final conversations + final opinion
                convos = await self._run_conversation_round(agent_states, round_num)
                total_conversations += convos
                await self._run_opinion_round(agent_states, round_num)

                # Mark all agents as decided
                for agent in agent_states:
                    agent.state = CivicAgentState.DECIDED

        # Build town summary
        return self._build_town_summary(town, agent_states, total_conversations, num_rounds)

    async def _run_seed_round(self, agents: list[AgentState], round_num: int = 0):
        """Inject candidate info + debate excerpts, get initial opinions from all agents."""
        logger.info(f"Running seed round for {len(agents)} agents")

        # Build election context message
        election_context = self._build_election_context()

        tasks = []
        for agent in agents:
            tasks.append(self._seed_single_agent(agent, election_context, round_num))

        await asyncio.gather(*tasks, return_exceptions=True)

    async def _seed_single_agent(self, agent: AgentState, election_context: str, round_num: int):
        """Seed a single agent with election info and get initial opinion."""
        try:
            agent.state = CivicAgentState.OBSERVING
            agent.add_memory(f"Round {round_num}: Learned about the NJ-11 special election candidates and their positions.")

            # Move agent to a starting location
            town = agent.definition.town
            location = self._pick_location(town)
            agent.current_location = location
            landmark = self._get_landmark(town, location)
            if landmark:
                await self.event_bus.publish(AgentMoveEvent(
                    agent_id=agent.agent_id,
                    town=town,
                    location=location,
                    x=landmark.get("x", 400),
                    y=landmark.get("y", 300),
                ))

            # Ask agent to form initial opinion
            system_prompt = self._build_agent_system_prompt(agent)
            messages = [
                {
                    "role": "user",
                    "content": (
                        f"You're hearing about the upcoming NJ-11 special election on April 16, 2026. "
                        f"Here's what you know:\n\n{election_context}\n\n"
                        f"Based on your life experience and priorities, form your initial opinion "
                        f"about which candidate you're leaning toward. Use the FormOpinion tool."
                    ),
                }
            ]

            result = await self.client.call_agent(
                system_prompt=system_prompt,
                messages=messages,
                tools=get_tools(["FormOpinion"]),
                max_tokens=1600,
                model=agent.definition.model,
            )

            # Process FormOpinion tool use
            if result["tool_use"] and result["tool_use"]["name"] == "FormOpinion":
                tool_input = result["tool_use"]["input"]
                opinion = Opinion(
                    candidate=tool_input.get("candidate", agent.definition.initial_lean),
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
                await self.event_bus.publish(OpinionChangeEvent(
                    agent_id=agent.agent_id,
                    town=agent.definition.town,
                    before=None,
                    after=opinion,
                ))
            else:
                # Fallback: create opinion from initial lean
                opinion = Opinion(
                    candidate=agent.definition.initial_lean,
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
                    candidate=agent.definition.initial_lean,
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
        await self.event_bus.publish(AgentMoveEvent(
            agent_id=agent_a.agent_id, town=town, location=location, x=lx - 30, y=ly,
        ))
        await self.event_bus.publish(AgentMoveEvent(
            agent_id=agent_b.agent_id, town=town, location=location, x=lx + 30, y=ly,
        ))

        # Pick a conversation topic based on shared concerns
        shared_concerns = set(agent_a.definition.top_concerns) & set(agent_b.definition.top_concerns)
        if shared_concerns:
            topic = random.choice(list(shared_concerns))
        else:
            all_concerns = agent_a.definition.top_concerns + agent_b.definition.top_concerns
            topic = random.choice(all_concerns)

        await self.event_bus.publish(ConversationStartEvent(
            agents=[agent_a.agent_id, agent_b.agent_id],
            topic=topic,
            location=location,
            town=town,
        ))

        dialogue_parts = []
        key_takeaways = {}

        # 3 exchanges: A speaks, B responds, A responds
        speakers = [agent_a, agent_b, agent_a]
        listeners = [agent_b, agent_a, agent_b]

        conversation_so_far = ""

        for i, (speaker, listener) in enumerate(zip(speakers, listeners)):
            try:
                system_prompt = self._build_agent_system_prompt(speaker)

                if i == 0:
                    user_msg = (
                        f"You run into {listener.definition.name} at {location}. "
                        f"You start talking about the election, specifically about: {topic}. "
                        f"You know that {listener.definition.name} is a {listener.definition.occupation}. "
                        f"Start the conversation naturally. Use the Discuss tool to respond."
                    )
                else:
                    user_msg = (
                        f"You're talking with {listener.definition.name} at {location} about the election.\n\n"
                        f"Conversation so far:\n{conversation_so_far}\n\n"
                        f"Continue the conversation naturally. Respond to what they said. "
                        f"Use the Discuss tool."
                    )

                result = await self.client.call_agent(
                    system_prompt=system_prompt,
                    messages=[{"role": "user", "content": user_msg}],
                    tools=get_tools(["Discuss"]),
                    max_tokens=1200,
                    model=speaker.definition.model,
                )

                if result["tool_use"] and result["tool_use"]["name"] == "Discuss":
                    tool_input = result["tool_use"]["input"]
                    response_text = tool_input.get("response", result.get("text", "..."))
                    sentiment = tool_input.get("sentiment", "neutral")
                    takeaway = tool_input.get("key_takeaway", "")

                    dialogue_parts.append(f"{speaker.definition.name}: {response_text}")
                    conversation_so_far = "\n".join(dialogue_parts)
                    key_takeaways[speaker.definition.name] = takeaway

                    speaker.add_memory(
                        f"Round {round_num}: Talked with {listener.definition.name} at {location} about {topic}. "
                        f"Takeaway: {takeaway}"
                    )

                    await self.event_bus.publish(SpeechBubbleEvent(
                        agent_id=speaker.agent_id,
                        text=response_text[:150],
                        sentiment=sentiment,
                        town=town,
                    ))
                else:
                    # Use text response as fallback
                    text = result.get("text", "...")[:200]
                    dialogue_parts.append(f"{speaker.definition.name}: {text}")
                    conversation_so_far = "\n".join(dialogue_parts)

            except Exception as e:
                logger.error(f"Error in conversation exchange {i} for {speaker.agent_id}: {e}")
                dialogue_parts.append(f"{speaker.definition.name}: [conversation interrupted]")
                conversation_so_far = "\n".join(dialogue_parts)

        # Record the conversation
        convo = Conversation(
            agents=[agent_a.agent_id, agent_b.agent_id],
            location=location,
            topic=topic,
            dialogue="\n".join(dialogue_parts),
            key_takeaways=key_takeaways,
            round_number=round_num,
        )
        agent_a.conversations.append(convo)
        agent_b.conversations.append(convo)
        agent_a.state = CivicAgentState.IDLE
        agent_b.state = CivicAgentState.IDLE

    async def _run_news_round(self, agents: list[AgentState], news_events: list[dict], round_num: int):
        """Inject news and get reactions from all agents."""
        logger.info(f"Running news round {round_num} with {len(news_events)} events")

        for news in news_events:
            await self.event_bus.publish(NewsInjectionEvent(
                headline=news["headline"],
                description=news["description"],
            ))

            tasks = []
            for agent in agents:
                tasks.append(self._react_to_news(agent, news, round_num))
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _react_to_news(self, agent: AgentState, news: dict, round_num: int):
        """Get a single agent's reaction to a news event."""
        try:
            agent.state = CivicAgentState.OBSERVING
            system_prompt = self._build_agent_system_prompt(agent)

            messages = [
                {
                    "role": "user",
                    "content": (
                        f"Breaking news that's affecting the NJ-11 election:\n\n"
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
                tools=get_tools(["ReactToNews"]),
                max_tokens=1200,
                model=agent.definition.model,
            )

            if result["tool_use"] and result["tool_use"]["name"] == "ReactToNews":
                tool_input = result["tool_use"]["input"]
                emotional = tool_input.get("emotional_response", "indifferent")
                impact = tool_input.get("impact_on_vote", "no_effect")
                reasoning = tool_input.get("reasoning", "No strong reaction.")

                agent.add_memory(
                    f"Round {round_num}: Heard news '{news['headline']}'. "
                    f"Felt {emotional}. Impact on vote: {impact}. {reasoning}"
                )

                await self.event_bus.publish(SpeechBubbleEvent(
                    agent_id=agent.agent_id,
                    text=f"Re: {news['headline'][:50]}... - {reasoning[:100]}",
                    sentiment="negative" if emotional in ("angry", "anxious") else (
                        "positive" if emotional == "hopeful" else "neutral"
                    ),
                    town=agent.definition.town,
                ))

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
            system_prompt = self._build_agent_system_prompt(agent)

            # Build context about recent conversations and memories
            recent_memories = agent.get_recent_memories(10)
            memories_text = "\n".join(f"- {m}" for m in recent_memories) if recent_memories else "No recent events."

            messages = [
                {
                    "role": "user",
                    "content": (
                        f"It's round {round_num} of the election season. Take a moment to reflect "
                        f"on everything you've heard and experienced:\n\n"
                        f"Recent experiences:\n{memories_text}\n\n"
                        f"Now, considering all of this — your conversations, the news, your personal "
                        f"circumstances — update your opinion on the NJ-11 election. "
                        f"Who are you leaning toward and why? Use the FormOpinion tool."
                    ),
                }
            ]

            result = await self.client.call_agent(
                system_prompt=system_prompt,
                messages=messages,
                tools=get_tools(["FormOpinion"]),
                max_tokens=1400,
                model=agent.definition.model,
            )

            before = agent.current_opinion

            if result["tool_use"] and result["tool_use"]["name"] == "FormOpinion":
                tool_input = result["tool_use"]["input"]
                opinion = Opinion(
                    candidate=tool_input.get("candidate", before.candidate if before else "undecided"),
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

                await self.event_bus.publish(OpinionChangeEvent(
                    agent_id=agent.agent_id,
                    town=agent.definition.town,
                    before=before,
                    after=opinion,
                ))

            agent.state = CivicAgentState.IDLE

        except Exception as e:
            logger.error(f"Error in opinion round for {agent.agent_id}: {e}")
            agent.state = CivicAgentState.ERROR

    def _build_agent_system_prompt(self, agent_state: AgentState) -> str:
        """Compose full system prompt: persona + memories + opinions + election context."""
        parts = []

        # Base persona from markdown file
        parts.append(agent_state.definition.system_prompt)

        # Current election context
        parts.append(
            "\n\n--- ELECTION CONTEXT ---\n"
            "You are a voter in New Jersey's 11th Congressional District. "
            "A special election is happening on April 16, 2026 to replace Mikie Sherrill, "
            "who became governor. The candidates are:\n"
            "- Analilia Mejia (Democrat): Progressive, supports Medicare for All, $25 min wage, abolish ICE\n"
            "- Joe Hathaway (Republican): 'New generation Republican', lower taxes, supports One Big Beautiful Bill\n"
            "- Alan Bond (Independent): Former Wall Street fund manager with fraud conviction, limited platform\n"
            "\nEarly voting is April 6-14. Election Day is April 16."
        )

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

    def _build_election_context(self) -> str:
        """Build a comprehensive election context string from data files."""
        parts = []

        parts.append("## NJ-11 SPECIAL ELECTION — CANDIDATE POSITIONS\n")

        for cand_name, cand_data in self.candidate_data.items():
            parts.append(f"### {cand_data.get('name', cand_name)} ({cand_data.get('party', 'Unknown')})")
            parts.append(f"Background: {cand_data.get('background', 'N/A')}")

            positions = cand_data.get("positions", [])
            for pos in positions:
                parts.append(f"- {pos.get('issue', '?')}: {pos.get('stance', '?')}")

            endorsements = cand_data.get("endorsements", [])
            if endorsements:
                parts.append(f"Endorsements: {', '.join(endorsements)}")

            fraud = cand_data.get("fraud_conviction")
            if fraud:
                parts.append(f"NOTE: {fraud.get('description', '')}")

            parts.append("")

        # Debate excerpts
        parts.append("## DEBATE HIGHLIGHTS (April 1, 2026)\n")
        exchanges = self.debate_excerpts.get("exchanges", [])
        for ex in exchanges:
            parts.append(f"**{ex.get('topic', '?')}** (tension: {ex.get('tension_level', '?')}/5)")
            parts.append(f"  Mejia: {ex.get('mejia_position', '?')}")
            parts.append(f"  Hathaway: {ex.get('hathaway_position', '?')}")
            quote = ex.get("key_quote")
            if quote:
                parts.append(f"  Key moment: \"{quote}\"")
            parts.append("")

        return "\n".join(parts)

    # ── Cross-Town Gossip Pairs ────────────────────────────────

    CROSS_TOWN_PAIRS = [
        {
            "agents": ("Carlos Restrepo", "Pawan Sharma"),
            "connection": "Fellow restaurant owners who met at a Morris County Restaurant Association mixer. They bonded over the challenges of running a small food business in NJ.",
        },
        {
            "agents": ("Maria Santos", "Grace Reyes"),
            "connection": "Both healthcare workers who occasionally cross paths at Morristown Medical Center during shift changes. They share frustrations about insurance paperwork and patient loads.",
        },
        {
            "agents": ("Tom Kowalski", "Frank DeLuca"),
            "connection": "Veterans who know each other from the Morris County VFW post. They served in different eras but share a deep bond over military service and VA healthcare struggles.",
        },
        {
            "agents": ("Sofia Ramirez", "Jordan Williams"),
            "connection": "Connected on social media through mutual activist friends. Both are young, frustrated with the political establishment, and active in local organizing circles.",
        },
        {
            "agents": ("Raj Krishnamurthy", "Vikram Iyer"),
            "connection": "Indian-American tech professionals who know each other from the Parsippany-area tech meetup circuit. Their families attend some of the same community events.",
        },
        {
            "agents": ("Priya Patel", "Jen Russo"),
            "connection": "Suburban moms whose kids played in the same Morris County youth soccer league. They chat at games about schools, property taxes, and local politics.",
        },
    ]

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

        # Try to match predefined strategic pairs
        for pair_def in self.CROSS_TOWN_PAIRS:
            name_a, name_b = pair_def["agents"]
            agent_a = name_lookup.get(name_a.lower())
            agent_b = name_lookup.get(name_b.lower())

            if agent_a and agent_b and agent_a.agent_id not in used_agents and agent_b.agent_id not in used_agents:
                matched_pairs.append((agent_a, agent_b, pair_def["connection"]))
                used_agents.add(agent_a.agent_id)
                used_agents.add(agent_b.agent_id)

        # Fallback: pair remaining unmatched agents across towns randomly
        remaining = [a for a in all_agents if a.agent_id not in used_agents]
        random.shuffle(remaining)

        for i in range(0, len(remaining) - 1, 2):
            a, b = remaining[i], remaining[i + 1]
            # Prefer cross-town pairs
            if a.definition.town != b.definition.town:
                connection = (
                    f"They met by chance at a Morris County community event and "
                    f"discovered they share concerns about the upcoming NJ-11 election."
                )
                matched_pairs.append((a, b, connection))
            elif i + 2 < len(remaining) and remaining[i + 2].definition.town != a.definition.town:
                # Swap to get a cross-town pair
                remaining[i + 1], remaining[i + 2] = remaining[i + 2], remaining[i + 1]
                b = remaining[i + 1]
                connection = (
                    f"They met by chance at a Morris County community event and "
                    f"discovered they share concerns about the upcoming NJ-11 election."
                )
                matched_pairs.append((a, b, connection))

        logger.info(f"Created {len(matched_pairs)} cross-town pairs ({len([p for p in matched_pairs if p[2] != ''])} with connection stories)")
        return matched_pairs

    async def run_cross_town_conversation(
        self, agent_a: AgentState, agent_b: AgentState, connection_story: str, round_num: int
    ):
        """Run a cross-town conversation between two agents with connection context."""
        # Use agent_a's town for location, or a neutral location
        location = "Morris County Community Event"
        agent_a.state = CivicAgentState.DISCUSSING
        agent_b.state = CivicAgentState.DISCUSSING

        # Pick a conversation topic based on shared concerns
        shared_concerns = set(agent_a.definition.top_concerns) & set(agent_b.definition.top_concerns)
        if shared_concerns:
            topic = random.choice(list(shared_concerns))
        else:
            all_concerns = agent_a.definition.top_concerns + agent_b.definition.top_concerns
            topic = random.choice(all_concerns)

        await self.event_bus.publish(ConversationStartEvent(
            agents=[agent_a.agent_id, agent_b.agent_id],
            topic=topic,
            location=location,
            town=agent_a.definition.town,
        ))

        dialogue_parts = []
        key_takeaways = {}

        # 3 exchanges: A speaks, B responds, A responds
        speakers = [agent_a, agent_b, agent_a]
        listeners = [agent_b, agent_a, agent_b]

        conversation_so_far = ""

        for i, (speaker, listener) in enumerate(zip(speakers, listeners)):
            try:
                system_prompt = self._build_agent_system_prompt(speaker)

                if i == 0:
                    user_msg = (
                        f"You run into {listener.definition.name} from {listener.definition.town}. "
                        f"Connection: {connection_story} "
                        f"You start talking about the NJ-11 election, specifically about: {topic}. "
                        f"You know that {listener.definition.name} is a {listener.definition.occupation} "
                        f"from {listener.definition.town}. "
                        f"Start the conversation naturally, acknowledging you're from different towns. "
                        f"Use the Discuss tool to respond."
                    )
                else:
                    user_msg = (
                        f"You're talking with {listener.definition.name} from {listener.definition.town} "
                        f"about the election.\n\n"
                        f"Conversation so far:\n{conversation_so_far}\n\n"
                        f"Continue the conversation naturally. You may have different perspectives "
                        f"since you live in different towns. Use the Discuss tool."
                    )

                result = await self.client.call_agent(
                    system_prompt=system_prompt,
                    messages=[{"role": "user", "content": user_msg}],
                    tools=get_tools(["Discuss"]),
                    max_tokens=1200,
                    model=speaker.definition.model,
                )

                if result["tool_use"] and result["tool_use"]["name"] == "Discuss":
                    tool_input = result["tool_use"]["input"]
                    response_text = tool_input.get("response", result.get("text", "..."))
                    sentiment = tool_input.get("sentiment", "neutral")
                    takeaway = tool_input.get("key_takeaway", "")

                    dialogue_parts.append(f"{speaker.definition.name} ({speaker.definition.town}): {response_text}")
                    conversation_so_far = "\n".join(dialogue_parts)
                    key_takeaways[speaker.definition.name] = takeaway

                    speaker.add_memory(
                        f"Round {round_num}: Cross-town talk with {listener.definition.name} "
                        f"from {listener.definition.town} about {topic}. "
                        f"Takeaway: {takeaway}"
                    )

                    await self.event_bus.publish(SpeechBubbleEvent(
                        agent_id=speaker.agent_id,
                        text=response_text[:150],
                        sentiment=sentiment,
                        town=speaker.definition.town,
                    ))
                else:
                    text = result.get("text", "...")[:200]
                    dialogue_parts.append(f"{speaker.definition.name} ({speaker.definition.town}): {text}")
                    conversation_so_far = "\n".join(dialogue_parts)

            except Exception as e:
                logger.error(f"Error in cross-town conversation exchange {i} for {speaker.agent_id}: {e}")
                dialogue_parts.append(f"{speaker.definition.name}: [conversation interrupted]")
                conversation_so_far = "\n".join(dialogue_parts)

        # Record the conversation for both agents
        convo = Conversation(
            agents=[agent_a.agent_id, agent_b.agent_id],
            location=location,
            topic=topic,
            dialogue="\n".join(dialogue_parts),
            key_takeaways=key_takeaways,
            round_number=round_num,
        )
        agent_a.conversations.append(convo)
        agent_b.conversations.append(convo)
        agent_a.state = CivicAgentState.IDLE
        agent_b.state = CivicAgentState.IDLE

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

    def _get_landmark(self, town: str, location_name: str) -> Optional[dict]:
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
        # Opinion distribution
        opinion_dist: dict[str, int] = {"mejia": 0, "hathaway": 0, "bond": 0, "undecided": 0}
        all_issues: dict[str, int] = {}
        agent_summaries = []

        for agent in agents:
            final_opinion = agent.current_opinion
            if final_opinion:
                opinion_dist[final_opinion.candidate] += 1
                for issue in final_opinion.top_issues:
                    all_issues[issue] = all_issues.get(issue, 0) + 1
            else:
                opinion_dist["undecided"] += 1

            agent_summaries.append({
                "agent_id": agent.agent_id,
                "name": agent.definition.name,
                "occupation": agent.definition.occupation,
                "final_candidate": final_opinion.candidate if final_opinion else "undecided",
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
        )
