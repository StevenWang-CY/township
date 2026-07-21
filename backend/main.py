import logging
import os

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from .core.event_bus import EventBus
from .core.scenario import load_scenario_with_fallback
from .providers import create_provider
from .routes.chat import (
    flush_relationship_state,
    load_relationship_state,
)
from .routes.chat import router as chat_router
from .routes.gods_view import router as gods_view_router
from .routes.journal import (
    flush_journal_state,
    load_journal_state,
)
from .routes.journal import router as journal_router
from .routes.runs import router as runs_router
from .routes.scenario import router as scenario_router
from .routes.simulation import router as simulation_router
from .routes.towns import router as towns_router
from .routes.transcribe import router as transcribe_router
from .routes.tts import router as tts_router
from .simulation.orchestrator import SimulationOrchestrator

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(
    title="Township — Civic AI Simulation",
    description="26 AI agents across 4 NJ towns deliberate about a real election",
    version="0.1.0",
)

# CORS — origins come from ALLOWED_ORIGINS (comma-separated). Credentials are
# disabled so an explicit origin list is honored by browsers.
_DEFAULT_ORIGINS = "http://localhost:5173,http://localhost:4173,http://localhost:3000"
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.environ.get("ALLOWED_ORIGINS", _DEFAULT_ORIGINS).split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global state
event_bus = EventBus()
# LLM provider — chosen via LLM_PROVIDER, or auto-detected from whichever
# credential is present (ANTHROPIC_API_KEY / AWS_BEARER_TOKEN_BEDROCK /
# OPENAI_API_KEY / OPENROUTER_API_KEY). With zero credentials the
# deterministic mock provider runs the whole sim offline.
llm_provider = create_provider(max_concurrent=10)

# Determine project root (parent of backend/)
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIST = os.path.join(PROJECT_ROOT, "frontend", "dist")
_SERVE_FRONTEND = os.path.isdir(FRONTEND_DIST)

# Active scenario — chosen via SCENARIO env (default: the NJ-11 flagship).
# Falls back to the deprecated data/ + agents/ layout when scenarios/<id>
# is absent (one-release compatibility shim).
SCENARIO_ID = os.environ.get("SCENARIO", "nj11-2026")
scenario = load_scenario_with_fallback(SCENARIO_ID)

orchestrator = SimulationOrchestrator(
    anthropic_client=llm_provider,
    event_bus=event_bus,
    scenario=scenario,
)

# Store globals on app.state for access in route handlers.
# `anthropic_client` is a legacy alias for the same provider object.
app.state.event_bus = event_bus
app.state.llm = llm_provider
app.state.anthropic_client = llm_provider
app.state.scenario = scenario
app.state.orchestrator = orchestrator


# Include routers
app.include_router(scenario_router)
app.include_router(simulation_router)
app.include_router(chat_router)
app.include_router(gods_view_router)
app.include_router(towns_router)
app.include_router(journal_router)
app.include_router(runs_router)
app.include_router(transcribe_router)
app.include_router(tts_router)


def _status_payload() -> dict:
    """Health/status info shared by GET /api/health (and GET / without a build)."""
    agent_counts = {
        town: len(agents)
        for town, agents in orchestrator.agent_states.items()
    }
    return {
        "name": "Township",
        "status": "running" if orchestrator.is_running else "idle",
        "towns": list(orchestrator.agent_states.keys()),
        "agent_counts": agent_counts,
        "total_agents": sum(agent_counts.values()),
        "usage": llm_provider.get_usage_report(),
    }


@app.get("/api/health")
async def health():
    """Health check and basic info."""
    return _status_payload()


if not _SERVE_FRONTEND:
    # Without a frontend build, keep the legacy JSON health check at "/".
    # When frontend/dist exists, "/" serves the app via the static mount below.
    @app.get("/")
    async def root():
        """Health check and basic info."""
        return _status_payload()


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    """WebSocket endpoint for real-time simulation events."""
    await ws.accept()
    event_bus.register_ws(ws)
    logger.info("WebSocket client connected")

    try:
        while True:
            # Keep connection alive; client can send messages (e.g., ping)
            data = await ws.receive_text()
            # Echo back pings
            if data == "ping":
                await ws.send_text('{"type":"pong"}')
    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        event_bus.unregister_ws(ws)


@app.on_event("startup")
async def startup():
    """Load persisted player state and log startup info."""
    load_relationship_state()
    load_journal_state()
    agent_count = sum(len(v) for v in orchestrator.agent_states.values())
    towns = list(orchestrator.agent_states.keys())
    provider_name = llm_provider.get_usage_report().get("provider", "unknown")
    logger.info(f"Township started: {agent_count} agents across {len(towns)} towns: {towns}")
    logger.info(f"LLM provider: {provider_name}")
    logger.info(f"Scenario: {scenario.id} ({scenario.title}) from {scenario.scenario_dir}")
    logger.info(
        "Registered routes: /api/scenario, /api/simulation, /api/chat, /api/gods-view, "
        "/api/towns, /api/journal, /api/transcribe, /api/tts, /api/health"
    )
    logger.info(f"CORS allowed origins: {ALLOWED_ORIGINS}")
    if _SERVE_FRONTEND:
        logger.info(f"Serving frontend build from {FRONTEND_DIST} at /")


@app.on_event("shutdown")
async def shutdown():
    """Flush persisted player state and log shutdown."""
    logger.info("Township shutting down")
    await flush_relationship_state()
    await flush_journal_state()
    usage = llm_provider.get_usage_report()
    logger.info(f"Final usage: {usage}")


class SPAStaticFiles(StaticFiles):
    """
    Static files with an SPA fallback: unknown extension-less paths
    (e.g. /town/dover on a hard refresh) serve index.html so client-side
    routing works; missing assets still 404.
    """

    async def get_response(self, path: str, scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if (
                exc.status_code == 404
                and not path.startswith(("api/", "ws"))
                and "." not in os.path.basename(path)
            ):
                return await super().get_response("index.html", scope)
            raise


# Mounted LAST so every API route, /ws, and the docs keep precedence
# (Starlette matches routes in registration order). This makes the
# single-container Docker story work: the backend serves the built
# frontend at "/" whenever frontend/dist exists.
if _SERVE_FRONTEND:
    app.mount("/", SPAStaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
