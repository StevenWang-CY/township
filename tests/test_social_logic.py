"""Social logic in the round manager: seeded, relationship-aware pairing and
routine-driven meeting places. Runs offline against the shipped packages."""

from __future__ import annotations

import asyncio
from pathlib import Path

from backend.core.event_bus import EventBus
from backend.core.scenario import load_scenario
from backend.providers.mock import MockProvider
from backend.simulation.orchestrator import SimulationOrchestrator
from backend.simulation.round_manager import RoundManager

NJ_DIR = str(Path(__file__).resolve().parents[1] / "scenarios" / "nj11-2026")


def _manager_and_agents(town: str = "dover"):
    scenario = load_scenario(NJ_DIR)
    provider = MockProvider()
    bus = EventBus()
    orchestrator = SimulationOrchestrator(provider, bus, scenario)
    manager = RoundManager(provider, bus, scenario)
    return manager, orchestrator.agent_states[town], scenario


def _pair_ids(pairs):
    return sorted(tuple(sorted((a.agent_id, b.agent_id))) for a, b in pairs)


def test_pairs_are_deterministic_across_runs():
    m1, agents1, _ = _manager_and_agents()
    m2, agents2, _ = _manager_and_agents()
    first = _pair_ids(m1._random_pairs(agents1, count=3, round_num=1))
    second = _pair_ids(m2._random_pairs(agents2, count=3, round_num=1))
    assert first == second
    assert len(first) == 3
    # A different round draws a different (but still deterministic) pairing
    # because recent partners are pushed apart.
    later = _pair_ids(m1._random_pairs(agents1, count=3, round_num=2))
    assert later != first


def test_pairs_prefer_declared_relationships():
    manager, agents, _ = _manager_and_agents()
    by_id = {a.agent_id: a for a in agents}
    carlos = by_id["carlos-restrepo"]
    strongest = max(
        (rel for rel in carlos.definition.relationships if rel.get("agent") in by_id),
        key=lambda rel: float(rel.get("strength", 0)),
    )
    assert manager._relationship_strength(carlos, by_id[strongest["agent"]]) == float(
        strongest["strength"]
    )
    pairs = manager._random_pairs(agents, count=3, round_num=1)
    partner = next(
        (b.agent_id if a is carlos else a.agent_id) for a, b in pairs if carlos in (a, b)
    )
    # Carlos ends up with someone he actually knows, not a stranger.
    assert manager._relationship_strength(carlos, by_id[partner]) > 0


def test_meeting_place_follows_the_routine_clock():
    manager, agents, scenario = _manager_and_agents()
    by_id = {a.agent_id: a for a in agents}
    carlos, tom = by_id["carlos-restrepo"], by_id["tom-kowalski"]
    landmarks = {lm["name"] for lm in scenario.towns["dover"]["landmarks"]}

    # 14:30 — both routines put Carlos and Tom at Bodega Row for coffee.
    assert manager._routine_stop(carlos, (14, 30)) == "Bodega Row"
    assert manager._meeting_place("dover", carlos, tom, (14, 30), 1) == "Bodega Row"

    # Every meeting place is a real landmark, whatever the hour.
    for clock in ((8, 0), (13, 0), (19, 0), None):
        place = manager._meeting_place("dover", carlos, by_id["sofia-ramirez"], clock, 2)
        assert place in landmarks

    # Evening meetings prefer parks, churches and the station.
    evening = manager._meeting_place("dover", carlos, by_id["esperanza-guzman"], (19, 0), 4)
    assert evening in landmarks


def test_conversation_round_records_pairs_and_moves_agents_to_landmarks():
    manager, agents, scenario = _manager_and_agents()
    landmarks = {lm["name"] for lm in scenario.towns["dover"]["landmarks"]}
    manager._round_clock["dover"] = (13, 0)
    manager._current_round["dover"] = 2
    asyncio.run(manager._run_conversation_round(agents, round_num=2))
    moves = [e for e in manager.event_bus.get_event_log() if e.type == "agent_moved"]
    assert moves, "a conversation round moves its participants"
    assert {e.to_location for e in moves} <= landmarks
    assert manager._recent_pairs["dover"][2]
