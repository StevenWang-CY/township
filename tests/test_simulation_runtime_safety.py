"""Regression coverage for run isolation, round barriers, and live admission."""

import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

import pytest
from starlette.requests import Request
from starlette.testclient import TestClient

from backend.core.event_bus import EventBus
from backend.core.scenario import load_scenario
from backend.core.storage import PROJECT_ROOT as APPLICATION_ROOT
from backend.core.types import NewsReaction, Opinion
from backend.main import app
from backend.providers.mock import MockProvider
from backend.routes.gods_view import GodViewRequest, inject_god_view
from backend.routes.simulation import PROJECT_ROOT as REPLAY_ROOT
from backend.simulation.orchestrator import (
    DEFAULT_CACHE_PATH,
    SimulationOrchestrator,
)
from backend.simulation.round_manager import RoundManager

MILLBROOK_DIR = Path(__file__).resolve().parents[1] / "scenarios" / "millbrook-budget"


@pytest.fixture()
def runtime(monkeypatch, tmp_path):
    monkeypatch.setenv("MOCK_DELAY_S", "0")
    monkeypatch.setenv("TOWNSHIP_RUNS_DIR", str(tmp_path / "runs"))
    monkeypatch.setenv("TOWNSHIP_CACHE_PATH", str(tmp_path / "simulation-cache.json"))
    scenario = load_scenario(MILLBROOK_DIR)
    provider = MockProvider()
    bus = EventBus()
    orchestrator = SimulationOrchestrator(provider, bus, scenario)
    return orchestrator, provider, bus, scenario


def _run_events(orchestrator: SimulationOrchestrator):
    return list(orchestrator._last_run_events)


def test_round_barriers_weather_caps_and_gossip_order(runtime):
    orchestrator, _, bus, scenario = runtime
    observed_rounds: list[tuple[int, int]] = []

    async def observe_round(event):
        observed_rounds.append((event.round, orchestrator.current_round))

    bus.subscribe("round_started", observe_round)
    asyncio.run(orchestrator.run_full_simulation(num_rounds=4))
    events = _run_events(orchestrator)

    assert observed_rounds
    assert all(event_round == live_round for event_round, live_round in observed_rounds)
    assert [
        event.weather for event in events if event.type == "weather_changed"
    ] == scenario.config.weather_schedule[:4]

    for round_num in range(3):
        last_end = max(
            index
            for index, event in enumerate(events)
            if event.type == "round_ended" and event.round == round_num
        )
        first_next_start = min(
            index
            for index, event in enumerate(events)
            if event.type == "round_started" and event.round == round_num + 1
        )
        assert last_end < first_next_start

    agent_towns = {
        agent.agent_id: town
        for town, agents in orchestrator.agent_states.items()
        for agent in agents
    }
    cross_town_starts = [
        (index, event)
        for index, event in enumerate(events)
        if event.type == "conversation_started"
        and len({agent_towns[agent_id] for agent_id in event.conversation.participants}) > 1
    ]
    assert cross_town_starts
    assert {event.conversation.round for _, event in cross_town_starts} == {2, 3}

    round_2_end = max(
        index
        for index, event in enumerate(events)
        if event.type == "round_ended" and event.round == 2
    )
    round_3_start = min(
        index
        for index, event in enumerate(events)
        if event.type == "round_started" and event.round == 3
    )
    round_2_gossip = [index for index, event in cross_town_starts if event.conversation.round == 2]
    assert round_2_end < min(round_2_gossip) < round_3_start

    round_3_end = max(
        index
        for index, event in enumerate(events)
        if event.type == "round_ended" and event.round == 3
    )
    simulation_end = next(
        index for index, event in enumerate(events) if event.type == "simulation_ended"
    )
    round_3_gossip = [index for index, event in cross_town_starts if event.conversation.round == 3]
    assert round_3_end < min(round_3_gossip) < simulation_end
    assert orchestrator.current_round == 3


def test_one_round_cap_emits_one_weather_and_no_gossip(runtime):
    orchestrator, _, _, scenario = runtime
    asyncio.run(orchestrator.run_full_simulation(num_rounds=1))
    events = _run_events(orchestrator)

    assert [event.round for event in events if event.type == "round_started"] == [0, 0]
    assert [event.weather for event in events if event.type == "weather_changed"] == [
        scenario.config.weather_schedule[0]
    ]
    assert not [event for event in events if event.type == "cross_town_gossip"]


def test_sequential_runs_have_fresh_state_events_summaries_and_usage(runtime):
    orchestrator, provider, _, scenario = runtime

    async def run_three():
        await orchestrator.run_single_town("harlow-crossing", num_rounds=1)
        first_dir = orchestrator.last_run_dir
        first_shape = [
            (len(agent.opinions), len(agent.memories), len(agent.conversations))
            for agent in orchestrator.agent_states["harlow-crossing"]
        ]
        await orchestrator.run_single_town("harlow-crossing", num_rounds=1)
        second_dir = orchestrator.last_run_dir
        second_shape = [
            (len(agent.opinions), len(agent.memories), len(agent.conversations))
            for agent in orchestrator.agent_states["harlow-crossing"]
        ]
        await orchestrator.run_single_town("millbrook-village", num_rounds=1)
        return first_dir, second_dir, orchestrator.last_run_dir, first_shape, second_shape

    first_dir, second_dir, third_dir, first_shape, second_shape = asyncio.run(run_three())
    assert first_dir and second_dir and third_dir
    assert first_shape == second_shape
    assert all(shape == (1, 2, 0) for shape in second_shape)

    summaries = [
        json.loads((run_dir / "summary.json").read_text(encoding="utf-8"))
        for run_dir in (first_dir, second_dir, third_dir)
    ]
    event_docs = [
        json.loads((run_dir / "events.json").read_text(encoding="utf-8"))
        for run_dir in (first_dir, second_dir, third_dir)
    ]

    assert [summary["usage"]["total_calls"] for summary in summaries] == [4, 4, 4]
    assert provider.get_usage_report()["total_calls"] == 12
    assert summaries[0]["counts"]["towns"] == 1
    assert summaries[1]["counts"]["towns"] == 1
    assert summaries[2]["counts"]["towns"] == 1
    assert summaries[2]["counts"]["agents"] == 4
    assert summaries[2]["counts"]["conversations"] == 0
    assert set(orchestrator.town_summaries) == {"millbrook-village"}

    for event_doc in event_docs:
        types = [event["type"] for event in event_doc["events"]]
        assert types.count("simulation_started") == 1
        assert types.count("simulation_ended") == 1
        assert event_doc["responsible_use"] == scenario.responsible_use.model_dump()
    assert len(event_docs[0]["events"]) == len(event_docs[1]["events"])

    latest_recap = (third_dir / "recap.md").read_text(encoding="utf-8")
    assert latest_recap.startswith("# ")
    assert scenario.responsible_use.core_notice in latest_recap
    assert summaries[2]["responsible_use"] == scenario.responsible_use.model_dump()


def test_event_bus_full_recording_and_dead_socket_cleanup_are_race_safe():
    bus = EventBus()

    async def exercise_recording():
        token = bus.start_recording()
        count = bus.EVENT_LOG_LIMIT + 7
        for sequence in range(count):
            await bus.publish(SimpleNamespace(type="diagnostic", sequence=sequence))
        recording = bus.stop_recording(token)
        return count, recording

    count, recording = asyncio.run(exercise_recording())
    assert len(recording) == count
    assert recording[0].sequence == 0
    assert len(bus.get_event_log()) == bus.EVENT_LOG_LIMIT
    assert bus.get_event_log()[0].sequence == 7

    class DeadSocket:
        def __init__(self):
            self.calls = 0

        async def send_text(self, _message):
            self.calls += 1
            await asyncio.sleep(0)
            raise RuntimeError("closed")

    dead = DeadSocket()
    bus.register_ws(dead)

    async def concurrent_publish():
        await asyncio.gather(
            bus.publish(SimpleNamespace(type="one")),
            bus.publish(SimpleNamespace(type="two")),
        )

    asyncio.run(concurrent_publish())
    bus.unregister_ws(dead)  # double cleanup is intentionally harmless
    assert dead.calls == 1
    assert dead not in bus._ws_connections


def test_slow_websocket_is_bounded_and_does_not_block_healthy_recipient(monkeypatch):
    bus = EventBus()
    monkeypatch.setattr(bus, "WS_SEND_TIMEOUT_SECONDS", 0.02)

    class SlowSocket:
        async def send_text(self, _message):
            await asyncio.Event().wait()

    class HealthySocket:
        def __init__(self):
            self.messages = []

        async def send_text(self, message):
            self.messages.append(json.loads(message))

    async def exercise():
        slow = SlowSocket()
        healthy = HealthySocket()
        bus.register_ws(slow)
        bus.register_ws(healthy)
        await bus.publish(SimpleNamespace(type="bounded", sequence=1))
        # Delivery is intentionally decoupled from publish; wait only for the
        # per-write timeout, never for a replay-sized critical section.
        await asyncio.sleep(bus.WS_SEND_TIMEOUT_SECONDS * 2)
        return slow, healthy

    slow, healthy = asyncio.run(exercise())

    assert slow not in bus._ws_connections
    assert healthy in bus._ws_connections
    assert healthy.messages == [
        {"type": "unknown", "data": "namespace(type='bounded', sequence=1)"}
    ]


def test_slow_late_join_replay_times_out_and_is_evicted(monkeypatch):
    bus = EventBus()
    monkeypatch.setattr(bus, "WS_SEND_TIMEOUT_SECONDS", 0.02)

    class WireEvent:
        type = "simulation_started"

        @staticmethod
        def model_dump():
            return {"type": "simulation_started", "agents": [], "towns": []}

    class SlowSocket:
        async def send_text(self, _message):
            await asyncio.Event().wait()

    async def exercise():
        await bus.publish(WireEvent())
        socket = SlowSocket()
        subscribed = await bus.subscribe_ws(socket)
        return socket, subscribed

    socket, subscribed = asyncio.run(exercise())
    assert subscribed is False
    assert socket not in bus._ws_connections


def test_late_join_replay_is_atomic_with_concurrent_publish():
    bus = EventBus()

    class WireEvent:
        def __init__(self, event_type: str, sequence: int):
            self.type = event_type
            self.sequence = sequence

        def model_dump(self):
            return {"type": self.type, "sequence": self.sequence}

    class PausedSocket:
        def __init__(self):
            self.messages: list[dict] = []
            self.replay_started = asyncio.Event()
            self.resume_replay = asyncio.Event()
            self.live_sent = asyncio.Event()

        async def send_text(self, message):
            self.messages.append(json.loads(message))
            if len(self.messages) == 1:
                self.replay_started.set()
                await self.resume_replay.wait()
            if self.messages[-1].get("sequence") == 12:
                self.live_sent.set()

    async def exercise_subscription_race():
        # Only the latest run is replayable; the previous completed run must
        # disappear as soon as a new simulation_started event is committed.
        await bus.publish(WireEvent("simulation_started", 1))
        await bus.publish(WireEvent("round_started", 2))
        await bus.publish(WireEvent("simulation_ended", 3))
        await bus.publish(WireEvent("simulation_started", 10))
        await bus.publish(WireEvent("round_started", 11))

        socket = PausedSocket()
        subscribe_task = asyncio.create_task(bus.subscribe_ws(socket))
        await socket.replay_started.wait()

        # This commits while replay is paused. It queues behind the replay but
        # the publisher itself must remain independent of socket hydration.
        publish_task = asyncio.create_task(bus.publish(WireEvent("opinion_changed", 12)))
        await asyncio.wait_for(publish_task, timeout=0.05)
        assert not subscribe_task.done()

        socket.resume_replay.set()
        assert await subscribe_task is True
        await asyncio.wait_for(socket.live_sent.wait(), timeout=0.05)
        return socket

    socket = asyncio.run(exercise_subscription_race())
    assert [(message["type"], message["sequence"]) for message in socket.messages] == [
        ("simulation_started", 10),
        ("round_started", 11),
        ("opinion_changed", 12),
    ]
    assert sum(message["sequence"] == 12 for message in socket.messages) == 1


def test_hydration_future_resolves_when_live_backlog_evicts_socket(monkeypatch):
    bus = EventBus()
    monkeypatch.setattr(bus, "WS_LIVE_BACKLOG_LIMIT", 1)

    class WireEvent:
        type = "simulation_started"

        @staticmethod
        def model_dump():
            return {"type": "simulation_started", "agents": [], "towns": []}

    class PausedSocket:
        def __init__(self):
            self.started = asyncio.Event()

        async def send_text(self, _message):
            self.started.set()
            await asyncio.Event().wait()

    async def exercise():
        await bus.publish(WireEvent())
        socket = PausedSocket()
        subscription = asyncio.create_task(bus.subscribe_ws(socket))
        await socket.started.wait()
        # The first live event fills the one-message allowance; the next one
        # evicts while the hydration marker is already in flight.
        await bus.publish(SimpleNamespace(type="one"))
        await bus.publish(SimpleNamespace(type="two"))
        await bus.publish(SimpleNamespace(type="three"))
        assert await asyncio.wait_for(subscription, timeout=0.05) is False
        return socket

    socket = asyncio.run(exercise())
    assert socket not in bus._ws_connections


def test_operation_reservation_is_atomic_and_shared_by_replay(runtime):
    orchestrator, _, _, _ = runtime

    with ThreadPoolExecutor(max_workers=12) as pool:
        tokens = list(pool.map(lambda _: orchestrator.try_reserve_operation("replay"), range(24)))
    winners = [token for token in tokens if token is not None]
    assert len(winners) == 1
    assert orchestrator.active_operation == "replay"
    assert orchestrator.try_reserve_operation("simulation") is None
    assert orchestrator.try_reserve_operation("god_view") is None

    orchestrator.release_operation("stale-token")
    assert orchestrator.active_operation == "replay"
    orchestrator.release_operation(winners[0])

    simulation_token = orchestrator.try_reserve_operation("simulation")
    assert simulation_token is not None
    assert orchestrator.is_running is True
    assert orchestrator.try_reserve_operation("replay") is None
    orchestrator.release_operation(simulation_token)
    assert orchestrator.is_running is False
    assert orchestrator.active_operation is None

    god_view_token = orchestrator.try_reserve_operation("god_view")
    assert god_view_token is not None
    assert orchestrator.try_reserve_operation("god_view") is None
    assert orchestrator.try_reserve_operation("simulation") is None
    assert orchestrator.try_reserve_operation("replay") is None
    orchestrator.release_operation(god_view_token)

    with pytest.raises(ValueError, match="at least 1"):
        asyncio.run(orchestrator.run_full_simulation(num_rounds=0))
    assert orchestrator.is_running is False
    assert orchestrator.active_operation is None


def test_start_and_replay_routes_share_the_admission_slot():
    orchestrator = app.state.orchestrator
    replay_token = orchestrator.try_reserve_operation("replay")
    assert replay_token is not None
    try:
        with TestClient(app) as client:
            response = client.post("/api/simulation/start", json={"rounds": 1})
        assert response.status_code == 409
    finally:
        orchestrator.release_operation(replay_token)

    simulation_token = orchestrator.try_reserve_operation("simulation")
    assert simulation_token is not None
    try:
        with TestClient(app) as client:
            response = client.post("/api/simulation/replay", json={"speed": 1000})
        assert response.status_code == 409
    finally:
        orchestrator.release_operation(simulation_token)


def test_god_view_route_shares_simulation_and_replay_admission_slot():
    orchestrator = app.state.orchestrator
    for kind in ("simulation", "replay", "god_view"):
        token = orchestrator.try_reserve_operation(kind)
        assert token is not None
        try:
            with TestClient(app) as client:
                response = client.post(
                    "/api/gods-view",
                    json={"description": "A bounded concurrent development"},
                )
            assert response.status_code == 409
            assert "already running" in response.json()["message"]
        finally:
            orchestrator.release_operation(token)


def test_god_view_holds_external_reservation_and_uses_exact_opinion_snapshots(
    runtime,
    monkeypatch,
):
    orchestrator, provider, bus, scenario = runtime
    agents = [agent for town_agents in orchestrator.agent_states.values() for agent in town_agents]
    stale_history_agent, changed_agent, *unchanged_agents = agents
    option_a, option_b = scenario.option_ids[:2]

    def opinion(candidate: str, confidence: int, round_number: int) -> Opinion:
        return Opinion(
            candidate=candidate,
            confidence=confidence,
            reasoning="Regression fixture",
            top_issues=["local services"],
            round_number=round_number,
        )

    # This resident changed in an earlier simulation, then remains unchanged
    # during the injection. Lifetime-history comparison would misattribute it.
    stale_history_agent.opinions = [
        opinion(option_a, 30, 0),
        opinion(option_b, 55, 1),
    ]
    changed_agent.opinions = [opinion(option_a, 40, 1)]
    for agent in unchanged_agents:
        agent.opinions = [opinion(scenario.undecided_id, 20, 1)]

    def distribution() -> dict[str, int]:
        result = {stance: 0 for stance in scenario.valid_stance_ids}
        for agent in agents:
            result[agent.current_opinion.candidate] += 1
        return result

    expected_before = distribution()
    reservation_observations: list[str] = []

    async def fake_injection(description: str):
        assert description == "A snapshot-sensitive development"
        assert orchestrator.active_operation == "god_view"
        assert orchestrator.try_reserve_operation("simulation") is None
        reservation_observations.append("reaction")
        changed_agent.opinions.append(opinion(option_b, 47, 2))
        return [
            NewsReaction(
                agent_id=changed_agent.agent_id,
                agent_name=changed_agent.definition.name,
                town=changed_agent.definition.town,
                headline=description,
                emotional_response="hopeful",
                impact_on_vote="changes_mind",
                reasoning="The new facts changed my view.",
            )
        ]

    monkeypatch.setattr(orchestrator, "_inject_god_view", fake_injection)
    real_publish = bus.publish

    async def publish_while_reserved(event):
        assert orchestrator.active_operation == "god_view"
        assert orchestrator.try_reserve_operation("replay") is None
        reservation_observations.append("publish")
        await real_publish(event)

    monkeypatch.setattr(bus, "publish", publish_while_reserved)
    real_usage = provider.get_usage_report

    def usage_while_reserved():
        assert orchestrator.active_operation == "god_view"
        assert orchestrator.try_reserve_operation("simulation") is None
        reservation_observations.append("response")
        return real_usage()

    monkeypatch.setattr(provider, "get_usage_report", usage_while_reserved)
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/gods-view",
            "headers": [],
            "app": SimpleNamespace(
                state=SimpleNamespace(
                    orchestrator=orchestrator,
                    event_bus=bus,
                    scenario=scenario,
                    anthropic_client=provider,
                )
            ),
        }
    )

    result = asyncio.run(
        inject_god_view(
            GodViewRequest(description="A snapshot-sensitive development"),
            request,
        )
    )

    assert reservation_observations == ["reaction", "publish", "response"]
    assert orchestrator.active_operation is None
    assert result["opinion_distribution_before"] == expected_before
    assert result["opinion_distribution_after"] == distribution()
    assert result["opinion_shifts"] == [
        {
            "agent": changed_agent.definition.name,
            "town": changed_agent.definition.town,
            "before": option_a,
            "after": option_b,
            "confidence_change": 7,
        }
    ]
    assert stale_history_agent.definition.name not in {
        shift["agent"] for shift in result["opinion_shifts"]
    }


def test_conversation_movement_preserves_origin(runtime, monkeypatch):
    orchestrator, provider, bus, scenario = runtime
    town = "harlow-crossing"
    agent_a, agent_b = orchestrator.agent_states[town][:2]
    origin_a = agent_a.current_location
    origin_b = agent_b.current_location
    destination = scenario.towns[town]["landmarks"][1]["name"]
    manager = RoundManager(provider, bus, scenario)
    monkeypatch.setattr(manager, "_pick_location", lambda _town: destination)

    asyncio.run(manager._run_conversation(agent_a, agent_b, round_num=1))
    moved = [event for event in bus.get_event_log() if event.type == "agent_moved"]
    by_agent = {event.agent_id: event for event in moved}
    assert by_agent[agent_a.agent_id].from_location == origin_a
    assert by_agent[agent_b.agent_id].from_location == origin_b
    assert by_agent[agent_a.agent_id].to_location == destination
    assert by_agent[agent_b.agent_id].to_location == destination


def test_default_cache_path_uses_application_root_and_supports_override(monkeypatch, tmp_path):
    monkeypatch.delenv("TOWNSHIP_CACHE_PATH", raising=False)
    assert DEFAULT_CACHE_PATH == APPLICATION_ROOT / "data" / "simulation_cache.json"
    assert REPLAY_ROOT == APPLICATION_ROOT
    assert SimulationOrchestrator._default_cache_path() == DEFAULT_CACHE_PATH

    monkeypatch.setenv("TOWNSHIP_CACHE_PATH", "var/township-cache.json")
    assert (
        SimulationOrchestrator._default_cache_path()
        == APPLICATION_ROOT / "var" / "township-cache.json"
    )
    absolute = tmp_path / "absolute-cache.json"
    monkeypatch.setenv("TOWNSHIP_CACHE_PATH", str(absolute))
    assert SimulationOrchestrator._default_cache_path() == absolute
