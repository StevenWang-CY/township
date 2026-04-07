import json
import logging
from pathlib import Path

from fastapi import APIRouter, Request
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/gods-view", tags=["gods-view"])

SCENARIOS_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "god_view_scenarios.json"


@router.get("/scenarios")
async def get_scenarios():
    """Return the curated list of God's View scenarios."""
    try:
        with open(SCENARIOS_PATH, "r") as f:
            scenarios = json.load(f)
        return {"scenarios": scenarios}
    except FileNotFoundError:
        logger.error(f"Scenarios file not found at {SCENARIOS_PATH}")
        return {"scenarios": [], "error": "Scenarios file not found"}
    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON in scenarios file: {e}")
        return {"scenarios": [], "error": "Invalid scenarios file"}


class GodViewRequest(BaseModel):
    description: str


@router.post("")
async def inject_god_view(req: GodViewRequest, request: Request):
    """
    Inject a variable into the simulation and collect all agent reactions.

    Example descriptions:
    - "Hathaway is caught on video saying he would vote to defund Social Security"
    - "A massive factory closure in Dover displaces 200 workers"
    - "Mejia reverses position on Medicare for All, now supports public option"
    """
    orchestrator = request.app.state.orchestrator

    if not req.description.strip():
        return {"status": "error", "message": "Description cannot be empty"}

    reactions = await orchestrator.inject_god_view(req.description)

    # Summarize impact
    impact_summary = {
        "strengthens_current": 0,
        "weakens_current": 0,
        "changes_mind": 0,
        "no_effect": 0,
    }
    emotional_summary = {
        "angry": 0,
        "hopeful": 0,
        "anxious": 0,
        "indifferent": 0,
        "confused": 0,
    }

    for r in reactions:
        impact_summary[r.impact_on_vote] = impact_summary.get(r.impact_on_vote, 0) + 1
        emotional_summary[r.emotional_response] = emotional_summary.get(r.emotional_response, 0) + 1

    # Get before/after opinions for agents whose minds changed
    opinion_shifts = []
    for town_agents in orchestrator.agent_states.values():
        for agent in town_agents:
            if len(agent.opinions) >= 2:
                prev = agent.opinions[-2]
                curr = agent.opinions[-1]
                if prev.candidate != curr.candidate:
                    opinion_shifts.append({
                        "agent": agent.definition.name,
                        "town": agent.definition.town,
                        "before": prev.candidate,
                        "after": curr.candidate,
                        "confidence_change": curr.confidence - prev.confidence,
                    })

    return {
        "status": "complete",
        "description": req.description,
        "total_agents_reacted": len(reactions),
        "reactions": [r.model_dump() for r in reactions],
        "impact_summary": impact_summary,
        "emotional_summary": emotional_summary,
        "opinion_shifts": opinion_shifts,
        "usage": request.app.state.anthropic_client.get_usage_report(),
    }
