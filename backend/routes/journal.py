"""
Player journal API — keeps a per-user log of every conversation with every
agent. In-memory with debounced file persistence (data/state/journal.json).
Wire-format matches the Journal panel on the frontend (§5.7 of the
implementation plan).
"""
import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from ..core.storage import STATE_DIR, DebouncedSaver, load_json

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/journal", tags=["journal"])


# In-memory store: user_id -> list of journal entries (most recent last)
_JOURNAL: dict[str, list[dict]] = {}

_JOURNAL_PATH = STATE_DIR / "journal.json"
_journal_saver = DebouncedSaver(_JOURNAL_PATH, lambda: _JOURNAL)


def load_journal_state() -> None:
    """Hydrate the in-memory journal from disk (app startup)."""
    saved = load_json(_JOURNAL_PATH, {})
    if isinstance(saved, dict) and saved:
        _JOURNAL.clear()
        _JOURNAL.update(saved)
        logger.info(f"Loaded journals for {len(_JOURNAL)} user(s) from {_JOURNAL_PATH}")


async def flush_journal_state() -> None:
    """Persist any pending journal changes (app shutdown)."""
    await _journal_saver.aflush()


class JournalMessage(BaseModel):
    role: str            # "user" | "agent"
    content: str
    ts: str | None = None


class JournalEntryRequest(BaseModel):
    user_id: str
    agent_id: str
    agent_name: str | None = None
    town: str | None = None
    transcript: list[JournalMessage] = Field(default_factory=list)
    opinion_before: dict | None = None
    opinion_after: dict | None = None
    trust_before: int | None = None
    trust_after: int | None = None


@router.post("/entry")
async def add_journal_entry(req: JournalEntryRequest, request: Request):
    """Append a new journal entry for this user."""
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
        "opinion_before": req.opinion_before,
        "opinion_after": req.opinion_after,
        "trust_before": req.trust_before,
        "trust_after": req.trust_after,
        "created_at": datetime.now(UTC).isoformat(),
    }
    entries = _JOURNAL.setdefault(req.user_id, [])
    entries.append(entry)
    _journal_saver.mark_dirty()
    return {"status": "ok", "total_entries": len(entries)}


@router.get("/{user_id}")
async def get_journal(user_id: str):
    """Return every journal entry for a single user (most recent last)."""
    return {
        "user_id": user_id,
        "entries": _JOURNAL.get(user_id, []),
    }


@router.delete("/{user_id}")
async def clear_journal(user_id: str):
    """Clear all journal entries for a user (dev convenience)."""
    cleared = len(_JOURNAL.get(user_id, []))
    _JOURNAL[user_id] = []
    if cleared:
        _journal_saver.mark_dirty()
    return {"status": "ok", "cleared": cleared}
