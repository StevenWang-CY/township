"""Capability authentication for browser-private player state.

Township intentionally has no account system.  A random, browser-held
capability therefore acts as the credential for relationship and journal
records.  Only a SHA-256 digest is persisted; the bearer capability itself is
never written to disk, returned in a response, or placed in a URL.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import re
from pathlib import Path
from typing import Any

from fastapi import HTTPException, Request, status

from ..core.storage import STATE_DIR, load_json, load_json_strict, save_json_atomic

logger = logging.getLogger(__name__)

PLAYER_CAPABILITY_HEADER = "X-Township-Player-Capability"
PLAYER_CAPABILITY_MIN_CHARS = 43  # 32 random bytes encoded as base64url
PLAYER_CAPABILITY_MAX_CHARS = 128
PLAYER_CAPABILITY_MAX_USERS = 10_000

_CAPABILITY_RE = re.compile(
    rf"^[A-Za-z0-9_-]{{{PLAYER_CAPABILITY_MIN_CHARS},{PLAYER_CAPABILITY_MAX_CHARS}}}$"
)
_DIGEST_RE = re.compile(r"^[0-9a-f]{64}$")

# user_id -> SHA-256(browser capability)
_PLAYER_CAPABILITIES: dict[str, str] = {}
_CAPABILITY_PATH = STATE_DIR / "player_capabilities.json"
_capability_state_valid = True


def load_player_capability_state() -> None:
    """Load capability digests, failing closed if an existing file is invalid."""
    global _capability_state_valid

    _PLAYER_CAPABILITIES.clear()
    if not _CAPABILITY_PATH.exists():
        _capability_state_valid = True
        return

    saved = load_json(_CAPABILITY_PATH, None)
    valid = (
        isinstance(saved, dict)
        and len(saved) <= PLAYER_CAPABILITY_MAX_USERS
        and all(
            isinstance(user_id, str)
            and isinstance(digest, str)
            and _DIGEST_RE.fullmatch(digest) is not None
            for user_id, digest in saved.items()
        )
    )
    if not valid:
        _capability_state_valid = False
        logger.error(
            "Player capability state at %s is invalid; private state is locked",
            _CAPABILITY_PATH,
        )
        return

    _PLAYER_CAPABILITIES.update(saved)
    _capability_state_valid = True
    if saved:
        logger.info("Loaded capability bindings for %s player(s)", len(saved))


def capability_state_is_valid() -> bool:
    """Whether private state may be served in this process."""
    return _capability_state_valid


def lock_private_state(reason: str) -> None:
    """Fail closed after a private-state migration/persistence failure."""
    global _capability_state_valid
    _capability_state_valid = False
    logger.error("Private player state locked: %s", reason)


def purge_unbound_private_records(
    records: dict[str, Any],
    *,
    path: Path,
    label: str,
) -> dict[str, Any]:
    """Remove pre-capability records before they can be claimed by id.

    Legacy Township versions persisted guessable ``user_id`` keys without a
    credential. No secure migration can infer which browser owns those rows.
    Keeping them would let the first caller bind that id and read the old data,
    so an upgrade removes every unbound record from the active store. A local
    ``*.legacy-unbound.json`` quarantine preserves recovery options, while the
    sanitized active file is written before the app accepts requests.
    """
    if not _capability_state_valid:
        return records
    bound = {
        user_id: value for user_id, value in records.items() if user_id in _PLAYER_CAPABILITIES
    }
    unbound = {
        user_id: value for user_id, value in records.items() if user_id not in _PLAYER_CAPABILITIES
    }
    removed = len(records) - len(bound)
    if not removed:
        return bound

    logger.warning("Purging %s unbound legacy %s record(s)", removed, label)
    try:
        quarantine_path = path.with_name(f"{path.stem}.legacy-unbound{path.suffix}")
        prior_quarantine = load_json_strict(quarantine_path) if quarantine_path.exists() else {}
        if not isinstance(prior_quarantine, dict):
            raise ValueError(f"invalid existing {label} quarantine")
        save_json_atomic(quarantine_path, {**prior_quarantine, **unbound})
        save_json_atomic(path, bound)
    except Exception as exc:
        lock_private_state(f"could not purge unbound legacy {label} records: {exc}")
        return {}
    return bound


async def flush_player_capability_state() -> None:
    """Compatibility hook; credential bindings are persisted synchronously."""


def _unauthorized() -> HTTPException:
    # Use one response for absent, malformed, unknown, and incorrect
    # capabilities so the endpoint does not disclose binding state.
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="A valid player capability is required",
        headers={"Cache-Control": "no-store"},
    )


def require_player_capability(
    request: Request,
    user_id: str,
    *,
    register: bool = False,
) -> None:
    """Authorize ``user_id`` or atomically bind it on its first mutation.

    Reads and destructive operations always pass ``register=False``. Explicit
    registration, chat, and journal writes pass ``register=True`` so a new
    browser profile binds to its secret before private data is returned or
    changed. Uncredentialed legacy rows are quarantined at startup rather than
    made claimable. There is no ``await``
    between lookup, insert, and atomic persistence, keeping first binding
    indivisible within the single-process state model.
    """
    if not _capability_state_valid:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Private player state is temporarily locked",
            headers={"Cache-Control": "no-store"},
        )

    capability = request.headers.get(PLAYER_CAPABILITY_HEADER, "")
    if _CAPABILITY_RE.fullmatch(capability) is None:
        raise _unauthorized()

    digest = hashlib.sha256(capability.encode("ascii")).hexdigest()
    expected = _PLAYER_CAPABILITIES.get(user_id)
    if expected is not None:
        if not hmac.compare_digest(expected, digest):
            raise _unauthorized()
        return

    if not register:
        raise _unauthorized()
    if len(_PLAYER_CAPABILITIES) >= PLAYER_CAPABILITY_MAX_USERS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Player state capacity reached",
        )

    _PLAYER_CAPABILITIES[user_id] = digest
    try:
        # Credential durability must precede relationship/journal mutation. A
        # delayed write could otherwise lose the binding in a crash while a
        # private-data write survives, leaving that record claimable again.
        save_json_atomic(_CAPABILITY_PATH, _PLAYER_CAPABILITIES)
    except Exception as exc:
        _PLAYER_CAPABILITIES.pop(user_id, None)
        logger.error("Could not persist a player capability binding: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Private player state is temporarily unavailable",
            headers={"Cache-Control": "no-store"},
        ) from exc
