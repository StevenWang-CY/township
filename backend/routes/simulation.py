import logging
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from ..core.artifacts import (
    ArtifactFormatError,
    ArtifactPrivacyError,
    is_public_artifact,
    require_replay_artifact,
)
from ..core.storage import PROJECT_ROOT as APPLICATION_ROOT
from ..core.storage import load_json, runs_root
from ..core.wire import district_summary_to_wire, opinion_to_wire
from .runs import RUN_ID_RE, resolve_run_dir

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/simulation", tags=["simulation"])

# township/ — anchored on this file (backend/routes/simulation.py → repo root)
# so relative cache paths resolve identically from any working directory.
PROJECT_ROOT = APPLICATION_ROOT


class StartRequest(BaseModel):
    """Accepts either `num_rounds` or its alias `rounds` from the wire."""

    model_config = ConfigDict(populate_by_name=True)

    town: str | None = None  # If None, run all towns
    # None means "run the scenario's full round plan" — the scenario, not
    # this route, knows how many rounds it has. An explicit value caps the
    # run at the first N rounds of the plan.
    num_rounds: int | None = Field(default=None, alias="rounds", ge=1)


class ReplayRequest(BaseModel):
    """Pick a replay source: explicit cache_path > run_id > the scenario demo.

    `cache_path` is resolved against the project root and must stay inside it.
    """

    cache_path: str | None = None
    run_id: str | None = None
    speed: float = Field(default=1.0, ge=0.1, le=1000.0)


def _demo_cache_path(scenario) -> Path:
    """The active scenario's shipped demo replay."""
    return scenario.demo_cache_path


def _resolve_replay_path(req: ReplayRequest, scenario) -> Path | JSONResponse:
    """Resolve the replay source, anchored to PROJECT_ROOT (no traversal)."""
    if req.cache_path:
        candidate = Path(req.cache_path)
        if not candidate.is_absolute():
            candidate = PROJECT_ROOT / candidate
        candidate = candidate.resolve()
        if not candidate.is_relative_to(PROJECT_ROOT.resolve()):
            return JSONResponse(
                {
                    "status": "error",
                    "message": "cache_path must stay inside the project directory",
                },
                status_code=400,
            )
        return candidate

    if req.run_id:
        run_dir = resolve_run_dir(req.run_id)
        if run_dir is None:
            return JSONResponse(
                {"status": "error", "message": f"Unknown run: {req.run_id}"},
                status_code=404,
            )
        return run_dir / "events.json"

    return _demo_cache_path(scenario)


async def _run_reserved_replay(
    orchestrator,
    event_bus,
    cache_path: str,
    speed: float,
    operation_token: str,
) -> None:
    """Replay under the shared operation reservation and always release it."""
    from ..simulation.replay import replay

    try:
        await replay(event_bus, cache_path, speed)
    finally:
        orchestrator.release_operation(operation_token)


@router.post("/start")
async def start_simulation(req: StartRequest, request: Request, background_tasks: BackgroundTasks):
    """Start simulation as a background task. Returns immediately."""
    orchestrator = request.app.state.orchestrator

    # Resolved for the response body; the orchestrator applies the same
    # default (None -> full scenario round plan) internally.
    scenario_rounds = request.app.state.scenario.total_rounds
    resolved_rounds = (
        scenario_rounds if req.num_rounds is None else min(req.num_rounds, scenario_rounds)
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
        operation_token = orchestrator.try_reserve_operation("simulation")
        if operation_token is None:
            return JSONResponse(
                {"status": "error", "message": "Simulation or replay already running"},
                status_code=409,
            )
        try:
            background_tasks.add_task(
                orchestrator.run_single_town,
                req.town,
                req.num_rounds,
                _operation_token=operation_token,
            )
        except Exception:
            orchestrator.release_operation(operation_token)
            raise
        return {
            "status": "started",
            "town": req.town,
            "num_rounds": resolved_rounds,
            "agents": len(orchestrator.agent_states[req.town]),
        }
    else:
        total_agents = sum(len(v) for v in orchestrator.agent_states.values())
        operation_token = orchestrator.try_reserve_operation("simulation")
        if operation_token is None:
            return JSONResponse(
                {"status": "error", "message": "Simulation or replay already running"},
                status_code=409,
            )
        try:
            background_tasks.add_task(
                orchestrator.run_full_simulation,
                req.num_rounds,
                _operation_token=operation_token,
            )
        except Exception:
            orchestrator.release_operation(operation_token)
            raise
        return {
            "status": "started",
            "towns": list(orchestrator.agent_states.keys()),
            "num_rounds": resolved_rounds,
            "total_agents": total_agents,
        }


@router.get("/status")
async def simulation_status(request: Request):
    """Return current simulation state."""
    orchestrator = request.app.state.orchestrator
    anthropic_client = request.app.state.anthropic_client
    # The scenario names its own "no stance yet" bucket (UndecidedSpec.id) —
    # never assume the literal "undecided".
    undecided_id = request.app.state.scenario.undecided_id

    agent_summaries = {}
    for town, agents in orchestrator.agent_states.items():
        town_agents = []
        for agent in agents:
            opinion = agent.current_opinion
            town_agents.append(
                {
                    "agent_id": agent.agent_id,
                    "name": agent.definition.name,
                    "state": agent.state.value,
                    "location": agent.current_location,
                    "current_candidate": opinion.candidate if opinion else undecided_id,
                    "current_confidence": opinion.confidence if opinion else 0,
                    "memories_count": len(agent.memories),
                    "conversations_count": len(agent.conversations),
                }
            )
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
        "total_rounds": orchestrator.total_rounds,
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

    return JSONResponse(
        district_summary_to_wire(orchestrator.district_summary, request.app.state.scenario)
    )


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
async def replay_simulation(
    req: ReplayRequest, request: Request, background_tasks: BackgroundTasks
):
    """Replay a cached simulation through the WebSocket.

    Source resolution: explicit `cache_path` (project-root anchored) wins,
    then `run_id` (a persisted runs/ directory), then the active scenario's
    shipped demo cache.
    """
    from ..simulation.replay import load_cache_summary

    event_bus = request.app.state.event_bus
    orchestrator = request.app.state.orchestrator

    resolved = _resolve_replay_path(req, request.app.state.scenario)
    if isinstance(resolved, JSONResponse):
        return resolved

    summary = await load_cache_summary(str(resolved))
    if "error" in summary:
        error = summary["error"]
        messages = {
            "cache_not_found": "Replay cache not found",
            "cache_invalid": "Replay cache is invalid",
            "legacy_artifact_restricted": (
                "Replay artifact predates the private-player boundary; regenerate it"
            ),
        }
        return JSONResponse(
            {"status": "error", "message": messages.get(error, "Replay unavailable")},
            status_code=409 if error == "legacy_artifact_restricted" else 404,
        )

    operation_token = orchestrator.try_reserve_operation("replay")
    if operation_token is None:
        return JSONResponse(
            {"status": "error", "message": "Simulation or replay already running"},
            status_code=409,
        )
    try:
        background_tasks.add_task(
            _run_reserved_replay,
            orchestrator,
            event_bus,
            str(resolved),
            req.speed,
            operation_token,
        )
    except Exception:
        orchestrator.release_operation(operation_token)
        raise

    return {
        "status": "replaying",
        "total_events": summary["total_events"],
        "speed": req.speed,
    }


@router.get("/replay/available")
async def replay_available(request: Request):
    """List every replay source this deployment can serve right now."""
    scenario = request.app.state.scenario
    sources: list[dict] = []

    demo = _demo_cache_path(scenario)
    demo_doc = load_json(demo, {}) if demo.is_file() else {}
    try:
        require_replay_artifact(demo_doc)
        demo_available = True
    except (ArtifactFormatError, ArtifactPrivacyError):
        demo_available = False
    if demo_available:
        sources.append(
            {
                "kind": "demo",
                "scenario_id": scenario.id,
            }
        )

    root = runs_root()
    if root.is_dir():
        for run_dir in sorted(root.iterdir(), reverse=True):
            if (
                run_dir.is_symlink()
                or not run_dir.is_dir()
                or not RUN_ID_RE.match(run_dir.name)
            ):
                continue
            if not (run_dir / "events.json").is_file():
                continue
            run_summary = load_json(run_dir / "summary.json", {}) or {}
            events_doc = load_json(run_dir / "events.json", {}) or {}
            if not is_public_artifact(run_summary) or not is_public_artifact(events_doc):
                continue
            try:
                require_replay_artifact(events_doc)
            except (ArtifactFormatError, ArtifactPrivacyError):
                continue
            sources.append(
                {
                    "kind": "run",
                    "run_id": run_dir.name,
                    "scenario_id": run_summary.get("scenario_id"),
                    "ended_at": run_summary.get("ended_at"),
                    "events": run_summary.get("counts", {}).get("events"),
                }
            )

    return {"sources": sources}


@router.get("/recap")
async def latest_recap(request: Request):
    """The most recent narrative recap — in-memory first, then newest run."""
    from ..simulation.recap import recap_headline

    orchestrator = request.app.state.orchestrator
    if orchestrator.last_recap:
        return {
            "recap_markdown": orchestrator.last_recap,
            "headline": recap_headline(orchestrator.last_recap),
            "run_id": orchestrator.last_run_dir.name if orchestrator.last_run_dir else None,
        }

    root = runs_root()
    if root.is_dir():
        for run_dir in sorted(root.iterdir(), reverse=True):
            if (
                run_dir.is_symlink()
                or not run_dir.is_dir()
                or not RUN_ID_RE.match(run_dir.name)
            ):
                continue
            recap_path = run_dir / "recap.md"
            summary = load_json(run_dir / "summary.json", {}) or {}
            if recap_path.is_file() and is_public_artifact(summary):
                recap = recap_path.read_text(encoding="utf-8")
                return {
                    "recap_markdown": recap,
                    "headline": recap_headline(recap),
                    "run_id": run_dir.name,
                }

    return JSONResponse(
        {"error": "no_recap", "message": "No simulation recap exists yet."},
        status_code=404,
    )


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
