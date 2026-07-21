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
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from backend.core.event_bus import EventBus
from backend.core.scenario import load_scenario
from backend.main import app
from backend.providers.mock import MockProvider
from backend.routes.runs import RUN_ID_RE, resolve_run_dir
from backend.simulation.orchestrator import SimulationOrchestrator
from backend.simulation.replay import load_cache_summary, replay

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
    assert "-millbrook-budget-" in run_dir.name
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
    assert bundle["schema_version"] == 1
    assert bundle["privacy_version"] == 1
    assert bundle["summary"]["scenario_id"] == "millbrook-budget"
    assert len(bundle["events"]) > 10
    assert bundle["recap_markdown"]


def test_export_bundle_round_trips_through_replay(completed_run, monkeypatch, tmp_path):
    monkeypatch.setenv("TOWNSHIP_RUNS_DIR", str(completed_run["runs_dir"]))
    run_id = completed_run["run_dir"].name
    with TestClient(app) as client:
        response = client.get(f"/api/runs/{run_id}/export")
    exported = tmp_path / "export.json"
    exported.write_bytes(response.content)

    summary = asyncio.run(load_cache_summary(str(exported)))
    assert summary["total_events"] == len(response.json()["events"])
    bus = EventBus()
    asyncio.run(replay(bus, str(exported), speed=1_000))
    assert bus.get_event_log()


def test_api_runs_export_redacts_legacy_private_events(completed_run, monkeypatch):
    monkeypatch.setenv("TOWNSHIP_RUNS_DIR", str(completed_run["runs_dir"]))
    run_id = completed_run["run_dir"].name
    events_path = completed_run["run_dir"] / "events.json"
    original = events_path.read_text(encoding="utf-8")
    document = json.loads(original)
    document["events"].append(
        {
            "type": "relationship_update",
            "agent_id": "resident-1",
            "player_id": "legacy-private-player",
            "trust": 8,
            "delta": 1,
            "classification": "curious",
        }
    )
    events_path.write_text(json.dumps(document), encoding="utf-8")
    try:
        with TestClient(app) as client:
            response = client.get(f"/api/runs/{run_id}/export")
        assert response.status_code == 200
        assert all(
            event.get("type") != "relationship_update" for event in response.json()["events"]
        )
        assert "legacy-private-player" not in response.text
    finally:
        events_path.write_text(original, encoding="utf-8")


def test_api_runs_rejects_traversal_and_unknown(completed_run, monkeypatch):
    monkeypatch.setenv("TOWNSHIP_RUNS_DIR", str(completed_run["runs_dir"]))
    # Resolver: anything off-format is refused before touching the filesystem.
    for bad in (
        "../evil",
        "..",
        "20200101-000000-x/../../etc",
        "/etc/passwd",
        "20200101-000000-Millbrook",
        "",
    ):
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


def test_run_directory_symlink_alias_is_rejected_by_every_run_surface(tmp_path, monkeypatch):
    real_id = "20260721-120000-real-run"
    alias_id = "20260721-120001-alias-run"
    real_dir = tmp_path / real_id
    real_dir.mkdir()
    (real_dir / "summary.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "privacy_version": 1,
                "run_id": real_id,
                "scenario_id": "millbrook-budget",
                "recap_markdown": "# Real run",
            }
        ),
        encoding="utf-8",
    )
    (real_dir / "events.json").write_text(
        json.dumps({"schema_version": 1, "privacy_version": 1, "events": []}),
        encoding="utf-8",
    )
    (real_dir / "recap.md").write_text("# Real run", encoding="utf-8")
    (tmp_path / alias_id).symlink_to(real_dir, target_is_directory=True)
    monkeypatch.setenv("TOWNSHIP_RUNS_DIR", str(tmp_path))

    assert resolve_run_dir(real_id) == real_dir
    assert resolve_run_dir(alias_id) is None
    with TestClient(app) as client:
        detail = client.get(f"/api/runs/{alias_id}")
        export = client.get(f"/api/runs/{alias_id}/export")
        replay_response = client.post(
            "/api/simulation/replay",
            json={"run_id": alias_id, "speed": 1_000},
        )
        listed = client.get("/api/runs").json()["runs"]
        replay_sources = client.get("/api/simulation/replay/available").json()["sources"]

    assert detail.status_code == export.status_code == replay_response.status_code == 404
    assert alias_id not in {run["run_id"] for run in listed}
    assert alias_id not in {
        source.get("run_id") for source in replay_sources if source["kind"] == "run"
    }
    assert real_id in {run["run_id"] for run in listed}


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

        assert (
            c.post("/api/simulation/replay", json={"run_id": "20990101-000000-nope"}).status_code
            == 404
        )


def test_replay_rejects_escaping_cache_path():
    with TestClient(app) as c:
        r = c.post("/api/simulation/replay", json={"cache_path": "/etc/passwd"})
        assert r.status_code == 400
        r = c.post("/api/simulation/replay", json={"cache_path": "../../../../etc/passwd"})
        assert r.status_code == 400


def test_marked_malformed_replay_is_rejected_before_background_start(tmp_path, monkeypatch):
    run_id = "20260721-120000-invalid-artifact"
    run_dir = tmp_path / run_id
    run_dir.mkdir()
    (run_dir / "summary.json").write_text(
        json.dumps({"schema_version": 1, "privacy_version": 1, "run_id": run_id}),
        encoding="utf-8",
    )
    (run_dir / "events.json").write_text(
        json.dumps({"schema_version": 1, "privacy_version": 1, "events": "oops"}),
        encoding="utf-8",
    )
    monkeypatch.setenv("TOWNSHIP_RUNS_DIR", str(tmp_path))
    with TestClient(app) as client:
        response = client.post("/api/simulation/replay", json={"run_id": run_id})
    assert response.status_code == 404
    assert response.json()["message"] == "Replay cache is invalid"


def test_unversioned_run_is_never_publicly_served(tmp_path, monkeypatch):
    run_id = "20260721-120000-legacy-private"
    run_dir = tmp_path / run_id
    run_dir.mkdir()
    sentinel = "PRIVATE-LEGACY-SENTINEL"
    (run_dir / "summary.json").write_text(
        json.dumps({"run_id": run_id, "recap_markdown": sentinel}), encoding="utf-8"
    )
    (run_dir / "events.json").write_text(
        json.dumps({"events": [{"type": "agent_speech", "text": sentinel}]}),
        encoding="utf-8",
    )
    (run_dir / "recap.md").write_text(sentinel, encoding="utf-8")
    monkeypatch.setenv("TOWNSHIP_RUNS_DIR", str(tmp_path))

    with TestClient(app) as client:
        listing = client.get("/api/runs")
        detail = client.get(f"/api/runs/{run_id}")
        export = client.get(f"/api/runs/{run_id}/export")
    assert listing.json() == {"runs": [], "restricted_legacy_runs": 1}
    assert detail.status_code == export.status_code == 409
    assert sentinel not in listing.text + detail.text + export.text


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
    for junk in (
        "2026-07-20-nj11",
        "20260720-153000-",
        "20260720153000-x",
        "20260720-153000-NJ11",
        "20260720-153000-a/b",
    ):
        assert not RUN_ID_RE.match(junk), junk


def test_run_directory_publication_is_atomic_and_collision_safe(tmp_path, monkeypatch):
    monkeypatch.setenv("TOWNSHIP_RUNS_DIR", str(tmp_path))
    scenario = load_scenario(MILLBROOK_DIR)
    started = datetime(2026, 7, 21, 12, 0, tzinfo=UTC)

    def persist_one(_index: int):
        orchestrator = SimulationOrchestrator(MockProvider(), EventBus(), scenario)
        orchestrator._run_started_at = started
        return orchestrator._persist_run("# Complete", [], {"total_cost": 0})

    with ThreadPoolExecutor(max_workers=2) as pool:
        run_dirs = list(pool.map(persist_one, range(2)))

    assert len({path.name for path in run_dirs}) == 2
    assert all((path / "events.json").is_file() for path in run_dirs)
    assert all((path / "summary.json").is_file() for path in run_dirs)
    assert not any(path.name.startswith(".township-run-") for path in tmp_path.iterdir())


def test_failed_run_staging_never_exposes_a_partial_run(tmp_path, monkeypatch):
    import backend.simulation.orchestrator as orchestrator_module

    monkeypatch.setenv("TOWNSHIP_RUNS_DIR", str(tmp_path))
    scenario = load_scenario(MILLBROOK_DIR)
    orchestrator = SimulationOrchestrator(MockProvider(), EventBus(), scenario)
    real_save = orchestrator_module.save_json_atomic

    def fail_summary(path, value, minify=False):
        if Path(path).name == "summary.json":
            raise OSError("simulated disk failure")
        return real_save(path, value, minify=minify)

    monkeypatch.setattr(orchestrator_module, "save_json_atomic", fail_summary)
    with pytest.raises(OSError, match="simulated disk failure"):
        orchestrator._persist_run("# Incomplete", [], {"total_cost": 0})
    assert list(tmp_path.iterdir()) == []


# Guard: the suite must never leak run dirs into the repo's runs/.
def test_repo_runs_dir_untouched():
    repo_runs = Path(__file__).resolve().parents[1] / "runs"
    env_dir = os.environ.get("TOWNSHIP_RUNS_DIR", "")
    assert env_dir and Path(env_dir).resolve() != repo_runs.resolve()
