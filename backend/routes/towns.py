"""
Town data API — the single source of truth for landmark layout, accent color,
weather schedule, and ambient sound. The frontend fetches `/api/towns` at
startup and uses it to drive Phaser TOWN_LANDMARKS / TOWN_ACCENT so backend and
frontend never disagree about coordinates.

Town content comes from the active scenario (`app.state.scenario`), ordered
by the scenario's `town_order`.
"""

import logging

from fastapi import APIRouter, HTTPException, Request

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/towns", tags=["towns"])


@router.get("")
async def get_all_towns(request: Request):
    """Return the full content of every town's JSON file, keyed by town id."""
    scenario = request.app.state.scenario
    towns: dict[str, dict] = {}
    for town_id in scenario.town_ids:
        data = scenario.towns.get(town_id)
        if data is not None:
            towns[town_id] = data
    return {"towns": towns}


@router.get("/{town_id}")
async def get_one_town(town_id: str, request: Request):
    """Return a single town's JSON or 404 if unknown."""
    scenario = request.app.state.scenario
    data = scenario.towns.get(town_id)
    if data is None:
        raise HTTPException(status_code=404, detail=f"Unknown town '{town_id}'")
    return data
