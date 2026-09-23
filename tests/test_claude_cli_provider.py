"""
claude-cli provider tests: argv construction, prompt rendering, envelope
parsing, retry/backoff, usage-limit pausing, usage accounting, timeouts,
and factory selection.

Everything is offline. The subprocess runner and the backoff sleep are
injected, so no `claude` process is ever spawned and no test ever waits.
"""

import asyncio
import json
import logging
import os

import pytest

from backend.providers import (
    ClaudeCLIProvider,
    LLMProvider,
    MockProvider,
    claude_cli,
    create_provider,
    factory,
)
from backend.providers.anthropic_api import AnthropicProvider
from backend.providers.claude_cli import (
    BACKOFF_S,
    build_output_schema,
    looks_like_limit,
    parse_result_envelope,
    render_transcript,
)

FAKE_BIN = "/opt/fake/claude"
SYSTEM = "You are Carlos Restrepo, a restaurant owner in Dover, NJ."
USER_MSG = [{"role": "user", "content": "What matters most to you this election?"}]

GREET_TOOL = {
    "name": "Greet",
    "description": "Say hello.",
    "input_schema": {
        "type": "object",
        "properties": {
            "greeting": {"type": "string"},
            "mood": {"type": "string", "enum": ["good", "bad"]},
        },
        "required": ["greeting", "mood"],
    },
}
SCORE_TOOL = {
    "name": "Score",
    "description": "Rate it.",
    "input_schema": {
        "type": "object",
        "properties": {"score": {"type": "integer", "minimum": 0, "maximum": 10}},
        "required": ["score"],
    },
}

CLI_ENV_VARS = (
    "CLAUDE_CLI_MODEL",
    "CLAUDE_CLI_BIN",
    "CLAUDE_CLI_FALLBACK_MODEL",
    "CLAUDE_CLI_LIMIT_PAUSE_S",
    "CLAUDE_CLI_LIMIT_RETRIES",
    "LLM_MAX_CONCURRENT",
)
CRED_ENV_VARS = (
    "LLM_PROVIDER",
    "ANTHROPIC_API_KEY",
    "AWS_BEARER_TOKEN_BEDROCK",
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
)


# ── Fixtures and fakes ─────────────────────────────────────────


@pytest.fixture(autouse=True)
def _clean_cli_env(monkeypatch):
    for var in CLI_ENV_VARS:
        monkeypatch.delenv(var, raising=False)


def envelope(**overrides) -> dict:
    """The CLI's `--output-format json` result envelope (shape probed 2026-09-22)."""
    env = {
        "type": "result",
        "subtype": "success",
        "is_error": False,
        "result": "Hello, Dover!",
        "total_cost_usd": 0.0519471,
        "duration_ms": 3553,
        "num_turns": 2,
        "usage": {
            "input_tokens": 4,
            "output_tokens": 92,
            "cache_read_input_tokens": 5157,
            "cache_creation_input_tokens": 5253,
        },
        "session_id": "7bc727cb",
    }
    env.update(overrides)
    return env


def ok(env: dict) -> tuple[int, bytes, bytes]:
    return 0, json.dumps(env).encode(), b""


class ScriptedRunner:
    """Injectable runner: each scripted outcome in turn; the last one repeats.

    An outcome is a (returncode, stdout, stderr) tuple, an exception instance
    to raise, or an async callable whose awaited value is the tuple.
    """

    def __init__(self, *outcomes):
        self.outcomes = list(outcomes)
        self.calls: list[tuple[list[str], bytes, dict[str, str]]] = []

    async def __call__(self, argv, stdin, env):
        self.calls.append((argv, stdin, env))
        outcome = self.outcomes.pop(0) if len(self.outcomes) > 1 else self.outcomes[0]
        if isinstance(outcome, BaseException):
            raise outcome
        if callable(outcome):
            return await outcome()
        return outcome


def recording_sleep(sleeps: list | None, on_sleep=None):
    async def fake_sleep(seconds):
        if sleeps is not None:
            sleeps.append(seconds)
        if on_sleep is not None:
            on_sleep()

    return fake_sleep


def make_provider(runner, sleeps: list | None = None, on_sleep=None, **kwargs) -> ClaudeCLIProvider:
    kwargs.setdefault("binary", FAKE_BIN)
    return ClaudeCLIProvider(runner=runner, sleep=recording_sleep(sleeps, on_sleep), **kwargs)


def run(coro):
    return asyncio.run(coro)


def flag_value(argv: list[str], flag: str) -> str:
    return argv[argv.index(flag) + 1]


# ── argv builder ───────────────────────────────────────────────


def test_argv_flags_with_tool_schema():
    runner = ScriptedRunner(ok(envelope(structured_output={"greeting": "Hi", "mood": "good"})))
    provider = make_provider(runner)
    run(provider.call_agent(SYSTEM, USER_MSG, tools=[GREET_TOOL]))

    ((argv, stdin, _env),) = runner.calls
    assert isinstance(argv, list) and argv[0] == FAKE_BIN  # exec list, never a shell
    assert argv[1:4] == ["-p", "--output-format", "json"]
    assert flag_value(argv, "--json-schema") == json.dumps(
        GREET_TOOL["input_schema"], separators=(",", ":")
    )
    assert flag_value(argv, "--system-prompt") == SYSTEM
    assert flag_value(argv, "--tools") == ""
    assert flag_value(argv, "--model") == "claude-sonnet-5"
    assert "--no-session-persistence" in argv
    assert flag_value(argv, "--permission-mode") == "dontAsk"
    assert "--fallback-model" not in argv
    assert stdin == USER_MSG[0]["content"].encode()


def test_argv_without_tools_has_no_schema():
    runner = ScriptedRunner(ok(envelope()))
    run(make_provider(runner).call_agent(SYSTEM, USER_MSG, tools=None))
    argv = runner.calls[-1][0]
    assert "--json-schema" not in argv
    assert flag_value(argv, "--system-prompt") == SYSTEM

    run(make_provider(runner).call_agent(SYSTEM, USER_MSG, tools=[]))
    assert "--json-schema" not in runner.calls[-1][0]


def test_model_from_env_constructor_and_fallback_flag(monkeypatch):
    monkeypatch.setenv("CLAUDE_CLI_MODEL", "claude-opus-5")
    monkeypatch.setenv("CLAUDE_CLI_FALLBACK_MODEL", "claude-sonnet-5")
    runner = ScriptedRunner(ok(envelope()))
    provider = make_provider(runner)
    run(provider.call_agent(SYSTEM, USER_MSG))
    argv = runner.calls[-1][0]
    assert flag_value(argv, "--model") == "claude-opus-5"
    assert flag_value(argv, "--fallback-model") == "claude-sonnet-5"
    assert provider.get_usage_report()["default_model"] == "claude-opus-5"

    explicit = make_provider(ScriptedRunner(ok(envelope())), model="claude-haiku-4-5")
    assert explicit.get_usage_report()["default_model"] == "claude-haiku-4-5"


@pytest.mark.parametrize(
    ("requested", "expected"),
    [
        (None, "claude-sonnet-5"),
        ("claude-opus-5", "claude-opus-5"),
        ("us.anthropic.claude-sonnet-4-5-20250929-v1:0", "claude-sonnet-4-5"),
        ("sonnet", "claude-sonnet-5"),  # aliases never reach the CLI
        ("gpt-4o", "claude-sonnet-5"),
    ],
)
def test_per_call_model_resolution(requested, expected):
    runner = ScriptedRunner(ok(envelope()))
    run(make_provider(runner).call_agent(SYSTEM, USER_MSG, model=requested))
    assert flag_value(runner.calls[-1][0], "--model") == expected


def test_child_env_strips_nested_session_markers(monkeypatch):
    monkeypatch.setenv("CLAUDECODE", "1")
    monkeypatch.setenv("CLAUDE_CODE_ENTRYPOINT", "cli")
    monkeypatch.setenv("TOWNSHIP_TEST_MARKER", "kept")
    runner = ScriptedRunner(ok(envelope()))
    run(make_provider(runner).call_agent(SYSTEM, USER_MSG))
    env = runner.calls[-1][2]
    assert "CLAUDECODE" not in env
    assert "CLAUDE_CODE_ENTRYPOINT" not in env
    assert env["TOWNSHIP_TEST_MARKER"] == "kept"


# ── Prompt rendering ───────────────────────────────────────────


def test_render_single_message_verbatim():
    text = "Line one.\n\n  Indented line two. "
    assert render_transcript([{"role": "user", "content": text}]) == text


def test_render_single_message_block_list_joins_text_blocks():
    msgs = [
        {"role": "user", "content": [{"type": "text", "text": "A"}, {"type": "text", "text": "B"}]}
    ]
    assert render_transcript(msgs) == "A\nB"


def test_render_multi_turn_transcript():
    msgs = [
        {"role": "user", "content": "Hi there."},
        {"role": "assistant", "content": "Hello! What's on your mind?"},
        {"role": "user", "content": "Property taxes."},
    ]
    expected = (
        "Conversation so far:\n"
        "User: Hi there.\n"
        "Assistant: Hello! What's on your mind?\n"
        "User: Property taxes."
    )
    assert render_transcript(msgs) == expected
    assert render_transcript(msgs) == render_transcript(msgs)


def test_render_tool_use_and_tool_result_blocks():
    msgs = [
        {"role": "user", "content": "Classify this."},
        {
            "role": "assistant",
            "content": [
                {"type": "text", "text": "Sure."},
                {
                    "type": "tool_use",
                    "id": "tu_1",
                    "name": "ClassifyInteraction",
                    "input": {"tone": "curious"},
                },
            ],
        },
        {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": "tu_1",
                    "content": [{"type": "text", "text": "recorded"}],
                },
                {"type": "text", "text": "Thanks. Now say hi."},
            ],
        },
    ]
    assert render_transcript(msgs) == (
        "Conversation so far:\n"
        "User: Classify this.\n"
        'Assistant: Sure.\n[Called ClassifyInteraction: {"tone":"curious"}]\n'
        "User: [Result of ClassifyInteraction]: recorded\nThanks. Now say hi."
    )


def test_render_empty_messages():
    assert render_transcript([]) == ""
    assert render_transcript(None) == ""


# ── Envelope parsing ───────────────────────────────────────────


def test_success_with_structured_output_becomes_tool_use():
    structured = {"greeting": "Hello, Dover!", "mood": "good"}
    runner = ScriptedRunner(ok(envelope(structured_output=structured)))
    result = run(make_provider(runner).call_agent(SYSTEM, USER_MSG, tools=[GREET_TOOL]))

    assert result["stop_reason"] == "tool_use"
    assert result["tool_use"]["name"] == "Greet"
    assert result["tool_use"]["input"] == structured
    assert result["tool_use"]["id"].startswith("cli-")
    assert result["text"] == "Hello, Dover!"
    assert result["cost"] == 0.0
    assert result["input_tokens"] == 4 + 5157 + 5253
    assert result["output_tokens"] == 92
    assert "error" not in result


def test_text_only_call_returns_text():
    runner = ScriptedRunner(ok(envelope(result="Business is steady, gracias.")))
    result = run(make_provider(runner).call_agent(SYSTEM, USER_MSG, tools=None))
    assert result == {
        "text": "Business is steady, gracias.",
        "tool_use": None,
        "input_tokens": 4 + 5157 + 5253,
        "output_tokens": 92,
        "cost": 0.0,
        "stop_reason": "end_turn",
    }


def test_structured_output_missing_but_result_is_json_object():
    payload = {"greeting": "Hey", "mood": "bad"}
    env = envelope(result=json.dumps(payload))
    assert "structured_output" not in env
    result = run(
        make_provider(ScriptedRunner(ok(env))).call_agent(SYSTEM, USER_MSG, tools=[GREET_TOOL])
    )
    assert result["stop_reason"] == "tool_use"
    assert result["tool_use"]["input"] == payload


def test_structured_output_missing_and_prose_is_error_without_retry():
    sleeps: list[float] = []
    provider = make_provider(ScriptedRunner(ok(envelope(result="Just prose."))), sleeps)
    result = run(provider.call_agent(SYSTEM, USER_MSG, tools=[GREET_TOOL]))
    assert result["stop_reason"] == "error"
    assert result["error"] == "no structured output"
    assert result["tool_use"] is None
    assert result["text"] == ""
    assert sleeps == []
    assert provider.status()["errors"] == 1


def test_multiline_stdout_takes_trailing_result_object():
    lines = [
        "some banner text",
        json.dumps({"type": "system", "subtype": "init"}),
        json.dumps({"type": "assistant", "message": {"content": []}}),
        json.dumps(envelope(structured_output={"greeting": "Hi", "mood": "good"})),
    ]
    runner = ScriptedRunner((0, "\n".join(lines).encode(), b""))
    result = run(make_provider(runner).call_agent(SYSTEM, USER_MSG, tools=[GREET_TOOL]))
    assert result["stop_reason"] == "tool_use"
    assert result["tool_use"]["input"] == {"greeting": "Hi", "mood": "good"}


def test_parse_envelope_rejects_non_json_and_empty():
    with pytest.raises(claude_cli.CLIAttemptError, match="non-JSON"):
        parse_result_envelope("Claude Code crashed\nno json here")
    with pytest.raises(claude_cli.CLIAttemptError, match="empty"):
        parse_result_envelope("   ")


def test_non_json_stdout_retries_then_errors():
    sleeps: list[float] = []
    provider = make_provider(ScriptedRunner((0, b"not json at all", b"")), sleeps)
    result = run(provider.call_agent(SYSTEM, USER_MSG))
    assert result["stop_reason"] == "error"
    assert "non-JSON stdout" in result["error"]
    assert sleeps == list(BACKOFF_S)


def test_is_error_envelope_retries_with_backoff_then_errors():
    sleeps: list[float] = []
    failing = ok(envelope(is_error=True, subtype="error_during_execution", result="It broke"))
    provider = make_provider(ScriptedRunner(failing), sleeps)
    result = run(provider.call_agent(SYSTEM, USER_MSG))
    assert result["stop_reason"] == "error"
    assert result["error"] == "error_during_execution: It broke"
    assert sleeps == [2.0, 15.0, 60.0]


def test_bad_subtype_without_is_error_flag_is_still_an_error():
    sleeps: list[float] = []
    env = envelope(subtype="error_max_turns", is_error=False)
    provider = make_provider(ScriptedRunner(ok(env)), sleeps)
    result = run(provider.call_agent(SYSTEM, USER_MSG))
    assert result["stop_reason"] == "error"
    assert result["error"].startswith("error_max_turns")
    assert len(sleeps) == 3


def test_nonzero_exit_reports_stderr():
    sleeps: list[float] = []
    provider = make_provider(ScriptedRunner((1, b"", b"Error: not logged in\n")), sleeps)
    result = run(provider.call_agent(SYSTEM, USER_MSG))
    assert result["stop_reason"] == "error"
    assert result["error"] == "exit 1: Error: not logged in"
    assert sleeps == [2.0, 15.0, 60.0]


# ── Multi-tool one-of wrapper ──────────────────────────────────


def test_single_tool_schema_is_passed_unwrapped():
    schema, names = build_output_schema([GREET_TOOL])
    assert schema == GREET_TOOL["input_schema"]
    assert names == ["Greet"]
    assert build_output_schema(None) == (None, [])
    assert build_output_schema([]) == (None, [])


def test_multi_tool_schema_wraps_and_unwraps():
    schema, names = build_output_schema([GREET_TOOL, SCORE_TOOL])
    assert names == ["Greet", "Score"]
    assert schema["properties"]["tool"] == {"type": "string", "enum": ["Greet", "Score"]}
    assert schema["properties"]["input"]["anyOf"] == [
        GREET_TOOL["input_schema"],
        SCORE_TOOL["input_schema"],
    ]
    assert schema["required"] == ["tool", "input"]

    runner = ScriptedRunner(
        ok(envelope(structured_output={"tool": "Score", "input": {"score": 7}}))
    )
    result = run(make_provider(runner).call_agent(SYSTEM, USER_MSG, tools=[GREET_TOOL, SCORE_TOOL]))
    assert json.loads(flag_value(runner.calls[-1][0], "--json-schema")) == schema
    assert result["stop_reason"] == "tool_use"
    assert result["tool_use"]["name"] == "Score"
    assert result["tool_use"]["input"] == {"score": 7}


def test_multi_tool_unknown_tool_name_is_error():
    runner = ScriptedRunner(ok(envelope(structured_output={"tool": "Nope", "input": {"score": 1}})))
    result = run(make_provider(runner).call_agent(SYSTEM, USER_MSG, tools=[GREET_TOOL, SCORE_TOOL]))
    assert result["stop_reason"] == "error"
    assert result["error"] == "no structured output"


# ── Retry and backoff ──────────────────────────────────────────


def test_retry_backoff_sequence_then_success():
    sleeps: list[float] = []
    runner = ScriptedRunner((1, b"", b"boom"), (0, b"garbage", b""), ok(envelope()))
    provider = make_provider(runner, sleeps)
    result = run(provider.call_agent(SYSTEM, USER_MSG))
    assert result["stop_reason"] == "end_turn"
    assert sleeps == [2.0, 15.0]
    assert len(runner.calls) == 3
    assert provider.status() == {
        "paused": False,
        "paused_reason": None,
        "until": None,
        "calls": 1,
        "errors": 0,
    }


def test_retries_exhausted_returns_last_error_never_raises(caplog):
    sleeps: list[float] = []
    runner = ScriptedRunner(
        (1, b"", b"first"), (1, b"", b"second"), (1, b"", b"third"), (1, b"", b"last")
    )
    provider = make_provider(runner, sleeps)
    with caplog.at_level(logging.WARNING, logger="backend.providers.claude_cli"):
        result = run(provider.call_agent(SYSTEM, USER_MSG))
    assert result == {
        "text": "",
        "tool_use": None,
        "input_tokens": 0,
        "output_tokens": 0,
        "cost": 0.0,
        "stop_reason": "error",
        "error": "exit 1: last",
    }
    assert sleeps == [2.0, 15.0, 60.0]
    assert len(runner.calls) == 4
    assert provider.status()["errors"] == 1
    assert "retry 1/3 in 2s" in caplog.text
    assert "retry 3/3 in 60s" in caplog.text


# ── Usage-limit pause ──────────────────────────────────────────


def test_usage_limit_pauses_then_retries_and_succeeds(caplog):
    sleeps: list[float] = []
    seen: list[dict] = []
    limited = ok(
        envelope(
            is_error=True,
            subtype="error_during_execution",
            result="You've hit your usage limit · resets 3pm",
        )
    )
    success = ok(envelope(structured_output={"greeting": "Hi", "mood": "good"}))
    runner = ScriptedRunner(limited, success)
    provider = make_provider(runner, sleeps, on_sleep=lambda: seen.append(provider.status()))

    with caplog.at_level(logging.WARNING, logger="backend.providers.claude_cli"):
        result = run(provider.call_agent(SYSTEM, USER_MSG, tools=[GREET_TOOL]))

    assert result["stop_reason"] == "tool_use"
    assert sleeps == [300.0]
    assert len(runner.calls) == 2
    (paused,) = seen
    assert paused["paused"] is True
    assert "limit" in paused["paused_reason"]
    assert paused["until"] is not None
    after = provider.status()
    assert after["paused"] is False and after["until"] is None and after["errors"] == 0
    assert "usage limit (attempt 1/6)" in caplog.text
    assert "pausing 300s" in caplog.text


def test_usage_limit_env_knobs_and_exhaustion(monkeypatch):
    monkeypatch.setenv("CLAUDE_CLI_LIMIT_PAUSE_S", "7")
    monkeypatch.setenv("CLAUDE_CLI_LIMIT_RETRIES", "1")
    sleeps: list[float] = []
    runner = ScriptedRunner((1, b"", b"API Error: 429 rate_limit_error"))
    provider = make_provider(runner, sleeps)
    result = run(provider.call_agent(SYSTEM, USER_MSG))
    assert result["stop_reason"] == "error"
    assert "rate_limit_error" in result["error"]
    assert sleeps == [7.0]
    assert len(runner.calls) == 2
    assert provider.status()["errors"] == 1


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("You've hit your usage limit · resets 3pm", True),
        ('API Error: 429 {"type":"rate_limit_error"}', True),
        ("Rate limited, try again later", True),
        ("API Error: 529 overloaded_error", True),
        ("The system is at capacity right now", True),
        ("Failed to generate structured output", False),
        ("Inaccurate schema", False),
        ("", False),
    ],
)
def test_looks_like_limit(text, expected):
    assert looks_like_limit(text) is expected


# ── Usage accounting ───────────────────────────────────────────


def test_usage_accounting_counts_tokens_and_equivalent_cost():
    runner = ScriptedRunner(
        ok(envelope(total_cost_usd=0.05)),
        ok(envelope(total_cost_usd=0.0251, usage={"input_tokens": 10, "output_tokens": 20})),
    )
    provider = make_provider(runner)
    first = run(provider.call_agent(SYSTEM, USER_MSG))
    second = run(provider.call_agent(SYSTEM, USER_MSG))
    assert first["cost"] == 0.0 and second["cost"] == 0.0
    assert second["input_tokens"] == 10 and second["output_tokens"] == 20

    report = provider.get_usage_report()
    assert report["provider"] == "claude-cli"
    assert report["billing"] == "subscription"
    assert report["total_cost"] == 0.0
    assert report["equivalent_cost_usd"] == 0.0751
    assert report["total_calls"] == 2
    assert report["total_input_tokens"] == 14
    assert report["total_output_tokens"] == 112
    assert report["total_cache_read_tokens"] == 5157
    assert report["total_cache_write_tokens"] == 5253
    assert report["total_tokens"] == 14 + 112 + 5157 + 5253
    assert report["default_model"] == "claude-sonnet-5"


def test_reset_usage_clears_everything():
    provider = make_provider(ScriptedRunner(ok(envelope())))
    run(provider.call_agent(SYSTEM, USER_MSG))
    provider.reset_usage()
    report = provider.get_usage_report()
    assert report["total_calls"] == 0
    assert report["equivalent_cost_usd"] == 0.0
    assert provider.status()["calls"] == 0


# ── Timeouts and robustness ────────────────────────────────────


def test_timeout_retries_then_succeeds():
    sleeps: list[float] = []

    async def hang():
        await asyncio.sleep(5)
        return ok(envelope())

    runner = ScriptedRunner(hang, ok(envelope()))
    provider = make_provider(runner, sleeps, timeout_s=0.02)
    result = run(provider.call_agent(SYSTEM, USER_MSG))
    assert result["stop_reason"] == "end_turn"
    assert sleeps == [2.0]
    assert len(runner.calls) == 2


def test_timeout_error_message_after_exhaustion():
    async def hang():
        await asyncio.sleep(5)

    sleeps: list[float] = []
    provider = make_provider(ScriptedRunner(hang), sleeps, timeout_s=0.01)
    result = run(provider.call_agent(SYSTEM, USER_MSG))
    assert result["stop_reason"] == "error"
    assert result["error"] == "timed out after 0.01s"
    assert sleeps == [2.0, 15.0, 60.0]


class FakeProc:
    """Stand-in for an asyncio subprocess: hangs until cancelled, or answers."""

    def __init__(self, stdout: bytes = b"", hang: bool = False):
        self.stdout = stdout
        self.hang = hang
        self.killed = False
        self.returncode = None
        self.stdin_seen = None

    async def communicate(self, input=None):
        self.stdin_seen = input
        if self.hang:
            await asyncio.Event().wait()
        self.returncode = 0
        return self.stdout, b""

    def kill(self):
        self.killed = True
        self.returncode = -9

    async def wait(self):
        return self.returncode


def test_default_runner_kills_hung_process_on_timeout(monkeypatch):
    procs = [FakeProc(hang=True), FakeProc(stdout=json.dumps(envelope()).encode())]
    spawned: list[tuple] = []

    async def fake_exec(*argv, **kwargs):
        spawned.append((argv, kwargs))
        return procs[len(spawned) - 1]

    monkeypatch.setattr(claude_cli, "_create_subprocess_exec", fake_exec)
    monkeypatch.setenv("CLAUDECODE", "1")
    sleeps: list[float] = []
    provider = ClaudeCLIProvider(binary=FAKE_BIN, timeout_s=0.02, sleep=recording_sleep(sleeps))

    result = run(provider.call_agent(SYSTEM, USER_MSG))

    assert result["stop_reason"] == "end_turn"
    assert procs[0].killed is True
    assert procs[1].killed is False
    assert sleeps == [2.0]
    argv, kwargs = spawned[0]
    assert argv[0] == FAKE_BIN
    assert kwargs["stdin"] == asyncio.subprocess.PIPE
    assert kwargs["stdout"] == asyncio.subprocess.PIPE
    assert "CLAUDECODE" not in kwargs["env"]
    assert procs[1].stdin_seen == USER_MSG[0]["content"].encode()


def test_runner_exception_becomes_error_result_after_retries():
    sleeps: list[float] = []
    provider = make_provider(ScriptedRunner(RuntimeError("boom")), sleeps)
    result = run(provider.call_agent(SYSTEM, USER_MSG))
    assert result["stop_reason"] == "error"
    assert result["error"] == "RuntimeError: boom"
    assert sleeps == [2.0, 15.0, 60.0]


def test_missing_binary_at_spawn_is_immediate_error():
    sleeps: list[float] = []
    provider = make_provider(ScriptedRunner(FileNotFoundError(FAKE_BIN)), sleeps)
    result = run(provider.call_agent(SYSTEM, USER_MSG))
    assert result["stop_reason"] == "error"
    assert "not found" in result["error"]
    assert sleeps == []


def test_missing_binary_at_construction_raises(monkeypatch):
    monkeypatch.setattr(claude_cli.shutil, "which", lambda *_a, **_k: None)
    with pytest.raises(RuntimeError, match="claude CLI was not found"):
        ClaudeCLIProvider()


def test_binary_resolution_prefers_arg_then_env_then_path(monkeypatch):
    monkeypatch.setenv("CLAUDE_CLI_BIN", "/opt/env/claude")
    assert claude_cli.resolve_binary("/opt/arg/claude") == "/opt/arg/claude"
    assert claude_cli.resolve_binary() == "/opt/env/claude"
    monkeypatch.delenv("CLAUDE_CLI_BIN")
    monkeypatch.setattr(
        claude_cli.shutil, "which", lambda name, *_a, **_k: f"/usr/local/bin/{name}"
    )
    assert claude_cli.resolve_binary() == "/usr/local/bin/claude"


def test_protocol_and_engine_prior_flag():
    provider = make_provider(ScriptedRunner(ok(envelope())))
    assert isinstance(provider, LLMProvider)
    assert ClaudeCLIProvider.supports_engine_prior is False
    assert provider.max_concurrent == 4


def test_concurrency_is_bounded_by_the_semaphore():
    in_flight = 0
    peak = 0

    async def slow():
        nonlocal in_flight, peak
        in_flight += 1
        peak = max(peak, in_flight)
        await asyncio.sleep(0.005)
        in_flight -= 1
        return ok(envelope())

    provider = make_provider(ScriptedRunner(slow), max_concurrent=2)

    async def fan_out():
        await asyncio.gather(*(provider.call_agent(SYSTEM, USER_MSG) for _ in range(6)))

    run(fan_out())
    assert peak == 2
    assert provider.get_usage_report()["total_calls"] == 6


# ── Factory ────────────────────────────────────────────────────


def _clear_factory_env(monkeypatch):
    for var in CRED_ENV_VARS + CLI_ENV_VARS:
        monkeypatch.delenv(var, raising=False)


def test_provider_names_include_claude_cli():
    assert "claude-cli" in factory.PROVIDER_NAMES


def test_factory_explicit_claude_cli(monkeypatch):
    _clear_factory_env(monkeypatch)
    monkeypatch.setenv("LLM_PROVIDER", "claude-cli")
    monkeypatch.setenv("CLAUDE_CLI_BIN", FAKE_BIN)
    provider = create_provider()
    assert isinstance(provider, ClaudeCLIProvider)
    assert provider.get_usage_report()["provider"] == "claude-cli"
    assert provider.max_concurrent == 4


@pytest.mark.parametrize(
    ("env_value", "expected"),
    [(None, 4), ("", 4), ("8", 8), ("2", 2), ("12", 12)],
)
def test_factory_claude_cli_concurrency(monkeypatch, env_value, expected):
    _clear_factory_env(monkeypatch)
    monkeypatch.setenv("LLM_PROVIDER", "claude-cli")
    monkeypatch.setenv("CLAUDE_CLI_BIN", FAKE_BIN)
    if env_value is not None:
        monkeypatch.setenv("LLM_MAX_CONCURRENT", env_value)
    assert create_provider(max_concurrent=10).max_concurrent == expected


def test_factory_autodetect_picks_cli_when_binary_found(monkeypatch, caplog):
    _clear_factory_env(monkeypatch)
    monkeypatch.delenv("TOWNSHIP_NO_CLI_AUTODETECT", raising=False)
    monkeypatch.setattr(factory, "_which", lambda name: FAKE_BIN if name == "claude" else None)
    with caplog.at_level(logging.WARNING, logger="backend.providers.factory"):
        provider = create_provider()
    assert isinstance(provider, ClaudeCLIProvider)
    assert provider._binary == FAKE_BIN
    assert provider.max_concurrent == 4
    assert "Claude subscription through the claude CLI (model claude-sonnet-5)" in caplog.text


def test_factory_autodetect_looks_up_claude_cli_bin(monkeypatch):
    _clear_factory_env(monkeypatch)
    monkeypatch.delenv("TOWNSHIP_NO_CLI_AUTODETECT", raising=False)
    monkeypatch.setenv("CLAUDE_CLI_BIN", "/opt/custom/claude")
    looked_up: list[str] = []
    monkeypatch.setattr(factory, "_which", lambda name: looked_up.append(name) or name)
    provider = create_provider()
    assert isinstance(provider, ClaudeCLIProvider)
    assert looked_up == ["/opt/custom/claude"]


def test_factory_autodetect_falls_back_to_mock_without_binary(monkeypatch):
    _clear_factory_env(monkeypatch)
    monkeypatch.delenv("TOWNSHIP_NO_CLI_AUTODETECT", raising=False)
    monkeypatch.setattr(factory, "_which", lambda name: None)
    assert isinstance(create_provider(), MockProvider)


def test_factory_autodetect_disabled_by_env(monkeypatch):
    _clear_factory_env(monkeypatch)
    monkeypatch.setenv("TOWNSHIP_NO_CLI_AUTODETECT", "1")
    looked_up: list[str] = []
    monkeypatch.setattr(factory, "_which", lambda name: looked_up.append(name) or FAKE_BIN)
    assert isinstance(create_provider(), MockProvider)
    assert looked_up == []


def test_factory_api_key_beats_cli(monkeypatch):
    _clear_factory_env(monkeypatch)
    monkeypatch.delenv("TOWNSHIP_NO_CLI_AUTODETECT", raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(factory, "_which", lambda name: FAKE_BIN)
    assert isinstance(create_provider(), AnthropicProvider)


def test_suite_conftest_disables_cli_autodetect():
    """Guard: the shared conftest keeps every other test off the real CLI."""
    assert os.environ.get("TOWNSHIP_NO_CLI_AUTODETECT") == "1"
    assert factory._which("claude") is None
