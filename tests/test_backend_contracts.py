"""
Backend behaviour / contract tests for the Township audit fixes.

Every test here asserts a fix that was NOT true before this audit pass:
  - unknown agent -> 404 (was 200 with an in-character error string)
  - LLM failure on chat -> 503 (was 200 with "[API Error: ...]" as the reply)
  - agent wire payload carries the living-world fields (was missing)
  - God's View actually re-forms opinion so opinion_shifts can populate (N1)
  - Town/District summaries expose failed_agents
  - transcribe / tts degrade to 503 when their credential is absent
  - simulation start (already running) -> 409, replay (no cache) -> 404
"""
import asyncio

from conftest import AGENTS_DIR, DATA_DIR, FakeClient
from fastapi.testclient import TestClient

from backend.core.event_bus import EventBus
from backend.core.types import DistrictSummary, TownSummary
from backend.core.wire import agent_state_to_wire, district_summary_to_wire, town_summary_to_wire
from backend.main import app
from backend.simulation.orchestrator import SimulationOrchestrator


def _first_agent_id() -> str:
    states = app.state.orchestrator.get_all_agent_states()
    for town_agents in states.values():
        if town_agents:
            return town_agents[0].agent_id
    raise RuntimeError("no agents loaded")


# ── Route behaviour ────────────────────────────────────────────

def test_unknown_agent_returns_404():
    with TestClient(app) as c:
        r = c.post("/api/chat/this-agent-does-not-exist",
                   json={"message": "hello", "user_id": "t"})
    assert r.status_code == 404
    assert r.json().get("error") == "agent_not_found"


def test_chat_llm_error_returns_503():
    agent_id = _first_agent_id()
    orig = app.state.anthropic_client
    fake = FakeClient(mode="error")
    app.state.anthropic_client = fake
    app.state.orchestrator.client = fake
    try:
        with TestClient(app) as c:
            r = c.post(f"/api/chat/{agent_id}",
                       json={"message": "How's business?", "user_id": "t"})
        assert r.status_code == 503
        assert r.json().get("error") == "llm_unavailable"
    finally:
        app.state.anthropic_client = orig
        app.state.orchestrator.client = orig


def test_chat_success_returns_full_opinion_and_trust():
    agent_id = _first_agent_id()
    agent = app.state.orchestrator.get_agent_state(agent_id)
    snapshot = list(agent.opinions)  # restore afterward (test mutates state)
    orig = app.state.anthropic_client
    fake = FakeClient(mode="normal")
    app.state.anthropic_client = fake
    app.state.orchestrator.client = fake
    try:
        with TestClient(app) as c:
            r = c.post(
                f"/api/chat/{agent_id}",
                json={
                    "message": "How's business?",
                    "user_id": "t",
                    "user_profile": {"name": "Sam", "town": "dover",
                                     "top_concerns": ["healthcare"]},
                },
            )
        assert r.status_code == 200
        data = r.json()
        assert data["response"]
        assert "trust" in data and "opinion_changed" in data
        # The fake FormOpinion shifts an un-formed agent to a real stance,
        # so the response opinion is the full wire shape (not the hand-built 4-field dict).
        assert data["opinion"] is not None
        assert data["opinion"]["candidate"] == "mejia"
        assert "round_number" in data["opinion"]  # full opinion_to_wire shape
        assert data["opinion_changed"] is True
    finally:
        agent.opinions = snapshot
        app.state.anthropic_client = orig
        app.state.orchestrator.client = orig


def test_simulation_start_conflict_409():
    orch = app.state.orchestrator
    was = orch.is_running
    orch.is_running = True
    try:
        with TestClient(app) as c:
            r = c.post("/api/simulation/start", json={})
        assert r.status_code == 409
    finally:
        orch.is_running = was


def test_replay_missing_cache_404():
    # The default cache path resolves under <repo>/data and is not present.
    with TestClient(app) as c:
        r = c.post("/api/simulation/replay",
                   json={"cache_path": "data/does_not_exist_cache.json"})
    assert r.status_code == 404


def test_transcribe_without_key_returns_503(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with TestClient(app) as c:
        r = c.post("/api/transcribe",
                   files={"audio": ("clip.webm", b"\x00\x01\x02\x03", "audio/webm")})
    assert r.status_code == 503
    assert r.json().get("error") == "transcription_unavailable"


def test_tts_without_key_returns_503(monkeypatch):
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    with TestClient(app) as c:
        r = c.post("/api/tts", json={"text": "hello there", "voice_id": "21m00Tcm4TlvDq8ikWAM"})
    assert r.status_code == 503


# ── Wire-shape contracts ───────────────────────────────────────

def test_agent_wire_includes_living_world_fields():
    agent = app.state.orchestrator.get_agent_state(_first_agent_id())
    wire = agent_state_to_wire(agent)
    for key in ("idle_thoughts", "routine", "top_concerns", "relationships"):
        assert key in wire, f"agent_state_to_wire missing {key}"
    assert isinstance(wire["idle_thoughts"], list)
    assert isinstance(wire["routine"], list)
    assert isinstance(wire["top_concerns"], list)
    assert isinstance(wire["relationships"], dict)
    # The seeded personas all carry idle thoughts + a routine, so they must
    # reach the wire (this is the fix that revives the living-world feature).
    assert len(wire["idle_thoughts"]) > 0
    assert len(wire["routine"]) > 0


def test_summaries_expose_failed_agents():
    ts = TownSummary(
        town="dover",
        opinion_distribution={"mejia": 2, "hathaway": 1, "bond": 0, "undecided": 1},
        top_issues=[{"issue": "healthcare", "importance": 0.8}],
        agent_summaries=[],
        total_conversations=3,
        rounds_completed=5,
        failed_agents=1,
    )
    tw = town_summary_to_wire(ts)
    assert tw.get("failed_agents") == 1

    ds = DistrictSummary(
        by_town={"dover": ts},
        consensus_zones=[],
        fault_lines=[],
        prediction={"mejia": 50.0, "hathaway": 25.0, "bond": 0.0, "undecided": 25.0},
        total_agents=4,
        total_conversations=3,
        total_cost=0.0,
        failed_agents=1,
    )
    dw = district_summary_to_wire(ds)
    assert dw.get("failed_agents") == 1


# ── God's View actually re-forms opinion (Phase-3 finding N1) ───

def test_god_view_reaction_appends_a_new_opinion():
    """A fresh orchestrator + fake client: an impactful injection must append a
    second Opinion (so gods_view.py opinion_shifts can ever be non-empty)."""
    fake = FakeClient(mode="normal")
    orch = SimulationOrchestrator(
        anthropic_client=fake, event_bus=EventBus(),
        data_dir=DATA_DIR, agents_dir=AGENTS_DIR,
    )
    agent = None
    for town_agents in orch.get_all_agent_states().values():
        if town_agents:
            agent = town_agents[0]
            break
    assert agent is not None
    before = len(agent.opinions)
    asyncio.run(orch._god_view_react(agent, "ICE raids increase 50% across Morris County."))
    # ReactToNews returns impact='changes_mind' (!= no_effect) -> FormOpinion runs
    # -> a new opinion is appended. Before the fix this stayed flat at `before`.
    assert len(agent.opinions) == before + 1
