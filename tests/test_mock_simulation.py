"""
End-to-end simulation tests on the deterministic MockProvider — zero
credentials, zero network.

Covers:
  - a full 5-round single-town run through the scenario round plan
    (event sequence sanity, decided agents, stance validity, summary shape)
  - a short full-district run (simulation_started/_ended envelope,
    district summary aggregation, cache write)
"""

import asyncio

import pytest
from conftest import load_nj11_scenario

from backend.core.event_bus import EventBus
from backend.core.types import CivicAgentState, TownSummary
from backend.providers.mock import MockProvider
from backend.simulation.orchestrator import SimulationOrchestrator


@pytest.fixture()
def mock_orchestrator(monkeypatch):
    monkeypatch.setenv("MOCK_DELAY_S", "0")
    scenario = load_nj11_scenario()
    orch = SimulationOrchestrator(
        anthropic_client=MockProvider(),
        event_bus=EventBus(),
        scenario=scenario,
    )
    return orch, scenario


def _events_of(bus: EventBus, event_type: str) -> list:
    return [e for e in bus.get_event_log() if getattr(e, "type", None) == event_type]


# ── Single town, all 5 rounds ──────────────────────────────────


def test_single_town_five_round_mock_sim(mock_orchestrator):
    orch, scenario = mock_orchestrator
    summary = asyncio.run(orch.run_single_town("dover", 5))

    # ── Summary shape ──
    assert isinstance(summary, TownSummary)
    assert summary.town == "dover"
    assert summary.rounds_completed == 5
    dover_agents = orch.agent_states["dover"]
    assert len(summary.agent_summaries) == len(dover_agents)
    assert summary.total_conversations > 0
    assert summary.failed_agents == 0

    # Distribution carries the full stance roster and sums to the roster size.
    for stance in scenario.valid_stance_ids:
        assert stance in summary.opinion_distribution
    assert sum(summary.opinion_distribution.values()) == len(dover_agents)

    # ── Event sequence sanity ──
    bus = orch.event_bus
    started_rounds = [e.round for e in _events_of(bus, "round_started")]
    ended_rounds = [e.round for e in _events_of(bus, "round_ended")]
    assert started_rounds == [0, 1, 2, 3, 4]
    assert ended_rounds == [0, 1, 2, 3, 4]

    # The decide phase names its voters on the wire: every Dover resident in
    # the final round, nobody before it.
    ended_events = _events_of(bus, "round_ended")
    assert [e.decided_agent_ids for e in ended_events[:-1]] == [[], [], [], []]
    assert sorted(ended_events[-1].decided_agent_ids) == sorted(a.agent_id for a in dover_agents)

    # Every round_started precedes its round_ended.
    log = bus.get_event_log()
    for rnd in range(5):
        start_idx = next(
            i
            for i, e in enumerate(log)
            if getattr(e, "type", None) == "round_started" and e.round == rnd
        )
        end_idx = next(
            i
            for i, e in enumerate(log)
            if getattr(e, "type", None) == "round_ended" and e.round == rnd
        )
        assert start_idx < end_idx

    # One world-clock tick per round, following the scenario's clocks.
    ticks = _events_of(bus, "world_clock_tick")
    assert [(t.hour, t.minute) for t in ticks] == [(8, 0), (10, 0), (13, 0), (16, 0), (19, 0)]

    # News injected on the scenario's news rounds (1 and 3 → 3 items total).
    news = _events_of(bus, "news_injected")
    assert len(news) == 3
    assert sorted({e.round for e in news}) == [1, 3]

    # Opinions were formed and every one is on the scenario's stance roster.
    opinion_events = _events_of(bus, "opinion_changed")
    assert opinion_events, "no opinions formed in 5 rounds"
    valid = set(scenario.valid_stance_ids)
    for e in opinion_events:
        assert e.new_opinion.candidate in valid

    # Conversations happened.
    assert _events_of(bus, "conversation_started")
    assert _events_of(bus, "agent_speech")

    # ── Model II: opinions move for a reason ──
    flips = [
        e
        for e in opinion_events
        if e.old_opinion is not None and e.old_opinion.candidate != e.new_opinion.candidate
    ]
    voice_ids = {a.agent_id for a in dover_agents if a.definition.tier == "voice"}
    voice_flips = [e for e in flips if e.agent_id in voice_ids]
    assert 1 <= len(voice_flips) <= 8, (
        f"expected a few real changes of mind, got {len(voice_flips)}"
    )
    # Neighbors move too, but the town must not churn: at most ~one flip per resident.
    assert len(flips) <= len(dover_agents), (
        f"town churned: {len(flips)} flips for {len(dover_agents)} residents"
    )
    for e in flips:
        assert e.trigger is not None and e.trigger.kind != "seed"
        assert e.influences, f"{e.agent_name} changed their mind in round {e.round} with no cause"
        for inf in e.influences:
            assert inf.ref.split(":", 1)[0] in {
                "conv",
                "news",
                "gossip",
                "persona",
                "god",
                "reflection",
            }
            assert 0.0 <= inf.weight <= 1.0
    for e in opinion_events:
        if e.round == 0:
            assert e.trigger is not None and e.trigger.kind == "seed"
        assert e.reason is None or len(e.reason) <= 200

    # ── Ballots: one per resident in the decide round; abstentions stay rare ──
    ballots = _events_of(bus, "ballot_cast")
    assert sorted(b.agent_id for b in ballots) == sorted(a.agent_id for a in dover_agents)
    assert {b.round for b in ballots} == {4}
    voice_ids = {a.agent_id for a in dover_agents if a.definition.tier == "voice"}
    assert sum(1 for b in ballots if b.option is None and b.agent_id in voice_ids) <= 1
    # Neighbors carry authored turnout (0.35–0.95), so some of them stay home.
    assert sum(1 for b in ballots if b.option is None) <= len(dover_agents) // 3
    election = summary.election
    assert election is not None and election["mode"] == "ballots"
    assert (
        sum(election["tally"].values()) + election["abstained"]
        == election["eligible"]
        == len(dover_agents)
    )
    assert summary.notable_conversations, (
        "the summary should name the conversations that moved people"
    )

    # ── Agent end-state ──
    for agent in dover_agents:
        assert agent.state == CivicAgentState.DECIDED
        assert agent.opinions, f"{agent.agent_id} never formed an opinion"
        for op in agent.opinions:
            assert op.candidate in valid


# ── Full district run (trimmed to 2 rounds for speed) ─────────


def test_full_district_mock_sim(mock_orchestrator, monkeypatch, tmp_path):
    orch, scenario = mock_orchestrator
    # Keep the cache write out of the repo's data/ directory.
    monkeypatch.setattr(
        "backend.simulation.orchestrator.DEFAULT_CACHE_PATH",
        tmp_path / "simulation_cache.json",
    )

    district = asyncio.run(orch.run_full_simulation(num_rounds=2))

    bus = orch.event_bus
    started = _events_of(bus, "simulation_started")
    assert len(started) == 1
    assert set(started[0].towns) == set(scenario.town_ids)
    total_agents = sum(len(v) for v in orch.agent_states.values())
    assert len(started[0].agents) == total_agents
    # Roster colors come from the town JSONs' accent_color now.
    roster_by_town = {a["town"]: a for a in started[0].agents}
    assert roster_by_town["dover"]["color"] == "#E8763B"

    ended = _events_of(bus, "simulation_ended")
    assert len(ended) == 1
    overall = ended[0].summary["overall_opinions"]
    assert set(scenario.valid_stance_ids) <= set(overall)

    # District summary aggregates every town and every roster stance.
    assert set(district.by_town) == set(scenario.town_ids)
    # Model II: the wire carries the district election block (straw poll after 2 rounds).
    assert district.election is not None
    assert set(district.election["per_town"]) == set(scenario.town_ids)
    assert district.election["mode"] == "straw_poll"
    assert set(ended[0].summary["overall_opinions"]) >= set(scenario.valid_stance_ids)
    assert "election" in ended[0].summary
    assert district.total_agents == total_agents
    for stance in scenario.valid_stance_ids:
        assert stance in district.prediction
    assert district.failed_agents == 0

    # The replay cache landed at the patched path.
    assert (tmp_path / "simulation_cache.json").is_file()
