import logging
import os
from contextlib import asynccontextmanager
from urllib.parse import urlsplit

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.trustedhost import TrustedHostMiddleware

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


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Load mutable local state on boot and flush it on clean shutdown."""
    load_relationship_state()
    load_journal_state()
    agent_count = sum(len(v) for v in orchestrator.agent_states.values())
    towns = list(orchestrator.agent_states.keys())
    provider_name = llm_provider.get_usage_report().get("provider", "unknown")
    logger.info(
        "Township started: %s agents across %s towns: %s",
        agent_count,
        len(towns),
        towns,
    )
    logger.info("LLM provider: %s", provider_name)
    logger.info(
        "Scenario: %s (%s) from %s",
        scenario.id,
        scenario.title,
        scenario.scenario_dir,
    )
    logger.info(
        "Registered routes: /api/scenario, /api/simulation, /api/chat, "
        "/api/gods-view, /api/towns, /api/journal, /api/runs, "
        "/api/transcribe, /api/tts, /api/health"
    )
    logger.info("CORS allowed origins: %s", ALLOWED_ORIGINS)
    logger.info("Allowed Host headers: %s", ALLOWED_HOSTS)
    if _SERVE_FRONTEND:
        logger.info("Serving frontend build from %s at /", FRONTEND_DIST)

    try:
        yield
    finally:
        logger.info("Township shutting down")
        await flush_relationship_state()
        await flush_journal_state()
        logger.info("Final usage: %s", llm_provider.get_usage_report())


# Create FastAPI app
app = FastAPI(
    title="Township — Civic AI Simulation",
    description=(
        "A scenario-driven civic deliberation engine where AI residents discuss "
        "elections and policy questions in a living pixel town."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

# CORS — origins come from ALLOWED_ORIGINS (comma-separated). Credentials are
# disabled so an explicit origin list is honored by browsers.
_DEFAULT_ORIGINS = "http://localhost:5173,http://localhost:4173,http://localhost:3000"
ALLOWED_ORIGINS = [
    o.strip() for o in os.environ.get("ALLOWED_ORIGINS", _DEFAULT_ORIGINS).split(",") if o.strip()
]
_DEFAULT_HOSTS = "localhost,127.0.0.1,testserver"
ALLOWED_HOSTS = [
    host.strip()
    for host in os.environ.get("ALLOWED_HOSTS", _DEFAULT_HOSTS).split(",")
    if host.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=ALLOWED_HOSTS,
    www_redirect=False,
)


def _hostname_from_header(host_header: str) -> str | None:
    """Extract a normalized hostname from an HTTP Host header."""
    try:
        return urlsplit(f"//{host_header}").hostname
    except ValueError:
        return None


def _host_allowed(host_header: str) -> bool:
    """Mirror TrustedHost matching for same-origin validation."""
    hostname = _hostname_from_header(host_header)
    if not hostname:
        return False
    normalized = hostname.casefold()
    for pattern in ALLOWED_HOSTS:
        candidate = pattern.casefold()
        if candidate == "*" or normalized == candidate:
            return True
        if candidate.startswith("*.") and normalized.endswith(candidate[1:]):
            return True
    return False


def _browser_origin_allowed(origin: str | None, request_host: str) -> bool:
    """Accept configured browser origins or a trusted, exact same origin."""
    if not origin:
        return True  # Native/CLI clients do not normally send Origin.
    if "*" in ALLOWED_ORIGINS:
        return True
    normalized = origin.rstrip("/")
    if normalized in {allowed.rstrip("/") for allowed in ALLOWED_ORIGINS}:
        return True

    try:
        parsed = urlsplit(origin)
        return (
            parsed.scheme in {"http", "https"}
            and not parsed.username
            and not parsed.password
            and parsed.path in {"", "/"}
            and not parsed.query
            and not parsed.fragment
            and _host_allowed(request_host)
            and parsed.netloc.casefold() == request_host.casefold()
        )
    except ValueError:
        return False


@app.middleware("http")
async def reject_cross_origin_mutations(request: Request, call_next):
    """Block browser CSRF, including safelisted forms and multipart uploads."""
    if request.method not in {"GET", "HEAD", "OPTIONS"} and not _browser_origin_allowed(
        request.headers.get("origin"), request.headers.get("host", "")
    ):
        logger.warning(
            "Rejected %s %s from disallowed origin %r",
            request.method,
            request.url.path,
            request.headers.get("origin"),
        )
        return JSONResponse(
            {"error": "origin_not_allowed"},
            status_code=403,
            headers={"Cache-Control": "no-store"},
        )
    return await call_next(request)


def _websocket_origin_allowed(ws: WebSocket) -> bool:
    """Apply the CORS list while also accepting the server's own origin.

    Same-origin acceptance is essential for the single-container deployment,
    where the built frontend and ``/ws`` are both served by port 8000 even
    though that origin need not be repeated in ``ALLOWED_ORIGINS``.
    """
    return _browser_origin_allowed(ws.headers.get("origin"), ws.headers.get("host", ""))


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
    agent_counts = {town: len(agents) for town, agents in orchestrator.agent_states.items()}
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
    origin = ws.headers.get("origin")
    # Browsers always send Origin during the WebSocket handshake. Enforce the
    # same allow-list used by HTTP CORS before accepting the socket so a page
    # on an unrelated origin cannot drive a locally running Township server.
    # CLI clients and test harnesses commonly omit Origin, so absence remains
    # allowed; operators can still use a reverse proxy for stronger auth.
    if not _websocket_origin_allowed(ws):
        logger.warning("Rejected WebSocket connection from disallowed origin %r", origin)
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await ws.accept()
    if not await event_bus.subscribe_ws(ws):
        logger.info("WebSocket client disconnected during run replay")
        return
    logger.info("WebSocket client connected")

    try:
        while True:
            # Keep connection alive; client can send messages (e.g., ping)
            data = await ws.receive_text()
            # Echo back pings
            if data == "ping":
                if not await event_bus.send_ws_text(ws, '{"type":"pong"}'):
                    return
    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        event_bus.unregister_ws(ws)


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
