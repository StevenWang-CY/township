"""Campaign runs end to end on the mock: beats, ballots, results, rollups,
checkpoints + resume, the budget guard, and the API's calendar surface."""

from __future__ import annotations

import asyncio
import json

import pytest
from conftest import load_nj11_scenario
from fastapi.testclient import TestClient

from backend.core.event_bus import EventBus
from backend.providers.mock import MockProvider
from backend.simulation.budget import BudgetGuard
from backend.simulation.orchestrator import SimulationOrchestrator


@pytest.fixture()
def runs_dir(monkeypatch, tmp_path):
    monkeypatch.setattr("backend.simulation.orchestrator.runs_root", lambda: tmp_path / "runs")
    monkeypatch.setattr(
        "backend.simulation.orchestrator.DEFAULT_CACHE_PATH", tmp_path / "simulation_cache.json"
    )
    monkeypatch.setenv("MOCK_DELAY_S", "0")
    return tmp_path / "runs"


def _orch():
    return SimulationOrchestrator(
        anthropic_client=MockProvider(), event_bus=EventBus(), scenario=load_nj11_scenario()
    )


def _types(bus: EventBus) -> list[str]:
    return [getattr(e, "type", "?") for e in bus.get_event_log()]


def test_four_day_campaign_has_election_day_results_and_rollups(runs_dir):
    orch = _orch()
    district = asyncio.run(orch.run_full_simulation(preset="campaign", days=4))
    log = orch.event_bus.get_event_log()
    started = [e for e in log if e.type == "round_started" and e.town == "dover"]
    assert started[0].preset == "campaign" and started[0].day is not None and started[0].weekday
    assert {e.beat for e in started if e.date == "2026-04-16"} == {
        "early",
        "midday",
        "evening",
        "night",
    }
    ballots = [e for e in log if e.type == "ballot_cast"]
    assert len(ballots) == sum(len(v) for v in orch.agent_states.values())
    assert {b.round for b in ballots} <= {e.round for e in started if e.date == "2026-04-16"}
    results = [e for e in log if e.type == "election_result"]
    assert len(results) == len(orch.agent_states) + 1
    district_result = next(e for e in results if e.town is None)
    assert district_result.district["eligible"] == len(ballots)
    assert district.election is not None and district.election["mode"] == "ballots"
    # Stances freeze after the ballot: no opinion_changed after a resident voted.
    voted_round = {b.agent_id: b.round for b in ballots}
    late = [
        e
        for e in log
        if e.type == "opinion_changed" and e.round and e.round > voted_round.get(e.agent_id, 10**9)
    ]
    assert late == []
    # The morning after names the district winner in every town.
    after = [
        e for e in log if e.type == "news_injected" and (e.news_id or "").startswith("result-")
    ]
    assert after and len({e.headline for e in after}) == 1
    # Rollups + checkpoints per day, and the run dir carries them.
    assert orch.last_run_dir is not None
    days = sorted(p.name for p in (orch.last_run_dir / "days").glob("*.json"))
    cps = sorted(p.name for p in (orch.last_run_dir / "checkpoints").glob("*.json"))
    assert len(days) == len(cps) == 5
    summary = json.loads((orch.last_run_dir / "summary.json").read_text())
    assert summary["preset"] == "campaign" and summary["days"] == 5 and summary["plan"]


def test_resume_continues_from_the_latest_checkpoint(runs_dir):
    first = _orch()
    asyncio.run(
        first.run_full_simulation(preset="campaign", days=3, until_election=True, num_rounds=6)
    )
    run_dir = first.last_run_dir
    assert run_dir is not None
    checkpoint = SimulationOrchestrator.load_checkpoint(run_dir)
    assert checkpoint["day"] is not None and checkpoint["agent_states"]
    resumed = _orch()
    asyncio.run(
        resumed.run_full_simulation(
            preset="campaign", days=3, until_election=True, resume=checkpoint
        )
    )
    started = [e for e in resumed.event_bus.get_event_log() if e.type == "simulation_started"]
    assert started[0].resumed_from_day == checkpoint["day"]
    days_run = {e.day for e in resumed.event_bus.get_event_log() if e.type == "round_started"}
    assert min(days_run) == checkpoint["day"] + 1
    # The persisted run stitches the two halves into one stream.
    events = json.loads((run_dir / "events.json").read_text())["events"]
    assert events[0]["type"] == "simulation_started"
    assert sum(1 for e in events if e["type"] == "simulation_started") == 2
    assert any(e["type"] == "election_result" for e in events)


class _PaidProvider(MockProvider):
    """The mock, but every call costs money."""

    provider_name = "paid"

    async def call_agent(self, *args, **kwargs):
        result = await super().call_agent(*args, **kwargs)
        self._usage.record(cost=0.05)
        return result


def test_budget_guard_stops_a_paid_run_cleanly(runs_dir):
    orch = SimulationOrchestrator(
        anthropic_client=_PaidProvider(), event_bus=EventBus(), scenario=load_nj11_scenario()
    )
    asyncio.run(orch.run_full_simulation(preset="campaign", days=3, budget_usd=3.0))
    assert orch.stopped_reason == "budget"
    ended = [e for e in orch.event_bus.get_event_log() if e.type == "simulation_ended"]
    assert ended and ended[0].summary["stopped_reason"] == "budget"
    assert orch.last_run_dir is not None  # persisted normally


def test_budget_guard_never_trips_for_free_providers():
    guard = BudgetGuard(1.0, MockProvider())
    assert guard.should_stop(500) is False
    guard2 = BudgetGuard(None, MockProvider())
    assert guard2.limit is None and guard2.should_stop(10**6) is False


def test_api_exposes_the_calendar_and_validates_presets(monkeypatch, runs_dir):
    monkeypatch.setenv("LLM_PROVIDER", "mock")
    from backend.main import app

    with TestClient(app) as client:
        scenario = client.get("/api/scenario").json()
        assert scenario["presets"] == ["quick", "campaign"]
        assert scenario["campaign"]["election_date"] == "2026-04-16"
        assert scenario["campaign"]["total_rounds"] >= 60
        assert [r["round"] for r in scenario["round_plan"]] == [0, 1, 2, 3, 4]
        bad = client.post("/api/simulation/start", json={"preset": "weekly"})
        assert bad.status_code == 422
        status = client.get("/api/simulation/status").json()
        for key in ("preset", "day", "beat", "paused", "speed", "budget", "stopped_reason"):
            assert key in status
        assert client.post("/api/simulation/pause").status_code == 409
        assert client.post("/api/simulation/speed", json={"multiplier": 4}).json()["speed"] == 4
