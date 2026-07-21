import logging
from typing import Annotated

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, StringConstraints

from ..core.types import GodsViewResultEvent
from ..core.wire import news_reaction_to_wire

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/gods-view", tags=["gods-view"])

GOD_VIEW_PROMPT_MAX_CHARS = 4_000


@router.get("/scenarios")
async def get_scenarios(request: Request):
    """Return the curated God's View injections for the active scenario."""
    # Package loading already validates structure, ids, town references, and
    # symlink containment. Routes never reopen an unchecked scenario path.
    return {"scenarios": request.app.state.scenario.god_scenarios}


class GodViewRequest(BaseModel):
    description: Annotated[
        str,
        StringConstraints(
            strip_whitespace=True,
            min_length=1,
            max_length=GOD_VIEW_PROMPT_MAX_CHARS,
        ),
    ]


async def _run_reserved_injection(
    req: GodViewRequest,
    request: Request,
    operation_token: str,
) -> dict:
    """Execute and summarize one already-reserved injection."""
    orchestrator = request.app.state.orchestrator
    event_bus = request.app.state.event_bus
    scenario = request.app.state.scenario
    before_by_agent = {}
    opinion_distribution_before = {stance: 0 for stance in scenario.valid_stance_ids}
    for town_agents in orchestrator.agent_states.values():
        for agent in town_agents:
            opinion = agent.current_opinion
            candidate = opinion.candidate if opinion else scenario.undecided_id
            confidence = opinion.confidence if opinion else 0
            before_by_agent[agent.agent_id] = (candidate, confidence)
            opinion_distribution_before[candidate] = (
                opinion_distribution_before.get(candidate, 0) + 1
            )

    reactions = await orchestrator.inject_god_view(
        req.description,
        _operation_token=operation_token,
    )

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

    # Compare against the exact pre-injection snapshot. Looking at the last
    # two lifetime opinions would falsely attribute an older simulation shift
    # to a new injection that had no effect.
    opinion_shifts = []
    opinion_distribution_after = {stance: 0 for stance in scenario.valid_stance_ids}
    for town_agents in orchestrator.agent_states.values():
        for agent in town_agents:
            current = agent.current_opinion
            after_candidate = current.candidate if current else scenario.undecided_id
            after_confidence = current.confidence if current else 0
            opinion_distribution_after[after_candidate] = (
                opinion_distribution_after.get(after_candidate, 0) + 1
            )
            before_candidate, before_confidence = before_by_agent[agent.agent_id]
            if before_candidate != after_candidate:
                opinion_shifts.append(
                    {
                        "agent": agent.definition.name,
                        "town": agent.definition.town,
                        "before": before_candidate,
                        "after": after_candidate,
                        "confidence_change": after_confidence - before_confidence,
                    }
                )

    return {
        "status": "complete",
        "description": req.description,
        "total_agents_reacted": len(reactions),
        "reactions": wire_reactions,
        "impact_summary": impact_summary,
        "emotional_summary": emotional_summary,
        "opinion_shifts": opinion_shifts,
        "opinion_distribution_before": opinion_distribution_before,
        "opinion_distribution_after": opinion_distribution_after,
        "usage": request.app.state.anthropic_client.get_usage_report(),
    }


@router.post("")
async def inject_god_view(req: GodViewRequest, request: Request):
    """Inject a hypothetical development and collect every resident reaction.

    The shared mutation reservation remains held through reaction conversion,
    result publication, and summary construction. A new simulation or replay
    therefore cannot capture the tail of this injection as its own history.
    """
    orchestrator = request.app.state.orchestrator
    operation_token = orchestrator.try_reserve_operation("god_view")
    if operation_token is None:
        return JSONResponse(
            {
                "status": "error",
                "message": "Another simulation, replay, or injection is already running",
            },
            status_code=409,
        )
    try:
        return await _run_reserved_injection(req, request, operation_token)
    finally:
        orchestrator.release_operation(operation_token)
