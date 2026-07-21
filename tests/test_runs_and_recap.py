"""
Run persistence + narrative recap + runs API — all on the mock provider,
zero credentials.

Covers:
  - a completed sim writes runs/<id>/{events.json,summary.json,recap.md}
    with the promised shapes (minified events, wire district summary, usage,
    counts, recap_markdown)
  - recap quality: real headline, real numbers, template never leaks
    placeholders
  - GET /api/runs (list), /api/runs/{id}, /api/runs/{id}/export (attachment)
  - replay by run_id; traversal attempts rejected for run ids and cache paths
  - GET /api/simulation/recap serves the newest persisted recap, 404 when none
"""
import asyncio
import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.core.event_bus import EventBus
from backend.core.scenario import load_scenario
from backend.main import app
from backend.providers.mock import MockProvider
from backend.routes.runs import RUN_ID_RE, resolve_run_dir
from backend.simulation.orchestrator import SimulationOrchestrator

MILLBROOK_DIR = Path(__file__).resolve().parents[1] / "scenarios" / "millbrook-budget"


@pytest.fixture(scope="module")
def completed_run(tmp_path_factory):
    """One full mock millbrook run persisted into a module-scoped runs dir."""
    runs_dir = tmp_path_factory.mktemp("runs-module")
    previous = os.environ.get("TOWNSHIP_RUNS_DIR")
    os.environ["TOWNSHIP_RUNS_DIR"] = str(runs_dir)
    os.environ["MOCK_DELAY_S"] = "0"
    try:
        scenario = load_scenario(MILLBROOK_DIR)
        orch = SimulationOrchestrator(
            anthropic_client=MockProvider(),
            event_bus=EventBus(),
            scenario=scenario,
        )
        district = asyncio.run(orch.run_full_simulation(num_rounds=2))
        assert orch.last_run_dir is not None, "run was not persisted"
        yield {
            "runs_dir": runs_dir,
            "run_dir": orch.last_run_dir,
            "orch": orch,
            "scenario": scenario,
            "district": district,
        }
    finally:
        if previous is None:
            os.environ.pop("TOWNSHIP_RUNS_DIR", None)
        else:
            os.environ["TOWNSHIP_RUNS_DIR"] = previous


# ── Run directory contents ─────────────────────────────────────

def test_run_dir_layout_and_id(completed_run):
    run_dir = completed_run["run_dir"]
    assert run_dir.parent == completed_run["runs_dir"]
    assert RUN_ID_RE.match(run_dir.name), run_dir.name
    assert run_dir.name.endswith("millbrook-budget")
    for filename in ("events.json", "summary.json", "recap.md"):
        assert (run_dir / filename).is_file(), f"missing {filename}"


def test_events_json_is_minified_replay_shape(completed_run):
    raw = (completed_run["run_dir"] / "events.json").read_text()
    assert "\n" not in raw.strip(), "events.json should be minified"
    doc = json.loads(raw)
    events = doc["events"]
    assert len(events) > 10
    types = {e.get("type") for e in events}
    assert "simulation_started" in types
    assert "simulation_ended" in types
    assert "opinion_changed" in types


def test_summary_json_shape(completed_run):
    summary = json.loads((completed_run["run_dir"] / "summary.json").read_text())
    scenario = completed_run["scenario"]
    district = completed_run["district"]

    assert summary["scenario_id"] == scenario.id
    assert summary["run_id"] == completed_run["run_dir"].name
    assert summary["started_at"] <= summary["ended_at"]

    wire = summary["district_summary"]
    assert set(scenario.valid_stance_ids) <= set(wire["overall_opinions"])
    assert wire["total_agents"] == district.total_agents

    assert "total_cost" in summary["usage"]
    counts = summary["counts"]
    assert counts["events"] > 10
    assert counts["towns"] == len(scenario.town_ids)
    assert counts["agents"] == district.total_agents
    assert summary["recap_markdown"]


def test_recap_quality(completed_run):
    recap = (completed_run["run_dir"] / "recap.md").read_text()
    summary = json.loads((completed_run["run_dir"] / "summary.json").read_text())
    assert recap == summary["recap_markdown"]

    scenario = completed_run["scenario"]
    district = completed_run["district"]

    # A real markdown headline, then real prose grounded in real numbers.
    first_line = recap.strip().splitlines()[0]
    assert first_line.startswith("# ")
    assert len(first_line) > 10
    assert len(recap.split()) >= 120, "recap too thin to be a narrative"
    assert str(district.total_agents) in recap
    assert scenario.config.dates.decision_day in recap
    # The template interpolates the leader's human label, never a raw id.
    leader = max(district.prediction, key=lambda k: district.prediction[k])
    assert scenario.option_label[leader] in recap
    assert "{" not in recap and "}" not in recap, "unfilled placeholder leaked"


# ── Runs API ───────────────────────────────────────────────────

def test_api_runs_list_and_get(completed_run, monkeypatch):
    monkeypatch.setenv("TOWNSHIP_RUNS_DIR", str(completed_run["runs_dir"]))
    run_id = completed_run["run_dir"].name
    with TestClient(app) as c:
        listed = c.get("/api/runs")
        assert listed.status_code == 200
        runs = listed.json()["runs"]
        assert [r["run_id"] for r in runs] == [run_id]
        assert runs[0]["scenario_id"] == "millbrook-budget"
        assert runs[0]["headline"]
        assert runs[0]["has_events"] is True

        got = c.get(f"/api/runs/{run_id}")
        assert got.status_code == 200
        assert got.json()["run_id"] == run_id
        assert got.json()["recap_markdown"]


def test_api_runs_export_is_attachment_bundle(completed_run, monkeypatch):
    monkeypatch.setenv("TOWNSHIP_RUNS_DIR", str(completed_run["runs_dir"]))
    run_id = completed_run["run_dir"].name
    with TestClient(app) as c:
        r = c.get(f"/api/runs/{run_id}/export")
    assert r.status_code == 200
    assert f'attachment; filename="{run_id}.json"' == r.headers["content-disposition"]
    bundle = r.json()
    assert bundle["run_id"] == run_id
    assert bundle["summary"]["scenario_id"] == "millbrook-budget"
    assert len(bundle["events"]) > 10
    assert bundle["recap_markdown"]


def test_api_runs_rejects_traversal_and_unknown(completed_run, monkeypatch):
    monkeypatch.setenv("TOWNSHIP_RUNS_DIR", str(completed_run["runs_dir"]))
    # Resolver: anything off-format is refused before touching the filesystem.
    for bad in ("../evil", "..", "20200101-000000-x/../../etc", "/etc/passwd",
                "20200101-000000-Millbrook", ""):
        assert resolve_run_dir(bad) is None, bad
    with TestClient(app) as c:
        # Encoded traversal: either the router refuses the slashed segment or
        # the resolver rejects the decoded id — 404 both ways, never a file.
        assert c.get("/api/runs/..%2fescape").status_code == 404
        r = c.get("/api/runs/20990101-000000-EVIL")
        assert r.status_code == 404
        assert r.json()["error"] == "run_not_found"
        assert c.get("/api/runs/20990101-000000-nope").status_code == 404
        assert c.get("/api/runs/20990101-000000-nope/export").status_code == 404


# ── Replay resolution ──────────────────────────────────────────

def test_replay_by_run_id(completed_run, monkeypatch):
    monkeypatch.setenv("TOWNSHIP_RUNS_DIR", str(completed_run["runs_dir"]))
    run_id = completed_run["run_dir"].name
    events = json.loads((completed_run["run_dir"] / "events.json").read_text())["events"]
    with TestClient(app) as c:
        r = c.post("/api/simulation/replay", json={"run_id": run_id, "speed": 1000})
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "replaying"
        assert body["total_events"] == len(events)

        assert c.post(
            "/api/simulation/replay", json={"run_id": "20990101-000000-nope"}
        ).status_code == 404


def test_replay_rejects_escaping_cache_path():
    with TestClient(app) as c:
        r = c.post("/api/simulation/replay", json={"cache_path": "/etc/passwd"})
        assert r.status_code == 400
        r = c.post("/api/simulation/replay",
                   json={"cache_path": "../../../../etc/passwd"})
        assert r.status_code == 400


def test_replay_available_lists_runs(completed_run, monkeypatch):
    monkeypatch.setenv("TOWNSHIP_RUNS_DIR", str(completed_run["runs_dir"]))
    with TestClient(app) as c:
        r = c.get("/api/simulation/replay/available")
    assert r.status_code == 200
    sources = r.json()["sources"]
    run_ids = [s["run_id"] for s in sources if s["kind"] == "run"]
    assert completed_run["run_dir"].name in run_ids


# ── Latest recap endpoint ──────────────────────────────────────

def test_latest_recap_from_newest_run(completed_run, monkeypatch):
    monkeypatch.setenv("TOWNSHIP_RUNS_DIR", str(completed_run["runs_dir"]))
    # The app's own orchestrator never ran — the route must fall back to disk.
    assert app.state.orchestrator.last_recap is None
    with TestClient(app) as c:
        r = c.get("/api/simulation/recap")
    assert r.status_code == 200
    body = r.json()
    assert body["run_id"] == completed_run["run_dir"].name
    assert body["recap_markdown"].startswith("#")
    assert body["headline"]
    assert not body["headline"].startswith("#")


def test_latest_recap_404_when_none(tmp_path, monkeypatch):
    monkeypatch.setenv("TOWNSHIP_RUNS_DIR", str(tmp_path / "empty-runs"))
    assert app.state.orchestrator.last_recap is None
    with TestClient(app) as c:
        r = c.get("/api/simulation/recap")
    assert r.status_code == 404
    assert r.json()["error"] == "no_recap"


def test_run_id_regex_matches_generated_and_rejects_junk():
    assert RUN_ID_RE.match("20260720-153000-millbrook-budget")
    assert RUN_ID_RE.match("20260720-153000-nj11-2026-2")  # collision suffix
    for junk in ("2026-07-20-nj11", "20260720-153000-", "20260720153000-x",
                 "20260720-153000-NJ11", "20260720-153000-a/b"):
        assert not RUN_ID_RE.match(junk), junk


# Guard: the suite must never leak run dirs into the repo's runs/.
def test_repo_runs_dir_untouched():
    repo_runs = Path(__file__).resolve().parents[1] / "runs"
    env_dir = os.environ.get("TOWNSHIP_RUNS_DIR", "")
    assert env_dir and Path(env_dir).resolve() != repo_runs.resolve()
