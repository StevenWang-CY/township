import logging
import os

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .core.event_bus import EventBus
from .providers.anthropic_client import AnthropicClient
from .simulation.orchestrator import SimulationOrchestrator
from .routes.simulation import router as simulation_router
from .routes.chat import router as chat_router
from .routes.gods_view import router as gods_view_router

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

# CORS — allow all origins for hackathon
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global state
event_bus = EventBus()
anthropic_client = AnthropicClient(
    api_key=os.environ.get("AZURE_OPENAI_API_KEY"),
    max_concurrent=10,
)

# Determine project root (parent of backend/)
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(PROJECT_ROOT, "data")
AGENTS_DIR = os.path.join(PROJECT_ROOT, "agents")

orchestrator = SimulationOrchestrator(
    anthropic_client=anthropic_client,
    event_bus=event_bus,
    data_dir=DATA_DIR,
    agents_dir=AGENTS_DIR,
)

# Store globals on app.state for access in route handlers
app.state.event_bus = event_bus
app.state.anthropic_client = anthropic_client
app.state.orchestrator = orchestrator


# Include routers
app.include_router(simulation_router)
app.include_router(chat_router)
app.include_router(gods_view_router)


@app.get("/")
async def root():
    """Health check and basic info."""
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
        "usage": anthropic_client.get_usage_report(),
    }


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
    """Log startup info."""
    agent_count = sum(len(v) for v in orchestrator.agent_states.values())
    towns = list(orchestrator.agent_states.keys())
    logger.info(f"Township started: {agent_count} agents across {len(towns)} towns: {towns}")
    logger.info(f"Data dir: {DATA_DIR}")
    logger.info(f"Agents dir: {AGENTS_DIR}")


@app.on_event("shutdown")
async def shutdown():
    """Log shutdown and save any state."""
    logger.info("Township shutting down")
    usage = anthropic_client.get_usage_report()
    logger.info(f"Final usage: {usage}")
