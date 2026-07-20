import logging

from fastapi import APIRouter, BackgroundTasks, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from ..core.wire import district_summary_to_wire, opinion_to_wire

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/simulation", tags=["simulation"])


class StartRequest(BaseModel):
    """Accepts either `num_rounds` or its alias `rounds` from the wire."""
    model_config = ConfigDict(populate_by_name=True)

    town: str | None = None  # If None, run all towns
    num_rounds: int = Field(default=5, alias="rounds")


class ReplayRequest(BaseModel):
    cache_path: str = "data/simulation_cache.json"
    speed: float = 1.0


@router.post("/start")
async def start_simulation(req: StartRequest, request: Request, background_tasks: BackgroundTasks):
    """Start simulation as a background task. Returns immediately."""
    orchestrator = request.app.state.orchestrator

    if orchestrator.is_running:
        return JSONResponse(
            {"status": "error", "message": "Simulation already running"},
            status_code=409,
        )

    if req.town:
        if req.town not in orchestrator.agent_states:
            return JSONResponse(
                {
                    "status": "error",
                    "message": f"Unknown town: {req.town}. Available: {list(orchestrator.agent_states.keys())}",
                },
                status_code=404,
            )
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

    agents_loaded = sum(len(v) for v in orchestrator.agent_states.values())
    has_results = orchestrator.district_summary is not None

    # SimulationStatus-compatible status string for the frontend.
    if orchestrator.is_running:
        status = "running"
    elif has_results:
        status = "completed"
    else:
        status = "idle"

    return {
        "is_running": orchestrator.is_running,
        "towns": list(orchestrator.agent_states.keys()),
        "agents": agent_summaries,
        "has_results": has_results,
        "usage": anthropic_client.get_usage_report(),
        # SimulationStatus-compatible additive fields (frontend type match).
        "status": status,
        "current_round": orchestrator.current_round,
        "total_rounds": getattr(orchestrator, "total_rounds", 5),
        "agents_loaded": agents_loaded,
    }


@router.get("/results")
async def simulation_results(request: Request):
    """Return the cached DistrictSummary in frontend wire format.

    The response body IS the DistrictSummary (no envelope). When no
    simulation has completed yet, returns a 404 with a small error body
    so callers can distinguish 'no data' from 'real data'.
    """
    orchestrator = request.app.state.orchestrator

    if orchestrator.district_summary is None:
        return JSONResponse(
            {"error": "no_results", "message": "No simulation has completed yet."},
            status_code=404,
        )

    return JSONResponse(district_summary_to_wire(orchestrator.district_summary))


@router.get("/agent/{agent_id}")
async def get_agent(agent_id: str, request: Request):
    """Return rich detail for a single agent (memories, opinion history)."""
    orchestrator = request.app.state.orchestrator
    state = orchestrator.get_agent_state(agent_id)
    if state is None:
        return JSONResponse({"error": "not_found", "agent_id": agent_id}, status_code=404)

    return {
        "id": agent_id,
        "name": state.definition.name,
        "town": state.definition.town,
        "occupation": state.definition.occupation,
        "memories": state.get_recent_memories(20),
        "opinions": [opinion_to_wire(o) for o in state.opinions],
        "location": state.current_location,
        "state": state.state.value if hasattr(state.state, "value") else str(state.state),
    }


@router.post("/replay")
async def replay_simulation(req: ReplayRequest, request: Request, background_tasks: BackgroundTasks):
    """Replay cached simulation through WebSocket."""
    import os

    from ..simulation.replay import load_cache_summary, replay

    event_bus = request.app.state.event_bus

    # Resolve path relative to project root
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cache_path = os.path.join(os.path.dirname(project_root), req.cache_path)

    # Check if cache exists
    summary = await load_cache_summary(cache_path)
    if "error" in summary:
        return JSONResponse(
            {"status": "error", "message": summary["error"]},
            status_code=404,
        )

    background_tasks.add_task(replay, event_bus, cache_path, req.speed)

    return {
        "status": "replaying",
        "total_events": summary["total_events"],
        "speed": req.speed,
    }


@router.get("/agents")
async def list_agents(request: Request, town: str | None = None):
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
