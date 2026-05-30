"""
Cross-side WebSocket event contract test.

Reconciles the backend Pydantic event `type` literals against the frontend
TypeScript discriminated union (messages.ts) and the useWebSocket reducer.
This is the single guard that would catch the original §0.1 past-tense drift
or a future rename on either side — and it fails if a structured event the
backend emits has no consumer case on the frontend (e.g. news_reaction).
"""
import os
import typing

from conftest import REPO_ROOT
from backend.core.types import SimulationEvent

MESSAGES_TS = os.path.join(REPO_ROOT, "frontend", "src", "types", "messages.ts")
REDUCER_TS = os.path.join(REPO_ROOT, "frontend", "src", "hooks", "useWebSocket.ts")


def _event_type_strings() -> list[str]:
    out = []
    for model in typing.get_args(SimulationEvent):
        field = model.model_fields.get("type")
        if field is not None and isinstance(field.default, str):
            out.append(field.default)
    return out


def test_every_backend_event_type_is_declared_on_the_frontend():
    msg_src = open(MESSAGES_TS, encoding="utf-8").read()
    missing = [t for t in _event_type_strings() if f'"{t}"' not in msg_src]
    assert not missing, f"event types not declared in messages.ts: {missing}"


def test_reducer_handles_the_user_visible_events():
    reducer_src = open(REDUCER_TS, encoding="utf-8").read()
    # These events drive visible state and MUST have an explicit reducer case
    # (not just the catch-all default that only appends to the events buffer).
    required = [
        "simulation_started", "simulation_ended", "round_started", "round_ended",
        "agent_moved", "opinion_changed", "agent_speech",
        "conversation_started", "conversation_ended",
        "world_clock_tick", "weather_changed", "relationship_update",
        "news_reaction",  # the previously-dropped structured reaction stream
    ]
    missing = [e for e in required if f'case "{e}"' not in reducer_src]
    assert not missing, f"useWebSocket reducer missing cases: {missing}"


def test_no_legacy_snake_case_event_names_leak_to_frontend():
    """Guard against a regression to the original singular snake_case names."""
    msg_src = open(MESSAGES_TS, encoding="utf-8").read()
    legacy = ["agent_move", "speech_bubble", "opinion_change",
              "conversation_start", "round_advance", "news_injection"]
    # These exact tokens, quoted as a type literal, must not reappear.
    leaked = [name for name in legacy if f'"{name}"' in msg_src]
    assert not leaked, f"legacy event names leaked back into messages.ts: {leaked}"
