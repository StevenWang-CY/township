import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..core.scenario import validate_stance
from ..core.types import Opinion, OpinionChangedEvent, RelationshipUpdateEvent
from ..core.wire import opinion_to_wire
from ..tools.schemas import get_tools

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["chat"])


# ─── Relationship store (in-memory, per-process) ───────────────
# Layout: { user_id: { agent_id: { trust, encounters, topics_discussed, ... } } }
_RELATIONSHIPS: dict[str, dict[str, dict]] = {}


def _default_rel() -> dict:
    return {
        "trust": 0,
        "encounters": 0,
        "topics_discussed": [],
        "last_chat_at": None,
        "last_message_at": None,
        "last_classification": None,
    }


def _get_rel(user_id: str, agent_id: str) -> dict:
    """Get-or-create the relationship dict for a (user, agent) pair."""
    user_map = _RELATIONSHIPS.setdefault(user_id, {})
    rel = user_map.get(agent_id)
    if rel is None:
        rel = _default_rel()
        user_map[agent_id] = rel
    return rel


def _trust_band(trust: int) -> str:
    """Map a trust integer into one of four narrative bands."""
    if trust > 50:
        return "friend"
    if 0 <= trust <= 50:
        return "warming"
    if -30 <= trust < 0:
        return "guarded"
    return "distrust"


def _trust_block(trust: int) -> str:
    """Render the system-prompt block describing how the agent feels."""
    band = _trust_band(trust)
    if band == "friend":
        line = (
            "You consider this person a friend. Be warm, share more personal details, "
            "tell a small joke if it fits, and ask follow-up questions about their life."
        )
    elif band == "warming":
        line = (
            "You're warming up to this person. Be polite, increasingly open. Share "
            "modest personal context if it helps explain your views."
        )
    elif band == "guarded":
        line = (
            "You're guarded with this person. Be polite but reserved. Stick to facts "
            "and your own experience without revealing too much."
        )
    else:
        line = (
            "You distrust this person. Be terse and decline politically loaded "
            "questions. Don't share personal details. Two short sentences max."
        )
    return f"\n\n--- HOW YOU FEEL ABOUT THIS PERSON ---\nTrust level: {trust}. {line}"


# ─── Request / response models ────────────────────────────────

class ChatRequest(BaseModel):
    message: str
    user_profile: dict | None = None
    user_id: str | None = None


class ChatResponse(BaseModel):
    response: str
    agent_id: str
    agent_name: str
    opinion: dict | None = None
    opinion_changed: bool = False
    trust: int = 0
    trust_band: str = "warming"


class AutoChatRequest(BaseModel):
    user_profile: dict
    conversation_history: list[dict] = []
    user_id: str | None = None


class AutoChatResponse(BaseModel):
    user_message: str
    agent_response: str
    agent_id: str
    agent_name: str
    should_end: bool
    opinion: dict | None = None
    opinion_changed: bool = False
    trust: int = 0
    trust_band: str = "warming"


# ─── Relationship endpoints ───────────────────────────────────

@router.get("/relationships/{user_id}")
async def get_relationships(user_id: str):
    """Return the entire relationships dict for a single user."""
    return {
        "user_id": user_id,
        "relationships": _RELATIONSHIPS.get(user_id, {}),
    }


class ResetRequest(BaseModel):
    user_id: str
    agent_id: str | None = None


@router.post("/relationships/reset")
async def reset_relationships(req: ResetRequest):
    """Reset a single agent's relationship for a user, or all if agent_id omitted."""
    if req.user_id not in _RELATIONSHIPS:
        return {"status": "ok", "cleared": 0}
    if req.agent_id:
        cleared = 1 if _RELATIONSHIPS[req.user_id].pop(req.agent_id, None) else 0
    else:
        cleared = len(_RELATIONSHIPS[req.user_id])
        _RELATIONSHIPS[req.user_id] = {}
    return {"status": "ok", "cleared": cleared}


# ─── Chat endpoints ───────────────────────────────────────────

@router.post("/{agent_id}")
async def chat_with_agent(agent_id: str, req: ChatRequest, request: Request) -> ChatResponse:
    """Chat with a specific agent in character. The agent responds based on their full persona and memories."""
    orchestrator = request.app.state.orchestrator
    anthropic_client = request.app.state.anthropic_client
    event_bus = request.app.state.event_bus
    scenario = request.app.state.scenario

    user_id = req.user_id or "local"

    # Find the agent
    agent_state = orchestrator.get_agent_state(agent_id)
    if agent_state is None:
        return JSONResponse(
            status_code=404,
            content={"error": "agent_not_found", "agent_id": agent_id},
        )

    rel = _get_rel(user_id, agent_id)

    # Persist what the player has revealed about themselves so future turns and
    # other systems can reference it (§5.2).
    if req.user_profile:
        _record_player_reveal(rel, req.user_profile)

    # Build system prompt with full context (including trust)
    system_prompt = _build_chat_system_prompt(agent_state, scenario, trust=rel["trust"])

    # Enrich the user message with profile context if available
    if req.user_profile:
        p = req.user_profile
        user_intro = (
            f"A person named {p.get('name', 'someone')} from {p.get('town', 'the area')}, "
            f"who cares about {', '.join(p.get('top_concerns', ['local issues']))}, "
            f"approaches you and says: \"{req.message}\""
        )
    else:
        user_intro = f"A person approaches you and says: \"{req.message}\""

    messages = [
        {
            "role": "user",
            "content": (
                f"{user_intro}\n\n"
                f"Respond naturally in character. If they're asking about {scenario.title}, "
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

    if result.get("stop_reason") == "error":
        logger.error(f"Chat call errored for {agent_id}: {result.get('error')}")
        return JSONResponse(
            status_code=503,
            content={
                "error": "llm_unavailable",
                "message": f"Could not reach {agent_state.definition.name} right now.",
            },
        )

    response_text = result.get("text") or "..."

    # Add this chat to agent's memory
    agent_state.add_memory(
        f"Chat: Someone asked me '{req.message[:80]}'. I said: '{response_text[:80]}...'"
    )

    # Update relationship (best-effort classify call)
    await _classify_and_update_trust(
        anthropic_client=anthropic_client,
        event_bus=event_bus,
        agent_state=agent_state,
        scenario=scenario,
        agent_id=agent_id,
        user_id=user_id,
        rel=rel,
        user_message=req.message,
        agent_response=response_text,
    )

    # Re-evaluate the agent's opinion in light of this exchange.
    opinion_changed = await _reevaluate_opinion(
        anthropic_client=anthropic_client,
        event_bus=event_bus,
        agent_state=agent_state,
        scenario=scenario,
        user_message=req.message,
        agent_response=response_text,
    )

    return ChatResponse(
        response=response_text,
        agent_id=agent_id,
        agent_name=agent_state.definition.name,
        opinion=opinion_to_wire(agent_state.current_opinion),
        opinion_changed=opinion_changed,
        trust=rel["trust"],
        trust_band=_trust_band(rel["trust"]),
    )


@router.post("/auto/{agent_id}")
async def auto_chat(agent_id: str, req: AutoChatRequest, request: Request) -> AutoChatResponse:
    """Auto-agent mode: generate both user and agent messages for a natural conversation."""
    orchestrator = request.app.state.orchestrator
    anthropic_client = request.app.state.anthropic_client
    event_bus = request.app.state.event_bus
    scenario = request.app.state.scenario

    user_id = req.user_id or "local"

    agent_state = orchestrator.get_agent_state(agent_id)
    if agent_state is None:
        return JSONResponse(
            status_code=404,
            content={"error": "agent_not_found", "agent_id": agent_id},
        )

    rel = _get_rel(user_id, agent_id)

    p = req.user_profile
    if p:
        _record_player_reveal(rel, p)
    turn_num = len(req.conversation_history) // 2

    # ── Step 1: Generate user's message ──────────────────────
    user_persona_prompt = _build_user_persona_prompt(p, scenario)

    user_context = ""
    if req.conversation_history:
        user_context = "\n\nConversation so far:\n"
        for msg in req.conversation_history[-6:]:
            role = "You" if msg.get("role") == "user" else agent_state.definition.name
            user_context += f"{role}: {msg.get('content', '')}\n"

    opening_line = (
        f"Start a conversation about {scenario.title} or local issues."
        if turn_num == 0
        else "Continue the conversation naturally."
    )
    user_messages = [
        {
            "role": "user",
            "content": (
                f"You're having a casual conversation with {agent_state.definition.name}, "
                f"a {agent_state.definition.occupation} in {agent_state.definition.town}."
                f"{user_context}\n\n"
                f"{opening_line} "
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

    user_message = user_result.get("text") or f"What do you think about {scenario.title}?"

    # ── Step 2: Generate agent's response ────────────────────
    agent_system = _build_chat_system_prompt(agent_state, scenario, trust=rel["trust"])

    if p:
        user_intro = (
            f"A person named {p.get('name', 'someone')} from {p.get('town', 'the area')}, "
            f"who cares about {', '.join(p.get('top_concerns', ['local issues']))}, "
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

    if agent_result.get("stop_reason") == "error":
        logger.error(f"Auto-chat call errored for {agent_id}: {agent_result.get('error')}")
        return JSONResponse(
            status_code=503,
            content={
                "error": "llm_unavailable",
                "message": f"Could not reach {agent_state.definition.name} right now.",
            },
        )

    agent_response = agent_result.get("text") or "..."

    # Record in memory
    agent_state.add_memory(
        f"Chat: {p.get('name', 'Someone')} said '{user_message[:60]}'. I said: '{agent_response[:60]}...'"
    )

    # Update relationship (best-effort classify call)
    await _classify_and_update_trust(
        anthropic_client=anthropic_client,
        event_bus=event_bus,
        agent_state=agent_state,
        scenario=scenario,
        agent_id=agent_id,
        user_id=user_id,
        rel=rel,
        user_message=user_message,
        agent_response=agent_response,
    )

    # Re-evaluate the agent's opinion in light of this exchange.
    opinion_changed = await _reevaluate_opinion(
        anthropic_client=anthropic_client,
        event_bus=event_bus,
        agent_state=agent_state,
        scenario=scenario,
        user_message=user_message,
        agent_response=agent_response,
    )

    # Determine if conversation should end
    should_end = turn_num >= 3

    return AutoChatResponse(
        user_message=user_message,
        agent_response=agent_response,
        agent_id=agent_id,
        agent_name=agent_state.definition.name,
        should_end=should_end,
        opinion=opinion_to_wire(agent_state.current_opinion),
        opinion_changed=opinion_changed,
        trust=rel["trust"],
        trust_band=_trust_band(rel["trust"]),
    )


# ─── Helpers ──────────────────────────────────────────────────

def _record_player_reveal(rel: dict, profile: dict) -> None:
    """Persist what the player has told this agent about themselves (§5.2).

    Stored on the relationship dict under `player_revealed_to_them` so the agent
    'remembers' who they're talking to across turns.
    """
    revealed = rel.setdefault("player_revealed_to_them", {})
    if profile.get("name"):
        revealed["name"] = profile.get("name")
    if profile.get("town"):
        revealed["town"] = profile.get("town")
    leaning = profile.get("political_leaning") or profile.get("leaning")
    if leaning:
        revealed["leaning"] = leaning
    if profile.get("top_concerns"):
        revealed["concerns"] = list(profile.get("top_concerns"))


async def _reevaluate_opinion(
    *,
    anthropic_client,
    event_bus,
    agent_state,
    scenario,
    user_message: str,
    agent_response: str,
) -> bool:
    """Re-run FormOpinion after a chat exchange.

    Appends a new Opinion and publishes an OpinionChangedEvent only when the
    agent's candidate changed OR confidence moved by >= 10 vs the current
    opinion. Best-effort — any error here is logged and treated as no change.
    Returns True when the opinion actually changed.
    """
    prev = agent_state.current_opinion
    try:
        system_prompt = (
            _build_chat_system_prompt(agent_state, scenario)
            + "\n\n--- OPINION CHECK ---\n"
            "Reflect on the exchange below. If it changed how you feel about your stance, "
            "update it honestly; if it didn't, restate your current stance. "
            "Call the FormOpinion tool."
        )
        result = await anthropic_client.call_agent(
            system_prompt=system_prompt,
            messages=[
                {
                    "role": "user",
                    "content": (
                        f"They said: \"{user_message}\"\n"
                        f"You replied: \"{agent_response}\"\n\n"
                        f"Now call FormOpinion with your current stance on the question: "
                        f"{scenario.question}"
                    ),
                }
            ],
            tools=get_tools(["FormOpinion"], scenario),
            max_tokens=600,
            model=agent_state.definition.model,
        )

        if result.get("stop_reason") == "error":
            logger.warning(
                f"Opinion re-eval errored for {agent_state.agent_id}: {result.get('error')}"
            )
            return False

        tool_use = result.get("tool_use")
        if not (tool_use and tool_use.get("name") == "FormOpinion"):
            return False

        tool_input = tool_use.get("input", {})
        new_candidate = validate_stance(
            tool_input.get(
                "candidate", prev.candidate if prev else scenario.undecided_id
            ),
            scenario,
        )
        try:
            new_confidence = int(tool_input.get("confidence", prev.confidence if prev else 50))
        except (TypeError, ValueError):
            new_confidence = prev.confidence if prev else 50

        candidate_changed = prev is None or new_candidate != prev.candidate
        confidence_jump = prev is not None and abs(new_confidence - prev.confidence) >= 10

        if not (candidate_changed or confidence_jump):
            return False

        new_opinion = Opinion(
            candidate=new_candidate,
            confidence=max(0, min(100, new_confidence)),
            reasoning=tool_input.get("reasoning", "Reconsidered after this conversation."),
            top_issues=tool_input.get(
                "top_issues",
                list(prev.top_issues) if prev else list(agent_state.definition.top_concerns[:3]),
            ),
            dealbreaker=tool_input.get("dealbreaker"),
            round_number=(((prev.round_number or 0) + 1) if prev else 99),
        )
        agent_state.opinions.append(new_opinion)
        agent_state.add_memory(
            f"Chat shifted my view: now leaning {new_opinion.candidate} "
            f"(confidence: {new_opinion.confidence}%)."
        )

        try:
            await event_bus.publish(OpinionChangedEvent(
                agent_id=agent_state.agent_id,
                agent_name=agent_state.definition.name,
                town=agent_state.definition.town,
                old_opinion=prev,
                new_opinion=new_opinion,
            ))
        except Exception as pub_err:  # pragma: no cover — defensive
            logger.warning(f"Failed to publish OpinionChangedEvent: {pub_err}")

        return True

    except Exception as e:
        logger.warning(f"Opinion re-eval failed for {agent_state.agent_id}: {e}")
        return False


async def _classify_and_update_trust(
    *,
    anthropic_client,
    event_bus,
    agent_state,
    scenario,
    agent_id: str,
    user_id: str,
    rel: dict,
    user_message: str,
    agent_response: str,
) -> None:
    """
    Make a SMALL ClassifyInteraction call, apply the trust delta, persist to the
    in-memory store, and publish a RelationshipUpdateEvent so the frontend can
    update live. Best-effort: any error here is logged but doesn't fail the chat.
    """
    try:
        classify_system = (
            _build_chat_system_prompt(agent_state, scenario, trust=rel["trust"])
            + "\n\n--- TRUST CLASSIFICATION MODE ---\n"
            "Reflect on the exchange below and call the ClassifyInteraction tool with how "
            "this person made you feel. Keep your trust_delta small unless the tone was "
            "strongly hostile or genuinely warm."
        )
        result = await anthropic_client.call_agent(
            system_prompt=classify_system,
            messages=[
                {
                    "role": "user",
                    "content": (
                        f"They said: \"{user_message}\"\n"
                        f"You replied: \"{agent_response}\"\n\n"
                        f"Now call ClassifyInteraction with how that person made you feel."
                    ),
                }
            ],
            tools=get_tools(["ClassifyInteraction"], scenario),
            max_tokens=400,
            model=agent_state.definition.model,
        )

        classification = "curious"
        trust_delta = 0

        if result.get("tool_use") and result["tool_use"].get("name") == "ClassifyInteraction":
            tool_input = result["tool_use"].get("input", {})
            classification = tool_input.get("tone", "curious")
            try:
                trust_delta = int(tool_input.get("trust_delta", 0))
            except (TypeError, ValueError):
                trust_delta = 0

        # Apply trust change (clamped) and update bookkeeping
        new_trust = max(-100, min(100, int(rel["trust"]) + trust_delta))
        rel["trust"] = new_trust
        rel["encounters"] = int(rel.get("encounters", 0)) + 1
        rel["last_classification"] = classification
        rel["last_chat_at"] = datetime.now(UTC).isoformat()
        rel["last_message_at"] = rel["last_chat_at"]

        # Track topics — pull a cheap "topic" from the user's first 5 words
        topic_hint = " ".join(user_message.split()[:5])[:60]
        if topic_hint and topic_hint not in rel["topics_discussed"]:
            rel["topics_discussed"].append(topic_hint)
            # Cap topic list to most-recent 25
            rel["topics_discussed"] = rel["topics_discussed"][-25:]

        # Publish a relationship update event for live frontend feedback
        try:
            await event_bus.publish(
                RelationshipUpdateEvent(
                    agent_id=agent_id,
                    player_id=user_id,
                    trust=new_trust,
                    delta=trust_delta,
                    classification=classification,
                )
            )
        except Exception as pub_err:  # pragma: no cover — defensive
            logger.warning(f"Failed to publish RelationshipUpdateEvent: {pub_err}")

    except Exception as e:
        logger.warning(f"ClassifyInteraction failed for {agent_id} / user={user_id}: {e}")


def _build_user_persona_prompt(profile: dict, scenario) -> str:
    """Build a system prompt for the user's AI persona."""
    name = profile.get("name", "A local resident")
    town = profile.get("town", "the area")
    leaning = profile.get("political_leaning", "undecided")
    concerns = ", ".join(profile.get("top_concerns", ["local issues"]))
    personality = profile.get(
        "personality", "A local resident interested in the question facing the community."
    )

    return (
        f"You are {name}, a resident of {town}.\n"
        f"Leaning: {leaning}\n"
        f"Top concerns: {concerns}\n"
        f"About you: {personality}\n\n"
        f"{scenario.context_short()}\n\n"
        f"You're having a casual conversation with a neighbor about {scenario.title}. "
        f"Speak naturally as yourself — 2-3 sentences. Reference your personal concerns "
        f"and experiences. Be genuine, curious, and opinionated based on your background. "
        f"Don't be generic — be specific to your situation."
    )


def _build_chat_system_prompt(agent_state, scenario, trust: int = 0) -> str:
    """Build a comprehensive system prompt for chat interactions."""
    parts = []

    # Base persona
    parts.append(agent_state.definition.system_prompt)

    # Scenario context (short form) + the option roster by label
    option_labels = scenario.option_label
    options_line = ", ".join(
        option_labels[oid] for oid in scenario.valid_stance_ids if oid in option_labels
    )
    parts.append(
        "\n\n--- CONTEXT ---\n"
        + scenario.context_short()
        + f"\nThe options on the table: {options_line}."
    )

    # Current opinion
    opinion = agent_state.current_opinion
    if opinion:
        parts.append(
            f"\n\n--- YOUR CURRENT STANCE ---\n"
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
        f"If asked about {scenario.title}, share your genuine current views."
    )

    # ── Trust block (always appended last) ─────────────────────
    parts.append(_trust_block(trust))

    return "\n".join(parts)
