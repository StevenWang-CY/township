"""Version markers for replayable/public simulation artifacts.

Artifacts created before the browser-private chat boundary can contain
ordinary-looking speech, opinion reasoning, or recap prose derived from a
private exchange. Those records cannot be reliably identified by event type
after the fact, so unversioned artifacts must never be served or replayed.
"""

from __future__ import annotations

from typing import Any

ARTIFACT_SCHEMA_VERSION = 1
ARTIFACT_PRIVACY_VERSION = 1
LEGACY_ARTIFACT_MESSAGE = (
    "This artifact predates Township's private-player boundary and cannot be "
    "shared or replayed. Regenerate it with this version."
)


class ArtifactPrivacyError(RuntimeError):
    """Raised when an artifact lacks an explicit current privacy marker."""


class ArtifactFormatError(ValueError):
    """Raised when a marked replay artifact has an unsafe/invalid shape."""


def artifact_version_fields() -> dict[str, int]:
    """Return the canonical version fields stamped into every new artifact."""
    return {
        "schema_version": ARTIFACT_SCHEMA_VERSION,
        "privacy_version": ARTIFACT_PRIVACY_VERSION,
    }


def is_public_artifact(document: Any) -> bool:
    """Whether an artifact is explicitly safe for public serving/replay."""
    return (
        isinstance(document, dict)
        and document.get("schema_version") == ARTIFACT_SCHEMA_VERSION
        and document.get("privacy_version") == ARTIFACT_PRIVACY_VERSION
    )


def require_public_artifact(document: Any) -> None:
    """Reject unversioned/obsolete artifacts without inspecting their prose."""
    if not is_public_artifact(document):
        raise ArtifactPrivacyError(LEGACY_ARTIFACT_MESSAGE)


def require_replay_artifact(document: Any) -> list[dict]:
    """Validate the common replay envelope and return its event list."""
    require_public_artifact(document)
    events = document.get("events")
    if (
        not isinstance(events, list)
        or len(events) > 1_000_000
        or any(
            not isinstance(event, dict)
            or not isinstance(event.get("type"), str)
            or not event["type"]
            for event in events
        )
    ):
        raise ArtifactFormatError("replay artifact has an invalid events array")
    return events
