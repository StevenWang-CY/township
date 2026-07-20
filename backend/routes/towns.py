"""
Town data API — the single source of truth for landmark layout, accent color,
weather schedule, and ambient sound. The frontend fetches `/api/towns` at
startup and uses it to drive Phaser TOWN_LANDMARKS / TOWN_ACCENT so backend and
frontend never disagree about coordinates.
"""
import json
import logging
import os

from fastapi import APIRouter, HTTPException

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/towns", tags=["towns"])

# Resolve the data/towns directory relative to this file.
# backend/routes/towns.py -> township/data/towns
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TOWNS_DIR = os.path.join(PROJECT_ROOT, "data", "towns")

# Order matches the canonical NJ-11 demo flow.
TOWN_IDS = ["dover", "montclair", "parsippany", "randolph"]


def _load_town(town_id: str) -> dict | None:
    path = os.path.join(TOWNS_DIR, f"{town_id}.json")
    if not os.path.isfile(path):
        logger.warning(f"Town file not found: {path}")
        return None
    try:
        with open(path) as fh:
            return json.load(fh)
    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON in {path}: {e}")
        return None


@router.get("")
async def get_all_towns():
    """Return the full content of every town's JSON file, keyed by town id."""
    towns: dict[str, dict] = {}
    for town_id in TOWN_IDS:
        data = _load_town(town_id)
        if data is not None:
            towns[town_id] = data
    return {"towns": towns}


@router.get("/{town_id}")
async def get_one_town(town_id: str):
    """Return a single town's JSON or 404 if unknown."""
    if town_id not in TOWN_IDS:
        raise HTTPException(status_code=404, detail=f"Unknown town '{town_id}'")
    data = _load_town(town_id)
    if data is None:
        raise HTTPException(status_code=404, detail=f"Town data missing for '{town_id}'")
    return data
