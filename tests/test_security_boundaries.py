"""Regression tests for public-input and filesystem trust boundaries."""

import asyncio
import json

import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

import backend.main as backend_main
from backend.core.scenario import load_scenario
from backend.main import app
from backend.routes.chat import CHAT_HISTORY_MAX_ITEMS, CHAT_MESSAGE_MAX_CHARS
from backend.routes.gods_view import GOD_VIEW_PROMPT_MAX_CHARS
from backend.routes.tts import TTS_TEXT_MAX_CHARS


def _receive_until_type(socket, event_type: str, *, limit: int = 10_000) -> dict:
    """Read through an optional late-join replay to the requested control event."""
    for _ in range(limit):
        message = socket.receive_json()
        if message.get("type") == event_type:
            return message
    pytest.fail(f"WebSocket did not emit {event_type!r} within {limit} messages")


def test_websocket_rejects_disallowed_browser_origin(monkeypatch):
    monkeypatch.setattr(backend_main, "ALLOWED_ORIGINS", ["https://allowed.example"])

    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect) as exc_info:
            with client.websocket_connect("/ws", headers={"origin": "https://untrusted.example"}):
                pass

    assert exc_info.value.code == 1008


def test_websocket_allows_listed_origin_and_non_browser_clients(monkeypatch):
    monkeypatch.setattr(backend_main, "ALLOWED_ORIGINS", ["https://allowed.example"])

    with TestClient(app) as client:
        with client.websocket_connect(
            "/ws", headers={"origin": "https://allowed.example"}
        ) as socket:
            socket.send_text("ping")
            assert _receive_until_type(socket, "pong") == {"type": "pong"}

        # CLI clients and test harnesses generally omit Origin entirely.
        with client.websocket_connect("/ws") as socket:
            socket.send_text("ping")
            assert _receive_until_type(socket, "pong") == {"type": "pong"}


def test_websocket_allows_same_origin_single_container_host(monkeypatch):
    """The production :8000 frontend may connect without a duplicate CORS entry."""
    monkeypatch.setattr(backend_main, "ALLOWED_ORIGINS", ["http://localhost:5173"])

    with TestClient(app) as client:
        with client.websocket_connect(
            "/ws",
            headers={"host": "localhost:8000", "origin": "http://localhost:8000"},
        ) as socket:
            socket.send_text("ping")
            assert _receive_until_type(socket, "pong") == {"type": "pong"}


def test_http_rejects_cross_origin_mutations_before_route_side_effects(monkeypatch):
    import backend.routes.transcribe as transcribe_route

    called = False

    async def must_not_read(*_args, **_kwargs):
        nonlocal called
        called = True
        raise AssertionError("disallowed request reached the upload reader")

    monkeypatch.setattr(transcribe_route, "_read_upload_limited", must_not_read)
    with TestClient(app) as client:
        response = client.post(
            "/api/transcribe",
            headers={"origin": "https://evil.example"},
            files={"audio": ("attack.webm", b"payload", "audio/webm")},
        )

    assert response.status_code == 403
    assert response.json() == {"error": "origin_not_allowed"}
    assert called is False


def test_http_allows_configured_and_trusted_same_origin_mutations(monkeypatch):
    monkeypatch.setattr(backend_main, "ALLOWED_ORIGINS", ["https://allowed.example"])

    with TestClient(app) as client:
        configured = client.post(
            "/api/chat/no-such-agent",
            headers={"origin": "https://allowed.example"},
            json={"message": "hello"},
        )
        same_origin = client.post(
            "/api/chat/no-such-agent",
            headers={"origin": "http://testserver"},
            json={"message": "hello"},
        )

    assert configured.status_code == 404
    assert same_origin.status_code == 404


def test_http_allows_loopback_origin_on_any_dev_port(monkeypatch):
    """A Vite dev server on ANY localhost port may mutate — the CSRF gate
    exists to stop remote origins, not the user's own machine."""
    monkeypatch.setattr(backend_main, "ALLOWED_ORIGINS", ["http://localhost:5173"])

    with TestClient(app) as client:
        for origin in (
            "http://localhost:5273",
            "http://127.0.0.1:5273",
            "http://[::1]:5273",
            "http://localhost:39999",
        ):
            response = client.post(
                "/api/chat/no-such-agent",
                headers={"origin": origin},
                json={"message": "hello"},
            )
            # 404 = passed the origin gate and reached the route.
            assert response.status_code == 404, origin

        # Remote origins stay blocked even with loopback trusted.
        blocked = client.post(
            "/api/chat/no-such-agent",
            headers={"origin": "https://localhost.evil.example"},
            json={"message": "hello"},
        )
        assert blocked.status_code == 403


def test_websocket_allows_loopback_origin_on_any_dev_port(monkeypatch):
    monkeypatch.setattr(backend_main, "ALLOWED_ORIGINS", ["http://localhost:5173"])

    with TestClient(app) as client:
        with client.websocket_connect(
            "/ws", headers={"origin": "http://localhost:5273"}
        ) as socket:
            socket.send_text("ping")
            assert _receive_until_type(socket, "pong") == {"type": "pong"}


def test_dns_rebinding_host_is_rejected_for_http_and_websocket():
    with TestClient(app) as client:
        http_response = client.post(
            "/api/chat/no-such-agent",
            headers={"host": "attacker.example", "origin": "http://attacker.example"},
            json={"message": "hello"},
        )
        assert http_response.status_code in {400, 403}

        with pytest.raises(WebSocketDisconnect) as exc_info:
            with client.websocket_connect(
                "/ws",
                headers={"host": "attacker.example", "origin": "http://attacker.example"},
            ):
                pass
        assert getattr(exc_info.value, "status_code", None) == 400 or getattr(
            exc_info.value, "code", None
        ) in {1000, 1008, 1006}


def test_chat_message_and_auto_history_are_bounded():
    long_text = "x" * (CHAT_MESSAGE_MAX_CHARS + 1)
    valid_profile = {"name": "Sam", "top_concerns": ["local schools"]}

    with TestClient(app) as client:
        assert (
            client.post("/api/chat/no-such-agent", json={"message": long_text}).status_code == 422
        )
        assert client.post("/api/chat/no-such-agent", json={"message": "   "}).status_code == 422

        too_many = [
            {"role": "user", "content": "A bounded turn"} for _ in range(CHAT_HISTORY_MAX_ITEMS + 1)
        ]
        assert (
            client.post(
                "/api/chat/auto/no-such-agent",
                json={"user_profile": valid_profile, "conversation_history": too_many},
            ).status_code
            == 422
        )
        assert (
            client.post(
                "/api/chat/auto/no-such-agent",
                json={
                    "user_profile": valid_profile,
                    "conversation_history": [{"role": "user", "content": long_text}],
                },
            ).status_code
            == 422
        )
        assert (
            client.post(
                "/api/chat/auto/no-such-agent",
                json={
                    "user_profile": valid_profile,
                    "conversation_history": [{"role": "system", "content": "inject"}],
                },
            ).status_code
            == 422
        )


def test_god_view_prompt_is_nonempty_and_bounded():
    with TestClient(app) as client:
        assert client.post("/api/gods-view", json={"description": "   "}).status_code == 422
        assert (
            client.post(
                "/api/gods-view",
                json={"description": "x" * (GOD_VIEW_PROMPT_MAX_CHARS + 1)},
            ).status_code
            == 422
        )


def test_tts_rejects_unsafe_voice_ids_and_oversized_text():
    with TestClient(app) as client:
        assert (
            client.post(
                "/api/tts", json={"text": "hello", "voice_id": "../other-voice"}
            ).status_code
            == 422
        )
        assert (
            client.post("/api/tts", json={"text": "hello", "voice_id": "voice/other"}).status_code
            == 422
        )
        assert (
            client.post("/api/tts", json={"text": "x" * (TTS_TEXT_MAX_CHARS + 1)}).status_code
            == 422
        )
        assert client.post("/api/tts", json={"text": "  "}).status_code == 422


def test_transcription_rejects_oversized_upload_before_upstream(monkeypatch):
    import backend.routes.transcribe as transcribe_route

    monkeypatch.setenv("OPENAI_API_KEY", "test-key-never-sent")
    monkeypatch.setattr(transcribe_route, "MAX_AUDIO_BYTES", 8)

    with TestClient(app) as client:
        response = client.post(
            "/api/transcribe",
            files={"audio": ("too-large.webm", b"123456789", "audio/webm")},
        )

    assert response.status_code == 413
    assert response.json()["error"] == "audio_too_large"


def test_transcription_unknown_size_reads_only_limit_plus_one():
    from backend.routes.transcribe import _read_upload_limited

    class UnknownSizeUpload:
        size = None

        def __init__(self, payload: bytes):
            self.payload = payload
            self.offset = 0
            self.bytes_read = 0

        async def read(self, size: int) -> bytes:
            chunk = self.payload[self.offset : self.offset + size]
            self.offset += len(chunk)
            self.bytes_read += len(chunk)
            return chunk

    upload = UnknownSizeUpload(b"x" * 100)
    result = asyncio.run(_read_upload_limited(upload, 8))  # type: ignore[arg-type]

    assert result is None
    assert upload.bytes_read == 9


def _write_minimal_scenario(root, data_file: str):
    scenario_dir = root / "bounded-scenario"
    (scenario_dir / "towns").mkdir(parents=True)
    (scenario_dir / "options").mkdir()
    manifest = {
        "id": "bounded-scenario",
        "title": "Bounded scenario",
        "question": "What should happen?",
        "options": [
            {
                "id": "option-a",
                "name": "Option A",
                "label": "Option A",
                "color": "#123456",
                "data_file": data_file,
            }
        ],
        "dates": {"decision_day": "2026-12-01", "prose": "Decision day."},
        "responsible_use": {
            "core_notice": (
                "Township is a simulation, not a poll. Its outputs do not measure "
                "real public opinion and must never be presented as if they do."
            ),
            "residents_notice": "Residents are fictional.",
            "subjects_notice": "Subjects are fictional.",
            "outputs_notice": "Outputs are model artifacts.",
        },
        "context_md": "Context.",
        "context_short_md": "Short context.",
        "round_plan": [{"round": 0, "clock": "08:00", "phases": ["seed"]}],
    }
    (scenario_dir / "scenario.json").write_text(json.dumps(manifest), encoding="utf-8")
    (scenario_dir / "towns" / "town.json").write_text(
        json.dumps(
            {
                "name": "Town",
                "accent_color": "#123456",
                "demographics": {"population": 100},
                "landmarks": [
                    {
                        "name": "Town Hall",
                        "x": 100,
                        "y": 100,
                        "width": 120,
                        "height": 80,
                        "type": "civic",
                        "color": "#654321",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    return scenario_dir


def test_scenario_option_data_file_rejects_parent_traversal(tmp_path):
    scenario_dir = _write_minimal_scenario(tmp_path, "../outside.json")

    with pytest.raises(ValueError, match="within the scenario directory"):
        load_scenario(scenario_dir)


def test_scenario_option_data_file_rejects_symlink_escape(tmp_path):
    scenario_dir = _write_minimal_scenario(tmp_path, "options/linked.json")
    outside = tmp_path / "outside.json"
    outside.write_text("{}", encoding="utf-8")
    (scenario_dir / "options" / "linked.json").symlink_to(outside)

    with pytest.raises(ValueError, match="must (?:stay within|not be a symbolic link)"):
        load_scenario(scenario_dir)
