"""
Player journal API — keeps a per-user log of every conversation with every
agent. In-memory with debounced file persistence (data/state/journal.json).
Wire-format matches the Journal panel on the frontend (§5.7 of the
implementation plan).
"""

import logging
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Path, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from ..core.storage import STATE_DIR, DebouncedSaver, load_json_strict
from .player_state import (
    capability_state_is_valid,
    lock_private_state,
    purge_unbound_private_records,
    require_player_capability,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/journal", tags=["journal"])


# In-memory store: user_id -> list of journal entries (most recent last)
_JOURNAL: dict[str, list[dict]] = {}

_JOURNAL_PATH = STATE_DIR / "journal.json"
_journal_saver = DebouncedSaver(_JOURNAL_PATH, lambda: _JOURNAL)

JOURNAL_ID_MAX_CHARS = 128
JOURNAL_MESSAGE_MAX_CHARS = 4_000
JOURNAL_TRANSCRIPT_MAX_ITEMS = 100
JOURNAL_ENTRIES_PER_USER = 200
JOURNAL_MAX_USERS = 10_000
JournalUserId = Annotated[
    str,
    Path(min_length=1, max_length=JOURNAL_ID_MAX_CHARS, pattern=r"^[A-Za-z0-9._:-]+$"),
]


def load_journal_state() -> None:
    """Hydrate the in-memory journal from disk (app startup)."""
    _JOURNAL.clear()
    if not capability_state_is_valid() or not _JOURNAL_PATH.exists():
        return
    try:
        saved = load_json_strict(_JOURNAL_PATH)
    except Exception as exc:
        lock_private_state(f"journal store could not be read: {exc}")
        return
    if not _valid_journal_store(saved):
        lock_private_state("journal store has an invalid schema")
        return
    saved = purge_unbound_private_records(
        saved,
        path=_JOURNAL_PATH,
        label="journal",
    )
    if not capability_state_is_valid():
        return
    _JOURNAL.update(saved)
    if saved:
        logger.info("Loaded journals for %s user(s) from %s", len(_JOURNAL), _JOURNAL_PATH)


async def flush_journal_state() -> None:
    """Persist any pending journal changes (app shutdown)."""
    await _journal_saver.aflush()


async def _persist_journal_state() -> None:
    """Durably write a mutation before returning a successful response."""
    _journal_saver.mark_dirty()
    try:
        await _journal_saver.aflush()
    except Exception as exc:
        lock_private_state(f"journal persistence failed: {exc}")
        raise HTTPException(
            status_code=503,
            detail="Private player state is temporarily unavailable",
            headers={"Cache-Control": "no-store"},
        ) from exc


class JournalMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "agent"]
    content: str = Field(min_length=1, max_length=JOURNAL_MESSAGE_MAX_CHARS)
    ts: str | None = Field(default=None, max_length=64)


class JournalOpinion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    candidate: str = Field(min_length=1, max_length=JOURNAL_ID_MAX_CHARS)
    confidence: int = Field(ge=0, le=100)
    reasoning: str = Field(default="", max_length=8_000)
    top_issues: list[Annotated[str, Field(max_length=500)]] = Field(
        default_factory=list,
        max_length=20,
    )
    dealbreaker: str | None = Field(default=None, max_length=2_000)
    round_number: int | None = Field(default=None, ge=0, le=10_000)


class JournalEntryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: str = Field(
        min_length=1,
        max_length=JOURNAL_ID_MAX_CHARS,
        pattern=r"^[A-Za-z0-9._:-]+$",
    )
    agent_id: str = Field(min_length=1, max_length=JOURNAL_ID_MAX_CHARS)
    agent_name: str | None = Field(default=None, max_length=200)
    town: str | None = Field(default=None, max_length=JOURNAL_ID_MAX_CHARS)
    transcript: list[JournalMessage] = Field(
        default_factory=list,
        max_length=JOURNAL_TRANSCRIPT_MAX_ITEMS,
    )
    opinion_before: JournalOpinion | None = None
    opinion_after: JournalOpinion | None = None
    trust_before: int | None = Field(default=None, ge=-100, le=100)
    trust_after: int | None = Field(default=None, ge=-100, le=100)


class JournalStoredEntry(BaseModel):
    """Exact on-disk journal row shape."""

    model_config = ConfigDict(extra="forbid")

    agent_id: str = Field(min_length=1, max_length=JOURNAL_ID_MAX_CHARS)
    agent_name: str | None = Field(default=None, max_length=200)
    town: str | None = Field(default=None, max_length=JOURNAL_ID_MAX_CHARS)
    transcript: list[JournalMessage] = Field(max_length=JOURNAL_TRANSCRIPT_MAX_ITEMS)
    opinion_before: JournalOpinion | None = None
    opinion_after: JournalOpinion | None = None
    trust_before: int | None = Field(default=None, ge=-100, le=100)
    trust_after: int | None = Field(default=None, ge=-100, le=100)
    created_at: str = Field(min_length=1, max_length=64)


def _valid_journal_store(value) -> bool:
    if not isinstance(value, dict) or len(value) > JOURNAL_MAX_USERS:
        return False
    for user_id, entries in value.items():
        if (
            not isinstance(user_id, str)
            or not (1 <= len(user_id) <= JOURNAL_ID_MAX_CHARS)
            or any(
                character
                not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:-"
                for character in user_id
            )
            or not isinstance(entries, list)
            or len(entries) > JOURNAL_ENTRIES_PER_USER
        ):
            return False
        try:
            for entry in entries:
                JournalStoredEntry.model_validate(entry)
        except ValidationError:
            return False
    return True


@router.post("/entry")
async def add_journal_entry(req: JournalEntryRequest, request: Request):
    """Append a new journal entry for this user."""
    require_player_capability(request, req.user_id, register=True)
    if req.user_id not in _JOURNAL and len(_JOURNAL) >= JOURNAL_MAX_USERS:
        raise HTTPException(status_code=429, detail="Journal user capacity reached")
    # Resolve agent_name / town: prefer values from the request body, fall back
    # to the orchestrator's agent state when available.
    agent_name = req.agent_name
    town = req.town
    if agent_name is None or town is None:
        orchestrator = getattr(request.app.state, "orchestrator", None)
        if orchestrator is not None:
            state = orchestrator.get_agent_state(req.agent_id)
            if state is not None:
                if agent_name is None:
                    agent_name = state.definition.name
                if town is None:
                    town = state.definition.town

    entry = {
        "agent_id": req.agent_id,
        "agent_name": agent_name,
        "town": town,
        "transcript": [m.model_dump() for m in req.transcript],
        "opinion_before": req.opinion_before.model_dump() if req.opinion_before else None,
        "opinion_after": req.opinion_after.model_dump() if req.opinion_after else None,
        "trust_before": req.trust_before,
        "trust_after": req.trust_after,
        "created_at": datetime.now(UTC).isoformat(),
    }
    entries = _JOURNAL.setdefault(req.user_id, [])
    entries.append(entry)
    if len(entries) > JOURNAL_ENTRIES_PER_USER:
        del entries[:-JOURNAL_ENTRIES_PER_USER]
    await _persist_journal_state()
    return {"status": "ok", "total_entries": len(entries)}


@router.get("/{user_id}")
async def get_journal(user_id: JournalUserId, request: Request):
    """Return every journal entry for a single user (most recent last)."""
    require_player_capability(request, user_id)
    return JSONResponse(
        content={
            "user_id": user_id,
            "entries": _JOURNAL.get(user_id, []),
        },
        headers={"Cache-Control": "no-store"},
    )


@router.delete("/{user_id}")
async def clear_journal(user_id: JournalUserId, request: Request):
    """Clear all journal entries for a user (dev convenience)."""
    require_player_capability(request, user_id)
    existing = _JOURNAL.pop(user_id, None)
    cleared = len(existing) if existing is not None else 0
    if existing is not None:
        await _persist_journal_state()
    return {"status": "ok", "cleared": cleared}
