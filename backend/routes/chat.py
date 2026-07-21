import logging
import re
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, StringConstraints

from ..core.storage import STATE_DIR, DebouncedSaver, load_json_strict
from ..core.wire import opinion_to_wire
from ..tools.schemas import get_tools
from .player_state import (
    PLAYER_CAPABILITY_MAX_USERS,
    capability_state_is_valid,
    flush_player_capability_state,
    load_player_capability_state,
    lock_private_state,
    purge_unbound_private_records,
    require_player_capability,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["chat"])


# ─── Relationship store (in-memory, file-persisted) ────────────
# Layout: { user_id: { agent_id: { trust, encounters, topics_discussed, ... } } }
_RELATIONSHIPS: dict[str, dict[str, dict]] = {}

_REL_PATH = STATE_DIR / "relationships.json"
_rel_saver = DebouncedSaver(_REL_PATH, lambda: _RELATIONSHIPS)


def load_relationship_state() -> None:
    """Hydrate the in-memory store from disk (app startup)."""
    _RELATIONSHIPS.clear()
    load_player_capability_state()
    if not capability_state_is_valid() or not _REL_PATH.exists():
        return
    try:
        saved = load_json_strict(_REL_PATH)
    except Exception as exc:
        lock_private_state(f"relationship store could not be read: {exc}")
        return
    if not _valid_relationship_store(saved):
        lock_private_state("relationship store has an invalid schema")
        return
    saved = purge_unbound_private_records(
        saved,
        path=_REL_PATH,
        label="relationship",
    )
    if not capability_state_is_valid():
        return
    _RELATIONSHIPS.update(saved)
    if saved:
        logger.info(
            "Loaded relationships for %s user(s) from %s",
            len(_RELATIONSHIPS),
            _REL_PATH,
        )


async def flush_relationship_state() -> None:
    """Persist any pending relationship changes (app shutdown)."""
    await _rel_saver.aflush()
    await flush_player_capability_state()


async def _persist_relationship_state() -> None:
    """Durably write a mutation before an endpoint acknowledges it."""
    _rel_saver.mark_dirty()
    try:
        await _rel_saver.aflush()
    except Exception as exc:
        lock_private_state(f"relationship persistence failed: {exc}")
        raise HTTPException(
            status_code=503,
            detail="Private player state is temporarily unavailable",
            headers={"Cache-Control": "no-store"},
        ) from exc


def _default_rel() -> dict:
    return {
        "trust": 0,
        "encounters": 0,
        "topics_discussed": [],
        "last_chat_at": None,
        "last_message_at": None,
        "last_classification": None,
    }


def _valid_relationship_store(value) -> bool:
    """Validate persisted values before any private record reaches memory."""
    if not isinstance(value, dict) or len(value) > PLAYER_CAPABILITY_MAX_USERS:
        return False
    user_id_re = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
    allowed = {
        "trust",
        "encounters",
        "topics_discussed",
        "last_chat_at",
        "last_message_at",
        "last_classification",
        "player_revealed_to_them",
    }
    required = set(_default_rel())
    for user_id, agent_map in value.items():
        if not isinstance(user_id, str) or user_id_re.fullmatch(user_id) is None:
            return False
        if not isinstance(agent_map, dict) or len(agent_map) > 1_000:
            return False
        for agent_id, rel in agent_map.items():
            if not isinstance(agent_id, str) or not (1 <= len(agent_id) <= 128):
                return False
            if not isinstance(rel, dict) or not required.issubset(rel) or not set(rel) <= allowed:
                return False
            trust = rel.get("trust")
            encounters = rel.get("encounters")
            topics = rel.get("topics_discussed")
            if (
                isinstance(trust, bool)
                or not isinstance(trust, int)
                or not -100 <= trust <= 100
                or isinstance(encounters, bool)
                or not isinstance(encounters, int)
                or not 0 <= encounters <= 1_000_000
                or not isinstance(topics, list)
                or len(topics) > 25
                or any(not isinstance(topic, str) or len(topic) > 60 for topic in topics)
            ):
                return False
            for field in ("last_chat_at", "last_message_at", "last_classification"):
                item = rel.get(field)
                if item is not None and (not isinstance(item, str) or len(item) > 128):
                    return False
            revealed = rel.get("player_revealed_to_them")
            if revealed is not None:
                if not isinstance(revealed, dict) or not set(revealed) <= {
                    "name",
                    "town",
                    "leaning",
                    "concerns",
                }:
                    return False
                if any(
                    not isinstance(item, str) or len(item) > PROFILE_TEXT_MAX_CHARS
                    for key, item in revealed.items()
                    if key != "concerns"
                ):
                    return False
                concerns = revealed.get("concerns", [])
                if (
                    not isinstance(concerns, list)
                    or len(concerns) > PROFILE_CONCERNS_MAX_ITEMS
                    or any(
                        not isinstance(item, str) or len(item) > PROFILE_TEXT_MAX_CHARS
                        for item in concerns
                    )
                ):
                    return False
    return True


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
    return "hostile"


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

CHAT_MESSAGE_MAX_CHARS = 4_000
CHAT_HISTORY_MAX_ITEMS = 12
PROFILE_TEXT_MAX_CHARS = 200
PROFILE_CONCERNS_MAX_ITEMS = 10

ChatText = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=CHAT_MESSAGE_MAX_CHARS,
    ),
]
ProfileText = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=PROFILE_TEXT_MAX_CHARS,
    ),
]
UserId = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=128,
        pattern=r"^[A-Za-z0-9._:-]+$",
    ),
]


class ChatUserProfile(BaseModel):
    """The bounded subset of player details that can enter an LLM prompt."""

    name: ProfileText | None = None
    town: ProfileText | None = None
    political_leaning: ProfileText | None = None
    leaning: ProfileText | None = None
    personality: (
        Annotated[
            str,
            StringConstraints(strip_whitespace=True, max_length=1_000),
        ]
        | None
    ) = None
    top_concerns: Annotated[list[ProfileText], Field(max_length=PROFILE_CONCERNS_MAX_ITEMS)] = (
        Field(default_factory=list)
    )


class ConversationMessage(BaseModel):
    role: Literal["user", "agent"]
    content: ChatText


class ChatRequest(BaseModel):
    message: ChatText
    user_profile: ChatUserProfile | None = None
    user_id: UserId | None = None


class ChatResponse(BaseModel):
    response: str
    agent_id: str
    agent_name: str
    opinion: dict | None = None
    opinion_changed: bool = False
    trust: int = 0
    trust_band: str = "warming"
    relationship: dict | None = None


class AutoChatRequest(BaseModel):
    user_profile: ChatUserProfile
    conversation_history: Annotated[
        list[ConversationMessage], Field(max_length=CHAT_HISTORY_MAX_ITEMS)
    ] = Field(default_factory=list)
    user_id: UserId | None = None


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
    relationship: dict | None = None


# ─── Relationship endpoints ───────────────────────────────────


class PlayerCapabilityRegistration(BaseModel):
    user_id: UserId


@router.post("/relationships/register")
async def register_player_capability(
    req: PlayerCapabilityRegistration,
    request: Request,
):
    """Bind or verify the browser capability without returning private data."""
    require_player_capability(request, req.user_id, register=True)
    return JSONResponse(
        content={"status": "ok"},
        headers={"Cache-Control": "no-store"},
    )


@router.get("/relationships/{user_id}")
async def get_relationships(user_id: UserId, request: Request):
    """Return a player's relationships after capability authentication."""
    require_player_capability(request, user_id)
    return JSONResponse(
        content={
            "user_id": user_id,
            "relationships": _RELATIONSHIPS.get(user_id, {}),
        },
        headers={"Cache-Control": "no-store"},
    )


class ResetRequest(BaseModel):
    user_id: UserId
    agent_id: str | None = None


@router.post("/relationships/reset")
async def reset_relationships(req: ResetRequest, request: Request):
    """Reset a single agent's relationship for a user, or all if agent_id omitted."""
    require_player_capability(request, req.user_id)
    if req.user_id not in _RELATIONSHIPS:
        return {"status": "ok", "cleared": 0}
    removed_empty_user = False
    if req.agent_id:
        cleared = 1 if _RELATIONSHIPS[req.user_id].pop(req.agent_id, None) else 0
        if not _RELATIONSHIPS[req.user_id]:
            _RELATIONSHIPS.pop(req.user_id, None)
            removed_empty_user = True
    else:
        cleared = len(_RELATIONSHIPS[req.user_id])
        _RELATIONSHIPS.pop(req.user_id, None)
        removed_empty_user = True
    if cleared or removed_empty_user:
        await _persist_relationship_state()
    return {"status": "ok", "cleared": cleared}


# ─── Chat endpoints ───────────────────────────────────────────


@router.post("/{agent_id}")
async def chat_with_agent(
    agent_id: str,
    req: ChatRequest,
    request: Request,
    response: Response,
) -> ChatResponse:
    """Chat with a specific agent in character. The agent responds based on their full persona and memories."""
    orchestrator = request.app.state.orchestrator
    anthropic_client = request.app.state.anthropic_client
    scenario = request.app.state.scenario

    # Find the agent
    agent_state = orchestrator.get_agent_state(agent_id)
    if agent_state is None:
        return JSONResponse(
            status_code=404,
            content={"error": "agent_not_found", "agent_id": agent_id},
        )

    persistent_relationship = req.user_id is not None
    if req.user_id is not None:
        require_player_capability(request, req.user_id, register=True)
        rel = _get_rel(req.user_id, agent_id)
    else:
        # API clients that omit browser identity retain the legacy chat UX, but
        # their trust state is request-local rather than shared under "local".
        rel = _default_rel()

    # Persist what the player has revealed about themselves so future turns and
    # other systems can reference it (§5.2).
    profile = (
        req.user_profile.model_dump(exclude_none=True, exclude_defaults=True)
        if req.user_profile
        else None
    )
    # Build system prompt with full context (including trust)
    system_prompt = _build_chat_system_prompt(agent_state, scenario, trust=rel["trust"])

    # Enrich the user message with profile context if available
    if profile:
        p = profile
        user_intro = (
            f"A person named {p.get('name', 'someone')} from {p.get('town', 'the area')}, "
            f"who cares about {', '.join(p.get('top_concerns', ['local issues']))}, "
            f'approaches you and says: "{req.message}"'
        )
    else:
        user_intro = f'A person approaches you and says: "{req.message}"'

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

    if profile:
        _record_player_reveal(rel, profile, persist=False)

    # Update relationship (best-effort classify call)
    await _classify_and_update_trust(
        anthropic_client=anthropic_client,
        agent_state=agent_state,
        scenario=scenario,
        agent_id=agent_id,
        rel=rel,
        user_message=req.message,
        agent_response=response_text,
        persist=False,
    )
    if persistent_relationship:
        await _persist_relationship_state()

    response.headers["Cache-Control"] = "no-store"
    return ChatResponse(
        response=response_text,
        agent_id=agent_id,
        agent_name=agent_state.definition.name,
        opinion=opinion_to_wire(agent_state.current_opinion),
        # A one-viewer conversation must not mutate or publish the shared
        # simulation opinion. The private trust relationship still evolves.
        opinion_changed=False,
        trust=rel["trust"],
        trust_band=_trust_band(rel["trust"]),
        relationship=dict(rel) if persistent_relationship else None,
    )


@router.post("/auto/{agent_id}")
async def auto_chat(
    agent_id: str,
    req: AutoChatRequest,
    request: Request,
    response: Response,
) -> AutoChatResponse:
    """Auto-agent mode: generate both user and agent messages for a natural conversation."""
    orchestrator = request.app.state.orchestrator
    anthropic_client = request.app.state.anthropic_client
    scenario = request.app.state.scenario

    agent_state = orchestrator.get_agent_state(agent_id)
    if agent_state is None:
        return JSONResponse(
            status_code=404,
            content={"error": "agent_not_found", "agent_id": agent_id},
        )

    persistent_relationship = req.user_id is not None
    if req.user_id is not None:
        require_player_capability(request, req.user_id, register=True)
        rel = _get_rel(req.user_id, agent_id)
    else:
        rel = _default_rel()

    p = req.user_profile.model_dump(exclude_none=True, exclude_defaults=True)
    turn_num = len(req.conversation_history) // 2

    # ── Step 1: Generate user's message ──────────────────────
    user_persona_prompt = _build_user_persona_prompt(p, scenario)

    user_context = ""
    if req.conversation_history:
        user_context = "\n\nConversation so far:\n"
        for msg in req.conversation_history[-6:]:
            role = "You" if msg.role == "user" else agent_state.definition.name
            user_context += f"{role}: {msg.content}\n"

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

    if user_result.get("stop_reason") == "error":
        logger.error("Auto-chat user-persona call errored for %s", agent_id)
        return JSONResponse(
            status_code=503,
            content={
                "error": "llm_unavailable",
                "message": "Could not continue this conversation right now.",
            },
        )

    user_message = user_result.get("text") or f"What do you think about {scenario.title}?"

    # ── Step 2: Generate agent's response ────────────────────
    agent_system = _build_chat_system_prompt(agent_state, scenario, trust=rel["trust"])

    if p:
        user_intro = (
            f"A person named {p.get('name', 'someone')} from {p.get('town', 'the area')}, "
            f"who cares about {', '.join(p.get('top_concerns', ['local issues']))}, "
            f'says: "{user_message}"'
        )
    else:
        user_intro = f'Someone says: "{user_message}"'

    # Include conversation history for context
    history_ctx = ""
    if req.conversation_history:
        history_ctx = "\n\nEarlier in this conversation:\n"
        for msg in req.conversation_history[-6:]:
            role = p.get("name", "Them") if msg.role == "user" else "You"
            history_ctx += f"{role}: {msg.content}\n"

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

    if p:
        _record_player_reveal(rel, p, persist=False)

    # Update relationship (best-effort classify call)
    await _classify_and_update_trust(
        anthropic_client=anthropic_client,
        agent_state=agent_state,
        scenario=scenario,
        agent_id=agent_id,
        rel=rel,
        user_message=user_message,
        agent_response=agent_response,
        persist=False,
    )
    if persistent_relationship:
        await _persist_relationship_state()

    # Determine if conversation should end
    should_end = turn_num >= 3

    response.headers["Cache-Control"] = "no-store"
    return AutoChatResponse(
        user_message=user_message,
        agent_response=agent_response,
        agent_id=agent_id,
        agent_name=agent_state.definition.name,
        should_end=should_end,
        opinion=opinion_to_wire(agent_state.current_opinion),
        opinion_changed=False,
        trust=rel["trust"],
        trust_band=_trust_band(rel["trust"]),
        relationship=dict(rel) if persistent_relationship else None,
    )


# ─── Helpers ──────────────────────────────────────────────────


def _record_player_reveal(rel: dict, profile: dict, *, persist: bool = True) -> None:
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
    if persist:
        _rel_saver.mark_dirty()


async def _classify_and_update_trust(
    *,
    anthropic_client,
    agent_state,
    scenario,
    agent_id: str,
    rel: dict,
    user_message: str,
    agent_response: str,
    persist: bool = True,
) -> None:
    """
    Make a SMALL ClassifyInteraction call, apply the trust delta, persist to the
    in-memory store.  The caller returns the private relationship directly in
    its HTTP response; it must never enter the global simulation event bus.
    Best-effort: any error here is logged but doesn't fail the chat.
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
                        f'They said: "{user_message}"\n'
                        f'You replied: "{agent_response}"\n\n'
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
            raw_classification = tool_input.get("tone", "curious")
            classification = (
                raw_classification
                if isinstance(raw_classification, str)
                and raw_classification in {"agreeable", "challenging", "curious", "hostile"}
                else "curious"
            )
            try:
                trust_delta = max(-15, min(15, int(tool_input.get("trust_delta", 0))))
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

        if persist:
            _rel_saver.mark_dirty()

    except Exception as e:
        logger.warning("ClassifyInteraction failed for %s: %s", agent_id, e)


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
            "\n\n--- WHAT YOU'VE BEEN UP TO LATELY ---\n" + "\n".join(f"- {m}" for m in recent)
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
