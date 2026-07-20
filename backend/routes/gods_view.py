import json
import logging

from fastapi import APIRouter, Request
from pydantic import BaseModel

from ..core.types import GodsViewResultEvent
from ..core.wire import news_reaction_to_wire

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/gods-view", tags=["gods-view"])


@router.get("/scenarios")
async def get_scenarios(request: Request):
    """Return the curated God's View injections for the active scenario."""
    # The Scenario owns this path: scenarios/<id>/god-scenarios.json normally,
    # data/god_view_scenarios.json when the deprecated legacy layout loaded.
    scenarios_path = request.app.state.scenario.god_scenarios_path
    try:
        with open(scenarios_path) as f:
            scenarios = json.load(f)
        return {"scenarios": scenarios}
    except FileNotFoundError:
        logger.warning(f"God's View scenarios file not found at {scenarios_path}")
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

    Example descriptions (adapt to the active scenario):
    - "A leading option's champion is caught on video contradicting a core promise"
    - "A major local employer announces a shutdown, displacing hundreds of workers"
    - "One option's backers reverse a signature position days before the decision"
    """
    orchestrator = request.app.state.orchestrator
    event_bus = request.app.state.event_bus

    if not req.description.strip():
        return {"status": "error", "message": "Description cannot be empty"}

    reactions = await orchestrator.inject_god_view(req.description)

    # Convert to wire-format dicts (frontend NewsReaction shape).
    wire_reactions = [
        news_reaction_to_wire(
            r,
            agent_id=r.agent_id,
            town=r.town,
            headline=req.description,
        )
        for r in reactions
    ]

    # Broadcast the full reaction set (wire-format dicts so HTTP body + WS
    # event publish the exact same shape — see frontend NewsReaction).
    try:
        await event_bus.publish(
            GodsViewResultEvent(prompt=req.description, reactions=wire_reactions)
        )
    except Exception as e:  # pragma: no cover — defensive
        logger.warning(f"GodsViewResultEvent publish failed: {e}")

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
        "reactions": wire_reactions,
        "impact_summary": impact_summary,
        "emotional_summary": emotional_summary,
        "opinion_shifts": opinion_shifts,
        "usage": request.app.state.anthropic_client.get_usage_report(),
    }
