"""
Player journal API — keeps a per-user log of every conversation with every
agent. Stored in-memory for the demo (no DB). Wire-format matches the Journal
panel on the frontend (§5.7 of the implementation plan).
"""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/journal", tags=["journal"])


# In-memory store: user_id -> list of journal entries (most recent last)
_JOURNAL: dict[str, list[dict]] = {}


class JournalMessage(BaseModel):
    role: str            # "user" | "agent"
    content: str
    ts: str | None = None


class JournalEntryRequest(BaseModel):
    user_id: str
    agent_id: str
    transcript: list[JournalMessage] = Field(default_factory=list)
    opinion_before: dict | None = None
    opinion_after: dict | None = None
    trust_before: int | None = None
    trust_after: int | None = None


@router.post("/entry")
async def add_journal_entry(req: JournalEntryRequest):
    """Append a new journal entry for this user."""
    entry = {
        "agent_id": req.agent_id,
        "transcript": [m.model_dump() for m in req.transcript],
        "opinion_before": req.opinion_before,
        "opinion_after": req.opinion_after,
        "trust_before": req.trust_before,
        "trust_after": req.trust_after,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    entries = _JOURNAL.setdefault(req.user_id, [])
    entries.append(entry)
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
    return {"status": "ok", "cleared": cleared}
