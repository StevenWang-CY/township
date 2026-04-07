import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Request
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/simulation", tags=["simulation"])


class StartRequest(BaseModel):
    town: Optional[str] = None  # If None, run all towns
    num_rounds: int = 5


class ReplayRequest(BaseModel):
    cache_path: str = "data/simulation_cache.json"
    speed: float = 1.0


@router.post("/start")
async def start_simulation(req: StartRequest, request: Request, background_tasks: BackgroundTasks):
    """Start simulation as a background task. Returns immediately."""
    orchestrator = request.app.state.orchestrator

    if orchestrator.is_running:
        return {"status": "error", "message": "Simulation already running"}

    if req.town:
        if req.town not in orchestrator.agent_states:
            return {
                "status": "error",
                "message": f"Unknown town: {req.town}. Available: {list(orchestrator.agent_states.keys())}",
            }
        background_tasks.add_task(orchestrator.run_single_town, req.town, req.num_rounds)
        return {
            "status": "started",
            "town": req.town,
            "num_rounds": req.num_rounds,
            "agents": len(orchestrator.agent_states[req.town]),
        }
    else:
        background_tasks.add_task(orchestrator.run_full_simulation, req.num_rounds)
        total_agents = sum(len(v) for v in orchestrator.agent_states.values())
        return {
            "status": "started",
            "towns": list(orchestrator.agent_states.keys()),
            "num_rounds": req.num_rounds,
            "total_agents": total_agents,
        }


@router.get("/status")
async def simulation_status(request: Request):
    """Return current simulation state."""
    orchestrator = request.app.state.orchestrator
    anthropic_client = request.app.state.anthropic_client

    agent_summaries = {}
    for town, agents in orchestrator.agent_states.items():
        town_agents = []
        for agent in agents:
            opinion = agent.current_opinion
            town_agents.append({
                "agent_id": agent.agent_id,
                "name": agent.definition.name,
                "state": agent.state.value,
                "location": agent.current_location,
                "current_candidate": opinion.candidate if opinion else "undecided",
                "current_confidence": opinion.confidence if opinion else 0,
                "memories_count": len(agent.memories),
                "conversations_count": len(agent.conversations),
            })
        agent_summaries[town] = town_agents

    return {
        "is_running": orchestrator.is_running,
        "towns": list(orchestrator.agent_states.keys()),
        "agents": agent_summaries,
        "has_results": orchestrator.district_summary is not None,
        "usage": anthropic_client.get_usage_report(),
    }


@router.get("/results")
async def simulation_results(request: Request):
    """Return cached DistrictSummary."""
    orchestrator = request.app.state.orchestrator

    if orchestrator.district_summary is None:
        return {"status": "no_results", "message": "No simulation has completed yet."}

    return {
        "status": "complete",
        "district_summary": orchestrator.district_summary.model_dump(),
        "usage": request.app.state.anthropic_client.get_usage_report(),
    }


@router.post("/replay")
async def replay_simulation(req: ReplayRequest, request: Request, background_tasks: BackgroundTasks):
    """Replay cached simulation through WebSocket."""
    from ..simulation.replay import replay, load_cache_summary
    import os

    event_bus = request.app.state.event_bus

    # Resolve path relative to project root
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cache_path = os.path.join(os.path.dirname(project_root), req.cache_path)

    # Check if cache exists
    summary = await load_cache_summary(cache_path)
    if "error" in summary:
        return {"status": "error", "message": summary["error"]}

    background_tasks.add_task(replay, event_bus, cache_path, req.speed)

    return {
        "status": "replaying",
        "total_events": summary["total_events"],
        "speed": req.speed,
    }


@router.get("/agents")
async def list_agents(request: Request, town: Optional[str] = None):
    """List all agents or agents for a specific town."""
    orchestrator = request.app.state.orchestrator

    result = {}
    for t, agents in orchestrator.agent_states.items():
        if town and t != town:
            continue
        result[t] = [
            {
                "agent_id": a.agent_id,
                "name": a.definition.name,
                "description": a.definition.description,
                "occupation": a.definition.occupation,
                "age": a.definition.age,
                "political_registration": a.definition.political_registration,
                "initial_lean": a.definition.initial_lean,
                "top_concerns": a.definition.top_concerns,
                "language": a.definition.language,
            }
            for a in agents
        ]

    return {"agents": result}
