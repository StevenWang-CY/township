"""The neighbors tier: generated background residents committed as scenario
data, loaded behind the voices, run by the influence ledger — never the model."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest
from conftest import NJ11_SCENARIO_DIR, FakeClient, load_nj11_scenario

from backend.community.neighbors import (
    MAX_PER_TOWN,
    MIN_PER_TOWN,
    NEIGHBORS_FILENAME,
    count_for_town,
    generate_neighbors,
    load_neighbors_file,
    neighbor_to_definition,
)
from backend.core.agent_loader import agent_id_from_name
from backend.core.event_bus import EventBus
from backend.core.types import AgentState
from backend.core.wire import agent_state_to_wire
from backend.simulation.orchestrator import SimulationOrchestrator
from backend.simulation.round_manager import RoundManager


@pytest.fixture(scope="module")
def scenario():
    return load_nj11_scenario()


def _voices(scenario, town):
    return [d for d in scenario.agents[town] if d.tier == "voice"]


def _neighbors(scenario, town):
    return [d for d in scenario.agents[town] if d.tier == "neighbor"]


def _population(scenario, town) -> int:
    return int((scenario.towns[town].get("demographics") or {}).get("population") or 0)


def test_committed_files_match_the_generator(scenario):
    """Same seed → the same file, town after town (ids accumulate across towns)."""
    taken: set[str] = set()
    for town in scenario.town_ids:
        path = Path(NJ11_SCENARIO_DIR) / "agents" / town / NEIGHBORS_FILENAME
        committed = json.loads(path.read_text())
        seed = committed["seed"]
        generated = generate_neighbors(scenario, town, seed=seed, avoid_ids=set(taken))
        assert generated == committed, f"{town}: regenerate with `township new-neighbors`"
        again = generate_neighbors(scenario, town, seed=seed, avoid_ids=set(taken))
        assert again == generated
        taken.update(agent_id_from_name(nb["name"]) for nb in generated["neighbors"])


def test_counts_scale_with_population_within_bounds(scenario):
    counts = {t: count_for_town(scenario, t) for t in scenario.town_ids}
    assert all(MIN_PER_TOWN <= n <= MAX_PER_TOWN for n in counts.values())
    pops = {t: _population(scenario, t) for t in scenario.town_ids}
    smallest, largest = min(pops, key=pops.get), max(pops, key=pops.get)
    assert counts[smallest] == MIN_PER_TOWN and counts[largest] == MAX_PER_TOWN
    for town in scenario.town_ids:
        assert len(_neighbors(scenario, town)) == counts[town]


def test_ids_unique_across_the_district(scenario):
    ids = [agent_id_from_name(d.name) for v in scenario.agents.values() for d in v]
    assert len(ids) == len(set(ids))


def test_lean_mix_follows_the_authored_community(scenario):
    cfg = json.loads((Path(NJ11_SCENARIO_DIR) / "community.json").read_text())
    for town in scenario.town_ids:
        mix = cfg["towns"][town]["lean_mix"]
        nbs = _neighbors(scenario, town)
        for lean, share in mix.items():
            got = sum(1 for d in nbs if d.initial_lean == lean) / len(nbs)
            assert abs(got - share) <= 0.10, f"{town} {lean}: {got:.2f} vs {share:.2f}"


def test_routine_stops_resolve_to_landmarks(scenario):
    for town in scenario.town_ids:
        names = {lm["name"] for lm in scenario.towns[town].get("landmarks", [])}
        for d in _neighbors(scenario, town):
            assert d.routine, d.name
            for entry in d.routine:
                loc = entry["location"]
                if ": " in loc:
                    other, landmark = loc.split(": ", 1)
                    assert other in scenario.towns and other != town
                    assert landmark in {lm["name"] for lm in scenario.towns[other]["landmarks"]}
                else:
                    assert loc in names, f"{d.name}: {loc}"


def test_definitions_are_fictional_and_toolless(scenario):
    for town in scenario.town_ids:
        for d in _neighbors(scenario, town):
            assert d.tools == []
            assert "not a real person" in d.system_prompt
            assert d.top_concerns and 2 <= len(d.top_concerns) <= 3
            assert 0.0 <= (d.turnout or 0) <= 1.0 and 0.0 <= (d.persuadability or 0) <= 1.0
        for v in _voices(scenario, town):
            assert v.tools


def test_loader_rejects_unknown_and_missing_keys(scenario, tmp_path):
    src = Path(NJ11_SCENARIO_DIR) / "agents" / "dover" / NEIGHBORS_FILENAME
    data = json.loads(src.read_text())
    data["neighbors"][0]["favourite_color"] = "teal"
    bad = tmp_path / NEIGHBORS_FILENAME
    bad.write_text(json.dumps(data))
    with pytest.raises(ValueError):
        load_neighbors_file(bad, "dover", scenario)
    data["neighbors"][0].pop("favourite_color")
    data["neighbors"][0].pop("routine")
    bad.write_text(json.dumps(data))
    with pytest.raises(ValueError):
        load_neighbors_file(bad, "dover", scenario)


def test_neighbor_definition_round_trips(scenario):
    path = Path(NJ11_SCENARIO_DIR) / "agents" / "dover" / NEIGHBORS_FILENAME
    nb = json.loads(path.read_text())["neighbors"][0]
    d = neighbor_to_definition(nb, "dover", scenario)
    assert d.tier == "neighbor" and d.town == "dover" and d.name == nb["name"]
    assert d.initial_lean == nb["initial_lean"] and d.issue_weights == nb["issue_weights"]


def _state(d) -> AgentState:
    return AgentState(
        agent_id=agent_id_from_name(d.name), definition=d, current_location=d.routine[0]["location"]
    )


def test_wire_carries_tier_and_home_town(scenario):
    wire = agent_state_to_wire(_state(_neighbors(scenario, "dover")[0]), scenario)
    assert wire["tier"] == "neighbor" and wire["home_town"] == "dover"
    assert agent_state_to_wire(_state(_voices(scenario, "dover")[0]), scenario)["tier"] == "voice"


def test_neighbors_never_reach_the_model(scenario, monkeypatch):
    """Three quick rounds in Dover: every model call is for a voice; neighbors
    still form opinions and talk, and the summary keeps the tiers apart."""
    monkeypatch.setenv("MOCK_DELAY_S", "0")
    prompts: list[str] = []
    original = RoundManager._call

    async def spy(self, *, prior=None, **kwargs):
        prompts.append(kwargs.get("system_prompt", ""))
        return await original(self, prior=prior, **kwargs)

    monkeypatch.setattr(RoundManager, "_call", spy)
    bus = EventBus()
    orch = SimulationOrchestrator(anthropic_client=FakeClient(), event_bus=bus, scenario=scenario)
    summary = asyncio.run(orch.run_single_town("dover", num_rounds=3))
    neighbor_names = {d.name for d in _neighbors(scenario, "dover")}
    assert prompts, "the voices must still talk to the model"
    for p in prompts:
        head = p[:400]
        assert not any(n in head for n in neighbor_names), head[:120]
    log = bus.get_event_log()
    seeds = [e for e in log if e.type == "opinion_changed" and e.round == 0]
    assert len(seeds) == len(scenario.agents["dover"])
    neighbor_ids = {agent_id_from_name(n) for n in neighbor_names}
    speech = [e for e in log if e.type == "agent_speech" and e.agent_id in neighbor_ids]
    assert speech, "neighbors murmur through the grammar"
    for e in (e for e in log if e.type == "conversation_started"):
        # a staged conversation always has a voice in it
        assert not set(e.conversation.participants) <= neighbor_ids
    assert set(summary.by_tier) == {"voice", "neighbor"}
    assert sum(summary.by_tier["neighbor"].values()) == len(neighbor_ids)
    assert sum(sum(v.values()) for v in summary.by_tier.values()) == len(scenario.agents["dover"])
