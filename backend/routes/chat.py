import logging

from fastapi import APIRouter, Request
from pydantic import BaseModel

from ..tools.schemas import get_tools

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatRequest(BaseModel):
    message: str


class ChatResponse(BaseModel):
    response: str
    agent_id: str
    agent_name: str
    opinion: dict | None = None


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

    messages = [
        {
            "role": "user",
            "content": (
                f"A person approaches you and says: \"{req.message}\"\n\n"
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

    response_text = result.get("text", "...")

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
