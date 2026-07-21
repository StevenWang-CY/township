"""
Persisted-run API — list, inspect, and export the runs/<run_id>/ directories
the orchestrator writes after every completed simulation.

A run id is strictly ``YYYYMMDD-HHMMSS-<scenario-slug>-<unique-suffix>``;
anything else — path separators, dots, empty — is rejected before it ever
touches the filesystem, and the directory must be a real, direct child of the
runs root rather than a symlink alias. No traversal, ever.
"""

import logging
import re
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from ..core.artifacts import (
    LEGACY_ARTIFACT_MESSAGE,
    ArtifactFormatError,
    ArtifactPrivacyError,
    artifact_version_fields,
    is_public_artifact,
    require_replay_artifact,
)
from ..core.storage import load_json, runs_root
from ..core.types import is_private_event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/runs", tags=["runs"])

# YYYYMMDD-HHMMSS-<slug>-<unique suffix>, all lowercase alnum/hyphen (no dots
# or slashes) — matches orchestrator._persist_run.
RUN_ID_RE = re.compile(r"^[0-9]{8}-[0-9]{6}-[a-z0-9][a-z0-9-]{0,80}$")


def _legacy_artifact_response(run_id: str) -> JSONResponse:
    return JSONResponse(
        {
            "error": "legacy_artifact_restricted",
            "run_id": run_id,
            "message": LEGACY_ARTIFACT_MESSAGE,
        },
        status_code=409,
        headers={"Cache-Control": "no-store"},
    )


def resolve_run_dir(run_id: str) -> Path | None:
    """Map a run id onto its directory; None for bad ids or missing runs."""
    if not isinstance(run_id, str) or not RUN_ID_RE.match(run_id):
        return None
    root = runs_root().resolve()
    candidate = root / run_id
    if candidate.is_symlink():
        return None
    run_dir = candidate.resolve()
    # Belt and braces: even a regex-valid id must resolve to a direct child.
    if run_dir.parent != root or not run_dir.is_dir():
        return None
    return run_dir


def _headline(recap_markdown: str | None) -> str:
    from ..simulation.recap import recap_headline

    return recap_headline(recap_markdown or "")


@router.get("")
async def list_runs():
    """List persisted runs, newest first (summary metadata only)."""
    root = runs_root()
    runs: list[dict] = []
    restricted_legacy_runs = 0
    if root.is_dir():
        for run_dir in sorted(root.iterdir(), reverse=True):
            if (
                run_dir.is_symlink()
                or not run_dir.is_dir()
                or not RUN_ID_RE.match(run_dir.name)
            ):
                continue
            summary = load_json(run_dir / "summary.json", {}) or {}
            if not is_public_artifact(summary):
                restricted_legacy_runs += 1
                continue
            runs.append(
                {
                    "run_id": run_dir.name,
                    "scenario_id": summary.get("scenario_id"),
                    "scenario_title": summary.get("scenario_title"),
                    "started_at": summary.get("started_at"),
                    "ended_at": summary.get("ended_at"),
                    "counts": summary.get("counts", {}),
                    "headline": _headline(summary.get("recap_markdown")),
                    "has_events": (run_dir / "events.json").is_file(),
                }
            )
    return {"runs": runs, "restricted_legacy_runs": restricted_legacy_runs}


@router.get("/{run_id}")
async def get_run(run_id: str):
    """Return one run's full summary.json (recap included)."""
    run_dir = resolve_run_dir(run_id)
    if run_dir is None:
        return JSONResponse({"error": "run_not_found", "run_id": run_id}, status_code=404)
    summary = load_json(run_dir / "summary.json")
    if summary is None:
        return JSONResponse({"error": "summary_missing", "run_id": run_id}, status_code=404)
    if not is_public_artifact(summary):
        return _legacy_artifact_response(run_id)
    return summary


@router.get("/{run_id}/export")
async def export_run(run_id: str):
    """Download the whole run as one self-contained JSON bundle.

    The bundle carries the summary plus the full event log — the same shape
    the demo player and /api/simulation/replay consume — so an exported run
    is directly shareable and replayable.
    """
    run_dir = resolve_run_dir(run_id)
    if run_dir is None:
        return JSONResponse({"error": "run_not_found", "run_id": run_id}, status_code=404)
    summary = load_json(run_dir / "summary.json", {}) or {}
    events_doc = load_json(run_dir / "events.json", {}) or {}
    if not is_public_artifact(summary) or not is_public_artifact(events_doc):
        return _legacy_artifact_response(run_id)
    try:
        events = require_replay_artifact(events_doc)
    except (ArtifactFormatError, ArtifactPrivacyError):
        return JSONResponse(
            {"error": "artifact_invalid", "run_id": run_id},
            status_code=409,
            headers={"Cache-Control": "no-store"},
        )
    public_events = [event for event in events if not is_private_event(event)]
    bundle = {
        **artifact_version_fields(),
        "run_id": run_dir.name,
        "summary": summary,
        "events": public_events,
        "recap_markdown": summary.get("recap_markdown"),
    }
    return JSONResponse(
        bundle,
        headers={"Content-Disposition": f'attachment; filename="{run_dir.name}.json"'},
    )
