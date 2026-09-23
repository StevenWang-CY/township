"""Community II: presence and commuting. A routine stop written as
"<town-id>: <landmark>" puts a resident in that town for the beat; hosted
events draw visitors; conversations and headlines happen where people are,
while seeds, opinions, ballots and summaries stay with the home town."""

from __future__ import annotations

import asyncio

import pytest
from conftest import load_nj11_scenario

from backend.core.event_bus import EventBus
from backend.core.scenario import RoundSpec
from backend.providers.mock import MockProvider
from backend.simulation.orchestrator import SimulationOrchestrator
from backend.simulation.round_manager import RoundManager


@pytest.fixture()
def world(monkeypatch):
    monkeypatch.setenv("MOCK_DELAY_S", "0")
    scenario = load_nj11_scenario()
    bus = EventBus()
    orch = SimulationOrchestrator(anthropic_client=MockProvider(), event_bus=bus, scenario=scenario)
    orch._begin_run(3)
    probe = RoundManager(anthropic_client=orch.client, event_bus=bus, scenario=scenario)
    return scenario, orch, probe, bus


def _commuter(orch):
    """A resident whose routine crosses a town line, with the stop's clock."""
    for town, states in orch.agent_states.items():
        for agent in states:
            for entry in agent.definition.routine:
                loc = str(entry.get("location", ""))
                if ": " in loc:
                    host = loc.split(": ", 1)[0]
                    hh, mm = str(entry["time"]).split(":")
                    return agent, town, host, (int(hh), int(mm))
    pytest.skip("no commuter in the committed neighbors")


def _spec(round_num, clock, phases, **kw):
    return RoundSpec(round=round_num, clock=clock, phases=phases, **kw)


def test_prefixed_stop_commutes_for_talk_beats(world):
    scenario, orch, probe, _ = world
    agent, home, host, clock = _commuter(orch)
    assert probe._stop_in(agent, clock, host) is not None
    assert probe._stop_in(agent, clock, home) is None
    spec = _spec(1, f"{clock[0]:02d}:{clock[1]:02d}", ["converse"], day=1, date="2026-03-27")
    presence = orch._presence(spec, probe)
    assert agent in presence[host] and agent not in presence[home]
    assert agent.current_town == host
    # every resident is in exactly one town
    ids = [a.agent_id for bucket in presence.values() for a in bucket]
    assert len(ids) == len(set(ids)) == sum(len(v) for v in orch.agent_states.values())


def test_home_beats_keep_everyone_home(world):
    scenario, orch, probe, _ = world
    agent, home, host, clock = _commuter(orch)
    hhmm = f"{clock[0]:02d}:{clock[1]:02d}"
    for phases in (["seed"], ["opinion"], ["vote"], ["reflect"]):
        presence = orch._presence(_spec(1, hhmm, phases, day=1), probe)
        for town, states in orch.agent_states.items():
            assert presence[town] == sorted(states, key=lambda a: a.agent_id)
        assert agent.current_town == home


def test_market_keeps_everyone_home(world):
    scenario, orch, probe, _ = world
    agent, home, host, clock = _commuter(orch)
    spec = _spec(
        2,
        f"{clock[0]:02d}:{clock[1]:02d}",
        ["converse"],
        day=2,
        event={"kind": "market", "host_town": home, "label": "Farmers market"},
    )
    presence = orch._presence(spec, probe)
    assert agent in presence[home]


def test_hosted_event_draws_two_voices_and_three_neighbors_per_town(world):
    scenario, orch, probe, _ = world
    spec = _spec(
        5,
        "19:30",
        ["converse"],
        day=3,
        event={"kind": "debate", "host_town": "montclair", "label": "Debate night in Montclair"},
    )
    presence = orch._presence(spec, probe)
    visitors = [a for a in presence["montclair"] if a.definition.town != "montclair"]
    by_town = {}
    for a in visitors:
        by_town.setdefault(a.definition.town, []).append(a)
    assert set(by_town) == set(orch.agent_states) - {"montclair"}
    for town, group in by_town.items():
        assert sum(1 for a in group if a.definition.tier == "voice") == 2, town
        assert sum(1 for a in group if a.definition.tier == "neighbor") == 3, town
    # deterministic: the same beat draws the same people
    again = orch._presence(spec, probe)
    assert [a.agent_id for a in again["montclair"]] == [a.agent_id for a in presence["montclair"]]


def test_visitors_talk_and_gossip_in_the_host_town(world):
    scenario, orch, probe, bus = world
    home, host = "dover", "parsippany"
    visitor = next(a for a in orch.agent_states[home] if a.definition.tier == "voice")

    async def run():
        seed = _spec(0, "07:30", ["seed"], day=1)
        for town, states in orch.agent_states.items():
            await probe.run_town_round(town, states, seed, 3)
        visitor.current_town = host
        present = sorted([*orch.agent_states[host], visitor], key=lambda a: a.agent_id)
        beat = _spec(1, "12:30", ["converse"], day=1)
        await probe.run_town_round(host, orch.agent_states[host], beat, 3, present=present)

    asyncio.run(run())
    log = bus.get_event_log()
    hosted = [
        e
        for e in log
        if e.type == "agent_moved" and e.agent_id == visitor.agent_id and e.town == host
    ]
    assert hosted, "the visitor's moves happen in the host town"
    assert all(e.home_town == home for e in hosted)
    convo = [
        e
        for e in log
        if e.type == "conversation_started" and visitor.agent_id in e.conversation.participants
    ]
    assert convo and all(e.conversation.town == host for e in convo)
    gossip = [e for e in log if e.type == "cross_town_gossip"]
    assert any(
        e.from_agent == visitor.agent_id and e.from_town == home and e.to_town == host
        for e in gossip
    )
    assert any(e.to_agent == visitor.agent_id and e.to_town == home for e in gossip)
    assert visitor.pending_topics, "the visitor carries the topic home"


def test_visitors_hear_the_host_towns_local_news(world):
    scenario, orch, probe, bus = world
    local = next(
        n for n in scenario.config.news if n.towns and len(n.towns) < len(orch.agent_states)
    )
    host = local.towns[0]
    home = next(t for t in orch.agent_states if t not in local.towns)
    visitor = next(a for a in orch.agent_states[home] if a.definition.tier == "voice")

    async def run():
        seed = _spec(0, "07:30", ["seed"], day=1)
        for town, states in orch.agent_states.items():
            await probe.run_town_round(town, states, seed, 3)
        visitor.current_town = host
        present = sorted([*orch.agent_states[host], visitor], key=lambda a: a.agent_id)
        beat = _spec(1, "12:30", ["news"], news_ids=[local.id], day=1)
        await probe.run_town_round(host, orch.agent_states[host], beat, 3, present=present)

    asyncio.run(run())
    log = bus.get_event_log()
    reactions = [
        e for e in log if e.type == "news_reaction" and e.reaction.agent_id == visitor.agent_id
    ]
    assert reactions and all(e.reaction.town == host for e in reactions)
    assert [e for e in log if e.type == "news_injected" and e.news_id == local.id]


def test_summary_counts_residents_not_visitors(world):
    scenario, orch, probe, bus = world
    home, host = "dover", "parsippany"
    visitor = next(a for a in orch.agent_states[home] if a.definition.tier == "voice")

    async def run():
        seed = _spec(0, "07:30", ["seed"], day=1)
        for town, states in orch.agent_states.items():
            await probe.run_town_round(town, states, seed, 3)
        visitor.current_town = host
        present = sorted([*orch.agent_states[host], visitor], key=lambda a: a.agent_id)
        beat = _spec(1, "12:30", ["converse"], day=1)
        return await probe.run_town_round(host, orch.agent_states[host], beat, 3, present=present)

    asyncio.run(run())
    ended = [
        e
        for e in bus.get_event_log()
        if e.type == "round_ended" and e.town == host and e.round == 1
    ]
    assert ended
    wire = ended[-1].summary[0]
    assert wire["town"] == host
    assert sum(wire["opinions"].values()) == len(orch.agent_states[host])


def test_visitor_prompt_says_where_they_are(world):
    scenario, orch, probe, _ = world
    visitor = next(a for a in orch.agent_states["dover"] if a.definition.tier == "voice")
    visitor.current_town = "parsippany"
    prompt = probe._build_agent_system_prompt(visitor, round_num=1)
    assert "Today you are in" in prompt and "Parsippany" in prompt
    visitor.current_town = None
    assert "Today you are in" not in probe._build_agent_system_prompt(visitor, round_num=1)
