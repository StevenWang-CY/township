"""Security contract for capability-protected browser-private state."""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import uuid

import pytest
from conftest import FakeClient
from starlette.testclient import TestClient

from backend.core.event_bus import EventBus
from backend.core.types import RelationshipUpdateEvent
from backend.main import app
from backend.routes.chat import _RELATIONSHIPS
from backend.routes.journal import _JOURNAL
from backend.routes.player_state import (
    _CAPABILITY_PATH,
    _PLAYER_CAPABILITIES,
    PLAYER_CAPABILITY_HEADER,
    purge_unbound_private_records,
)
from backend.simulation.replay import replay


def _player_id(label: str) -> str:
    return f"{label}-{uuid.uuid4().hex}"


def _headers(character: str) -> dict[str, str]:
    return {PLAYER_CAPABILITY_HEADER: character * 43}


def _first_agent_id() -> str:
    for town_agents in app.state.orchestrator.get_all_agent_states().values():
        if town_agents:
            return town_agents[0].agent_id
    raise RuntimeError("no agents loaded")


@pytest.fixture()
def isolated_private_state(monkeypatch, tmp_path):
    """Point every private store at one temporary, restartable deployment."""
    import backend.routes.chat as chat_route
    import backend.routes.journal as journal_route
    import backend.routes.player_state as player_state

    original_capabilities = dict(player_state._PLAYER_CAPABILITIES)
    original_relationships = copy.deepcopy(chat_route._RELATIONSHIPS)
    original_journal = copy.deepcopy(journal_route._JOURNAL)

    capability_path = tmp_path / "player_capabilities.json"
    relationship_path = tmp_path / "relationships.json"
    journal_path = tmp_path / "journal.json"
    monkeypatch.setattr(player_state, "_CAPABILITY_PATH", capability_path)
    monkeypatch.setattr(chat_route, "_REL_PATH", relationship_path)
    monkeypatch.setattr(journal_route, "_JOURNAL_PATH", journal_path)
    monkeypatch.setattr(chat_route._rel_saver, "path", relationship_path)
    monkeypatch.setattr(journal_route._journal_saver, "path", journal_path)
    monkeypatch.setattr(chat_route._rel_saver, "_dirty", False)
    monkeypatch.setattr(journal_route._journal_saver, "_dirty", False)
    monkeypatch.setattr(chat_route._rel_saver, "_task", None)
    monkeypatch.setattr(journal_route._journal_saver, "_task", None)
    monkeypatch.setattr(player_state, "_capability_state_valid", True)

    player_state._PLAYER_CAPABILITIES.clear()
    chat_route._RELATIONSHIPS.clear()
    journal_route._JOURNAL.clear()
    try:
        yield {
            "capability_path": capability_path,
            "relationship_path": relationship_path,
            "journal_path": journal_path,
            "chat": chat_route,
            "journal": journal_route,
            "player_state": player_state,
        }
    finally:
        player_state._PLAYER_CAPABILITIES.clear()
        player_state._PLAYER_CAPABILITIES.update(original_capabilities)
        chat_route._RELATIONSHIPS.clear()
        chat_route._RELATIONSHIPS.update(original_relationships)
        journal_route._JOURNAL.clear()
        journal_route._JOURNAL.update(original_journal)


@pytest.mark.parametrize("store", ["relationship", "journal"])
@pytest.mark.parametrize("failure_mode", ["invalid_json", "invalid_schema", "unreadable"])
def test_private_store_load_failures_lock_state_without_overwriting_source(
    isolated_private_state,
    monkeypatch,
    store,
    failure_mode,
):
    """A damaged or unreadable private store is evidence, never an empty store."""
    state = isolated_private_state
    route_module = state["chat"] if store == "relationship" else state["journal"]
    path = state[f"{store}_path"]
    if failure_mode == "invalid_json":
        original = b'{"private-record":'
    elif failure_mode == "invalid_schema":
        original = b'{"private-record":"wrong-shape"}\n'
    else:
        original = b"{}\n"
        monkeypatch.setattr(
            route_module,
            "load_json_strict",
            lambda _path: (_ for _ in ()).throw(PermissionError("simulated unreadable store")),
        )
    path.write_bytes(original)

    endpoint = (
        "/api/chat/relationships/private-state-probe"
        if store == "relationship"
        else "/api/journal/private-state-probe"
    )
    with TestClient(app) as client:
        response = client.get(endpoint, headers=_headers("F"))
        assert response.status_code == 503
        assert response.headers["cache-control"] == "no-store"
        assert state["player_state"].capability_state_is_valid() is False
        assert path.read_bytes() == original
        assert not state["chat"]._RELATIONSHIPS
        assert not state["journal"]._JOURNAL

    assert path.read_bytes() == original


def test_private_mutations_are_durable_before_response_and_survive_immediate_reload(
    isolated_private_state,
):
    """Successful private mutations do not depend on a timer or shutdown flush."""
    state = isolated_private_state
    user_id = _player_id("durable-private")
    capability = "M" * 43
    headers = {PLAYER_CAPABILITY_HEADER: capability}
    agent_id = _first_agent_id()
    original_client = app.state.anthropic_client
    fake = FakeClient(mode="normal")
    app.state.anthropic_client = fake
    app.state.orchestrator.client = fake

    try:
        with TestClient(app) as client:
            chat_response = client.post(
                f"/api/chat/{agent_id}",
                headers=headers,
                json={"message": "Please remember this conversation.", "user_id": user_id},
            )
            assert chat_response.status_code == 200
            journal_response = client.post(
                "/api/journal/entry",
                headers=headers,
                json={
                    "user_id": user_id,
                    "agent_id": agent_id,
                    "transcript": [
                        {"role": "user", "content": "A durable private journal entry"}
                    ],
                },
            )
            assert journal_response.status_code == 200

            capability_doc = json.loads(state["capability_path"].read_text(encoding="utf-8"))
            relationship_doc = json.loads(
                state["relationship_path"].read_text(encoding="utf-8")
            )
            journal_doc = json.loads(state["journal_path"].read_text(encoding="utf-8"))
            assert capability_doc[user_id] == hashlib.sha256(capability.encode("ascii")).hexdigest()
            assert relationship_doc[user_id][agent_id]["encounters"] == 1
            assert journal_doc[user_id][0]["transcript"][0]["content"] == (
                "A durable private journal entry"
            )

            # Simulate an immediate process restart before TestClient shutdown.
            state["player_state"]._PLAYER_CAPABILITIES.clear()
            state["chat"]._RELATIONSHIPS.clear()
            state["journal"]._JOURNAL.clear()
            state["chat"].load_relationship_state()
            state["journal"].load_journal_state()

            relationships = client.get(
                f"/api/chat/relationships/{user_id}", headers=headers
            )
            journal = client.get(f"/api/journal/{user_id}", headers=headers)
            assert relationships.status_code == journal.status_code == 200
            assert relationships.json()["relationships"][agent_id]["encounters"] == 1
            assert journal.json()["entries"][0]["transcript"][0]["content"] == (
                "A durable private journal entry"
            )
    finally:
        app.state.anthropic_client = original_client
        app.state.orchestrator.client = original_client


@pytest.mark.parametrize("store", ["relationship", "journal"])
def test_private_mutation_persistence_failure_returns_503_and_preserves_disk(
    isolated_private_state,
    monkeypatch,
    store,
):
    import backend.core.storage as storage

    state = isolated_private_state
    user_id = _player_id(f"{store}-failure")
    headers = _headers("P")
    agent_id = _first_agent_id()
    original_client = app.state.anthropic_client
    fake = FakeClient(mode="normal")
    app.state.anthropic_client = fake
    app.state.orchestrator.client = fake

    try:
        with TestClient(app) as client:
            if store == "relationship":
                created = client.post(
                    f"/api/chat/{agent_id}",
                    headers=headers,
                    json={"message": "Establish a persisted relationship.", "user_id": user_id},
                )

                def mutation():
                    return client.post(
                        "/api/chat/relationships/reset",
                        headers=headers,
                        json={"user_id": user_id, "agent_id": agent_id},
                    )

                saver = state["chat"]._rel_saver
                path = state["relationship_path"]
            else:
                created = client.post(
                    "/api/journal/entry",
                    headers=headers,
                    json={"user_id": user_id, "agent_id": agent_id, "transcript": []},
                )

                def mutation():
                    return client.delete(f"/api/journal/{user_id}", headers=headers)

                saver = state["journal"]._journal_saver
                path = state["journal_path"]
            assert created.status_code == 200
            before = path.read_bytes()

            def fail_write(*_args, **_kwargs):
                raise OSError("PRIVATE-PERSISTENCE-SENTINEL")

            with monkeypatch.context() as failure_patch:
                failure_patch.setattr(storage, "save_json_atomic", fail_write)
                response = mutation()

            assert response.status_code == 503
            assert response.headers["cache-control"] == "no-store"
            assert "PRIVATE-PERSISTENCE-SENTINEL" not in response.text
            assert path.read_bytes() == before

            # Restore the last durable snapshot and prevent the intentionally
            # failed mutation from being retried by TestClient shutdown.
            saver._dirty = False
            state["chat"].load_relationship_state()
            state["journal"].load_journal_state()
            if store == "relationship":
                assert agent_id in state["chat"]._RELATIONSHIPS[user_id]
            else:
                assert len(state["journal"]._JOURNAL[user_id]) == 1
    finally:
        app.state.anthropic_client = original_client
        app.state.orchestrator.client = original_client


def test_journal_requires_bound_capability_for_reads_writes_and_deletes():
    user_id = _player_id("journal-private")
    correct = _headers("J")
    incorrect = _headers("K")
    entry = {
        "user_id": user_id,
        "agent_id": "resident-1",
        "transcript": [{"role": "user", "content": "A private question"}],
    }

    with TestClient(app) as client:
        missing = client.get(f"/api/journal/{user_id}")
        unknown = client.get(f"/api/journal/{_player_id('unknown')}", headers=incorrect)
        assert missing.status_code == unknown.status_code == 401
        assert missing.json() == unknown.json()
        assert client.post("/api/journal/entry", json=entry).status_code == 401
        assert user_id not in _JOURNAL

        created = client.post("/api/journal/entry", json=entry, headers=correct)
        assert created.status_code == 200

        assert client.get(f"/api/journal/{user_id}", headers=incorrect).status_code == 401
        assert client.delete(f"/api/journal/{user_id}", headers=incorrect).status_code == 401

        loaded = client.get(f"/api/journal/{user_id}", headers=correct)
        assert loaded.status_code == 200
        assert loaded.headers["cache-control"] == "no-store"
        assert loaded.json()["entries"][0]["transcript"][0]["content"] == "A private question"

        cleared = client.delete(f"/api/journal/{user_id}", headers=correct)
        assert cleared.json() == {"status": "ok", "cleared": 1}


def test_capability_registration_preserves_empty_state_ux_without_leaking_secret():
    user_id = _player_id("new-browser")
    capability = "N" * 43
    headers = {PLAYER_CAPABILITY_HEADER: capability}

    with TestClient(app) as client:
        malformed = client.post(
            "/api/chat/relationships/register",
            headers={PLAYER_CAPABILITY_HEADER: "too-short"},
            json={"user_id": user_id},
        )
        assert malformed.status_code == 401

        registered = client.post(
            "/api/chat/relationships/register",
            headers=headers,
            json={"user_id": user_id},
        )
        assert registered.status_code == 200
        assert registered.json() == {"status": "ok"}
        assert registered.headers["cache-control"] == "no-store"
        assert capability not in registered.text

        empty_relationships = client.get(f"/api/chat/relationships/{user_id}", headers=headers)
        empty_journal = client.get(f"/api/journal/{user_id}", headers=headers)
        assert empty_relationships.json()["relationships"] == {}
        assert empty_journal.json()["entries"] == []

        denied_rebind = client.post(
            "/api/chat/relationships/register",
            headers=_headers("O"),
            json={"user_id": user_id},
        )
        assert denied_rebind.status_code == 401


def test_deleting_an_unknown_bound_journal_does_not_insert_a_user():
    user_id = _player_id("journal-delete")
    headers = _headers("D")
    entry = {"user_id": user_id, "agent_id": "resident-1", "transcript": []}

    with TestClient(app) as client:
        assert client.post("/api/journal/entry", json=entry, headers=headers).status_code == 200
        assert client.delete(f"/api/journal/{user_id}", headers=headers).status_code == 200
        assert user_id not in _JOURNAL
        users_before = set(_JOURNAL)

        response = client.delete(f"/api/journal/{user_id}", headers=headers)

        assert response.json() == {"status": "ok", "cleared": 0}
        assert set(_JOURNAL) == users_before
        assert user_id not in _JOURNAL


def test_relationship_updates_are_private_http_state_not_global_events():
    user_id = _player_id("relationship-private")
    capability = "R" * 43
    correct = {PLAYER_CAPABILITY_HEADER: capability}
    incorrect = _headers("S")
    agent_id = _first_agent_id()
    agent = app.state.orchestrator.get_agent_state(agent_id)
    opinions_before = list(agent.opinions)
    memories_before = list(agent.memories)
    original_client = app.state.anthropic_client
    fake = FakeClient(mode="normal")
    app.state.anthropic_client = fake
    app.state.orchestrator.client = fake
    bus = app.state.event_bus
    token = bus.start_recording()

    try:
        with TestClient(app) as client:
            assert client.get(f"/api/chat/relationships/{user_id}").status_code == 401

            response = client.post(
                f"/api/chat/{agent_id}",
                headers=correct,
                json={
                    "message": "PRIVATE-SENTINEL-92f7 how are local services doing?",
                    "user_id": user_id,
                    "user_profile": {"name": "Private Visitor", "town": "dover"},
                },
            )
            assert response.status_code == 200
            assert response.headers["cache-control"] == "no-store"
            relationship = response.json()["relationship"]
            assert relationship["trust"] == 4
            assert relationship["encounters"] == 1

            assert (
                client.get(f"/api/chat/relationships/{user_id}", headers=incorrect).status_code
                == 401
            )
            private_read = client.get(f"/api/chat/relationships/{user_id}", headers=correct)
            assert private_read.status_code == 200
            assert private_read.headers["cache-control"] == "no-store"
            assert private_read.json()["relationships"][agent_id]["trust"] == 4

            denied_reset = client.post(
                "/api/chat/relationships/reset",
                headers=incorrect,
                json={"user_id": user_id, "agent_id": agent_id},
            )
            assert denied_reset.status_code == 401
            assert agent_id in _RELATIONSHIPS[user_id]

        recorded = bus.stop_recording(token)
        token = ""
        assert agent.memories == memories_before
        assert agent.opinions == opinions_before
        assert all(
            getattr(event, "type", None) not in {"relationship_update", "opinion_changed"}
            for event in recorded
        )
        wire = json.dumps(
            [
                event.model_dump() if hasattr(event, "model_dump") else str(event)
                for event in recorded
            ]
        )
        assert user_id not in wire

        # The browser bearer is never returned or persisted in plaintext.
        assert _PLAYER_CAPABILITIES[user_id] != capability
        assert len(_PLAYER_CAPABILITIES[user_id]) == 64
        assert capability not in response.text
        assert capability not in _CAPABILITY_PATH.read_text(encoding="utf-8")
    finally:
        if token:
            bus.stop_recording(token)
        agent.opinions = opinions_before
        agent.memories = memories_before
        app.state.anthropic_client = original_client
        app.state.orchestrator.client = original_client


def test_auto_chat_does_not_copy_private_content_into_public_agent_state():
    user_id = _player_id("auto-private")
    agent_id = _first_agent_id()
    agent = app.state.orchestrator.get_agent_state(agent_id)
    opinions_before = list(agent.opinions)
    memories_before = list(agent.memories)
    original_client = app.state.anthropic_client
    fake = FakeClient(mode="normal")
    app.state.anthropic_client = fake
    app.state.orchestrator.client = fake
    bus = app.state.event_bus
    token = bus.start_recording()

    try:
        with TestClient(app) as client:
            response = client.post(
                f"/api/chat/auto/{agent_id}",
                headers=_headers("U"),
                json={
                    "user_id": user_id,
                    "user_profile": {
                        "name": "PRIVATE-AUTO-SENTINEL-663a",
                        "top_concerns": ["private concern"],
                    },
                    "conversation_history": [],
                },
            )
        recorded = bus.stop_recording(token)
        token = ""

        assert response.status_code == 200
        assert response.json()["opinion_changed"] is False
        assert agent.memories == memories_before
        assert agent.opinions == opinions_before
        assert recorded == []
        assert "FormOpinion" not in [name for call in fake.calls for name in call]
    finally:
        if token:
            bus.stop_recording(token)
        agent.opinions = opinions_before
        agent.memories = memories_before
        app.state.anthropic_client = original_client
        app.state.orchestrator.client = original_client


def test_legacy_replay_drops_private_relationship_events(tmp_path):
    cache_path = tmp_path / "legacy-private-event.json"
    cache_path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "privacy_version": 1,
                "events": [
                    {
                        "type": "relationship_update",
                        "agent_id": "resident-1",
                        "player_id": "legacy-player-id",
                        "trust": 9,
                        "delta": 1,
                        "classification": "curious",
                    },
                    {"type": "world_clock_tick", "hour": 12, "minute": 30},
                ],
            }
        ),
        encoding="utf-8",
    )
    bus = EventBus()

    asyncio.run(replay(bus, str(cache_path), speed=1_000))

    assert [event.type for event in bus.get_event_log()] == ["world_clock_tick"]


def test_event_bus_drops_private_relationship_events_before_every_egress():
    bus = EventBus()
    delivered = []

    async def capture(event):
        delivered.append(event)

    bus.subscribe("*", capture)
    token = bus.start_recording()
    asyncio.run(
        bus.publish(
            RelationshipUpdateEvent(
                agent_id="resident-1",
                player_id="private-player",
                trust=12,
                delta=2,
                classification="curious",
            )
        )
    )

    assert delivered == []
    assert bus.get_event_log() == []
    assert bus.stop_recording(token) == []


def test_upgrade_purges_unbound_legacy_private_records_before_tofu(tmp_path):
    import backend.routes.player_state as player_state

    original_capabilities = dict(_PLAYER_CAPABILITIES)
    original_valid = player_state._capability_state_valid
    try:
        _PLAYER_CAPABILITIES.clear()
        _PLAYER_CAPABILITIES["bound-player"] = hashlib.sha256(b"B" * 43).hexdigest()
        destination = tmp_path / "relationships.json"

        filtered = purge_unbound_private_records(
            {
                "bound-player": {"resident": {"trust": 5}},
                "guessable-legacy-id": {"resident": {"trust": 99}},
            },
            path=destination,
            label="relationship",
        )

        assert filtered == {"bound-player": {"resident": {"trust": 5}}}
        assert json.loads(destination.read_text(encoding="utf-8")) == filtered
        assert "guessable-legacy-id" not in destination.read_text(encoding="utf-8")
        quarantine = tmp_path / "relationships.legacy-unbound.json"
        assert json.loads(quarantine.read_text(encoding="utf-8")) == {
            "guessable-legacy-id": {"resident": {"trust": 99}}
        }
    finally:
        _PLAYER_CAPABILITIES.clear()
        _PLAYER_CAPABILITIES.update(original_capabilities)
        player_state._capability_state_valid = original_valid
