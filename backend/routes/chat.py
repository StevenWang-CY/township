import logging

from fastapi import APIRouter, Request
from pydantic import BaseModel

from ..tools.schemas import get_tools

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatRequest(BaseModel):
    message: str
    user_profile: dict | None = None


class ChatResponse(BaseModel):
    response: str
    agent_id: str
    agent_name: str
    opinion: dict | None = None


class AutoChatRequest(BaseModel):
    user_profile: dict
    conversation_history: list[dict] = []


class AutoChatResponse(BaseModel):
    user_message: str
    agent_response: str
    agent_id: str
    agent_name: str
    should_end: bool


@router.post("/{agent_id}")
async def chat_with_agent(agent_id: str, req: ChatRequest, request: Request) -> ChatResponse:
    """Chat with a specific agent in character. The agent responds based on their full persona and memories."""
    orchestrator = request.app.state.orchestrator
    anthropic_client = request.app.state.anthropic_client

    # Find the agent
    agent_state = orchestrator.get_agent_state(agent_id)
    if agent_state is None:
        return ChatResponse(
            response=f"Agent '{agent_id}' not found. Check /api/simulation/agents for available agents.",
            agent_id=agent_id,
            agent_name="System",
            opinion=None,
        )

    # Build system prompt with full context
    system_prompt = _build_chat_system_prompt(agent_state)

    # Enrich the user message with profile context if available
    if req.user_profile:
        p = req.user_profile
        user_intro = (
            f"A person named {p.get('name', 'someone')} from {p.get('town', 'the area')}, "
            f"who cares about {', '.join(p.get('top_concerns', ['the election']))}, "
            f"approaches you and says: \"{req.message}\""
        )
    else:
        user_intro = f"A person approaches you and says: \"{req.message}\""

    messages = [
        {
            "role": "user",
            "content": (
                f"{user_intro}\n\n"
                f"Respond naturally in character. If they're asking about the election, "
                f"share your genuine views. If they ask about something else, respond "
                f"as yourself. Keep it conversational — 2-4 sentences."
            ),
        }
    ]

    result = await anthropic_client.call_agent(
        system_prompt=system_prompt,
        messages=messages,
        tools=None,  # No tools for direct chat, just natural response
        max_tokens=1200,  # Higher for reasoning models that use internal tokens
        model=agent_state.definition.model,
    )

    response_text = result.get("text") or "..."

    # Add this chat to agent's memory
    agent_state.add_memory(f"Chat: Someone asked me '{req.message[:80]}'. I said: '{response_text[:80]}...'")

    # Include current opinion if available
    opinion_data = None
    opinion = agent_state.current_opinion
    if opinion:
        opinion_data = {
            "candidate": opinion.candidate,
            "confidence": opinion.confidence,
            "reasoning": opinion.reasoning,
            "top_issues": opinion.top_issues,
        }

    return ChatResponse(
        response=response_text,
        agent_id=agent_id,
        agent_name=agent_state.definition.name,
        opinion=opinion_data,
    )


@router.post("/auto/{agent_id}")
async def auto_chat(agent_id: str, req: AutoChatRequest, request: Request) -> AutoChatResponse:
    """Auto-agent mode: generate both user and agent messages for a natural conversation."""
    orchestrator = request.app.state.orchestrator
    anthropic_client = request.app.state.anthropic_client

    agent_state = orchestrator.get_agent_state(agent_id)
    if agent_state is None:
        return AutoChatResponse(
            user_message="...",
            agent_response=f"Agent '{agent_id}' not found.",
            agent_id=agent_id,
            agent_name="System",
            should_end=True,
        )

    p = req.user_profile
    turn_num = len(req.conversation_history) // 2

    # ── Step 1: Generate user's message ──────────────────────
    user_persona_prompt = _build_user_persona_prompt(p)

    user_context = ""
    if req.conversation_history:
        user_context = "\n\nConversation so far:\n"
        for msg in req.conversation_history[-6:]:
            role = "You" if msg.get("role") == "user" else agent_state.definition.name
            user_context += f"{role}: {msg.get('content', '')}\n"

    user_messages = [
        {
            "role": "user",
            "content": (
                f"You're having a casual conversation with {agent_state.definition.name}, "
                f"a {agent_state.definition.occupation} in {agent_state.definition.town}."
                f"{user_context}\n\n"
                f"{'Start a conversation about the election or local issues.' if turn_num == 0 else 'Continue the conversation naturally.'} "
                f"Speak as yourself — 2-3 sentences. Be genuine and specific to your concerns."
            ),
        }
    ]

    user_result = await anthropic_client.call_agent(
        system_prompt=user_persona_prompt,
        messages=user_messages,
        tools=None,
        max_tokens=1200,
    )

    user_message = user_result.get("text") or "What do you think about the election?"

    # ── Step 2: Generate agent's response ────────────────────
    agent_system = _build_chat_system_prompt(agent_state)

    if p:
        user_intro = (
            f"A person named {p.get('name', 'someone')} from {p.get('town', 'the area')}, "
            f"who cares about {', '.join(p.get('top_concerns', ['the election']))}, "
            f"says: \"{user_message}\""
        )
    else:
        user_intro = f"Someone says: \"{user_message}\""

    # Include conversation history for context
    history_ctx = ""
    if req.conversation_history:
        history_ctx = "\n\nEarlier in this conversation:\n"
        for msg in req.conversation_history[-6:]:
            role = p.get("name", "Them") if msg.get("role") == "user" else "You"
            history_ctx += f"{role}: {msg.get('content', '')}\n"

    agent_messages = [
        {
            "role": "user",
            "content": (
                f"{history_ctx}\n\n{user_intro}\n\n"
                f"Respond naturally in character. Keep it conversational — 2-4 sentences."
            ),
        }
    ]

    agent_result = await anthropic_client.call_agent(
        system_prompt=agent_system,
        messages=agent_messages,
        tools=None,
        max_tokens=1200,
        model=agent_state.definition.model,
    )

    agent_response = agent_result.get("text") or "..."

    # Record in memory
    agent_state.add_memory(
        f"Chat: {p.get('name', 'Someone')} said '{user_message[:60]}'. I said: '{agent_response[:60]}...'"
    )

    # Determine if conversation should end
    should_end = turn_num >= 3

    return AutoChatResponse(
        user_message=user_message,
        agent_response=agent_response,
        agent_id=agent_id,
        agent_name=agent_state.definition.name,
        should_end=should_end,
    )


def _build_user_persona_prompt(profile: dict) -> str:
    """Build a system prompt for the user's AI persona."""
    name = profile.get("name", "A voter")
    town = profile.get("town", "NJ-11")
    leaning = profile.get("political_leaning", "undecided")
    concerns = ", ".join(profile.get("top_concerns", ["the election"]))
    personality = profile.get("personality", "A local resident interested in the election.")

    return (
        f"You are {name}, a resident of {town} in New Jersey's 11th Congressional District.\n"
        f"Political leaning: {leaning}\n"
        f"Top concerns: {concerns}\n"
        f"About you: {personality}\n\n"
        f"The NJ-11 special election is on April 16, 2026. "
        f"Candidates: Analilia Mejia (D), Joe Hathaway (R), Alan Bond (I). "
        f"Early voting is happening now.\n\n"
        f"You're having a casual conversation with a neighbor about the election. "
        f"Speak naturally as yourself — 2-3 sentences. Reference your personal concerns "
        f"and experiences. Be genuine, curious, and opinionated based on your background. "
        f"Don't be generic — be specific to your situation."
    )


def _build_chat_system_prompt(agent_state) -> str:
    """Build a comprehensive system prompt for chat interactions."""
    parts = []

    # Base persona
    parts.append(agent_state.definition.system_prompt)

    # Election context
    parts.append(
        "\n\n--- CONTEXT ---\n"
        "You're a voter in NJ-11. Special election is April 16, 2026. "
        "Candidates: Analilia Mejia (D), Joe Hathaway (R), Alan Bond (I). "
        "Early voting is happening now (April 6-14)."
    )

    # Current opinion
    opinion = agent_state.current_opinion
    if opinion:
        parts.append(
            f"\n\n--- YOUR CURRENT VOTING STANCE ---\n"
            f"Leaning: {opinion.candidate} (confidence: {opinion.confidence}%)\n"
            f"Why: {opinion.reasoning}\n"
            f"Top issues: {', '.join(opinion.top_issues)}"
        )
        if opinion.dealbreaker:
            parts.append(f"Dealbreaker: {opinion.dealbreaker}")

    # Recent memories for context
    recent = agent_state.get_recent_memories(10)
    if recent:
        parts.append(
            "\n\n--- WHAT YOU'VE BEEN UP TO LATELY ---\n"
            + "\n".join(f"- {m}" for m in recent)
        )

    # Chat instructions
    parts.append(
        "\n\n--- CHAT INSTRUCTIONS ---\n"
        "Someone is talking to you directly. Respond in character with your own voice "
        "and speech patterns. Be warm but authentic. If you mix languages, do so naturally. "
        "Don't break character or mention that you're an AI. "
        "Keep responses conversational and concise (2-4 sentences). "
        "If asked about the election, share your genuine current views."
    )

    return "\n".join(parts)
