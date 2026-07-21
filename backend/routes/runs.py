"""
Persisted-run API — list, inspect, and export the runs/<run_id>/ directories
the orchestrator writes after every completed simulation.

A run id is strictly ``YYYYMMDD-HHMMSS-<scenario-slug>`` (optionally with a
``-N`` collision suffix); anything else — path separators, dots, empty — is
rejected before it ever touches the filesystem, and the resolved directory
must still be a direct child of the runs root. No traversal, ever.
"""
import logging
import re
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from ..core.storage import load_json, runs_root

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/runs", tags=["runs"])

# YYYYMMDD-HHMMSS-<slug> where slug is lowercase alnum/hyphen (no dots, no
# slashes) — matches orchestrator._persist_run, including collision suffixes.
RUN_ID_RE = re.compile(r"^[0-9]{8}-[0-9]{6}-[a-z0-9][a-z0-9-]{0,80}$")


def resolve_run_dir(run_id: str) -> Path | None:
    """Map a run id onto its directory; None for bad ids or missing runs."""
    if not isinstance(run_id, str) or not RUN_ID_RE.match(run_id):
        return None
    root = runs_root().resolve()
    run_dir = (root / run_id).resolve()
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
    if root.is_dir():
        for run_dir in sorted(root.iterdir(), reverse=True):
            if not run_dir.is_dir() or not RUN_ID_RE.match(run_dir.name):
                continue
            summary = load_json(run_dir / "summary.json", {}) or {}
            runs.append({
                "run_id": run_dir.name,
                "scenario_id": summary.get("scenario_id"),
                "scenario_title": summary.get("scenario_title"),
                "started_at": summary.get("started_at"),
                "ended_at": summary.get("ended_at"),
                "counts": summary.get("counts", {}),
                "headline": _headline(summary.get("recap_markdown")),
                "has_events": (run_dir / "events.json").is_file(),
            })
    return {"runs": runs}


@router.get("/{run_id}")
async def get_run(run_id: str):
    """Return one run's full summary.json (recap included)."""
    run_dir = resolve_run_dir(run_id)
    if run_dir is None:
        return JSONResponse(
            {"error": "run_not_found", "run_id": run_id}, status_code=404
        )
    summary = load_json(run_dir / "summary.json")
    if summary is None:
        return JSONResponse(
            {"error": "summary_missing", "run_id": run_id}, status_code=404
        )
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
        return JSONResponse(
            {"error": "run_not_found", "run_id": run_id}, status_code=404
        )
    summary = load_json(run_dir / "summary.json", {}) or {}
    events_doc = load_json(run_dir / "events.json", {}) or {}
    bundle = {
        "run_id": run_dir.name,
        "summary": summary,
        "events": events_doc.get("events", []),
        "recap_markdown": summary.get("recap_markdown"),
    }
    return JSONResponse(
        bundle,
        headers={
            "Content-Disposition": f'attachment; filename="{run_dir.name}.json"'
        },
    )
