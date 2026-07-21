"""
Scenario bootstrap API — the single payload the frontend fetches at startup
to learn what this deployment is deliberating: the question, the options
(ids, labels, colors), the towns, and the round count. Everything the UI
used to hardcode about NJ-11 comes from here now.
"""

import logging

from fastapi import APIRouter, Request

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/scenario", tags=["scenario"])


@router.get("")
async def get_scenario(request: Request):
    """Return the active scenario's bootstrap payload."""
    scenario = request.app.state.scenario
    config = scenario.config

    towns = []
    for town_id in scenario.town_ids:
        town = scenario.towns.get(town_id, {})
        entry = {
            "id": town_id,
            "name": town.get("name", town_id.replace("-", " ").title()),
            "tagline": town.get("tagline", ""),
            "color": scenario.town_color(town_id),
            "county": town.get("county", ""),
            "map": town.get("map"),
        }
        population = (town.get("demographics") or {}).get("population")
        if population is not None:
            entry["population"] = population
        towns.append(entry)

    return {
        "id": scenario.id,
        "title": scenario.title,
        "question": scenario.question,
        "decision_kind": config.kind,
        "options": [
            {"id": o.id, "name": o.name, "label": o.label, "color": o.color, "group": o.group}
            for o in config.options
        ],
        "undecided": {
            "id": config.undecided.id,
            "label": config.undecided.label,
            "color": config.undecided.color,
        },
        "towns": towns,
        "total_rounds": scenario.total_rounds,
        "dates": {
            "decision_day": config.dates.decision_day,
            "prose": config.dates.prose,
        },
        "responsible_use": config.responsible_use.model_dump(),
    }
