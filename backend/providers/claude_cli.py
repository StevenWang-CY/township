"""
Claude through the local `claude` CLI (Claude Code): the user's Claude
subscription instead of an API key.

Every `call_agent` runs one non-interactive `claude -p` process. The system
prompt travels on `--system-prompt`, the conversation on stdin, and when the
engine offers tools the chosen tool's input schema goes on `--json-schema`,
so the CLI's `structured_output` *is* the tool call. The CLI's own tools are
disabled (`--tools ""`), nothing is persisted (`--no-session-persistence`),
and the single JSON result envelope is parsed back into the provider
contract (`backend/providers/base.py`).

Env vars (none of them secrets; the CLI holds the subscription login):
- CLAUDE_CLI_MODEL           full model id (default claude-sonnet-5). Always a
                             full id: the `sonnet` alias resolves to an older
                             Sonnet on some CLI builds and adds a Haiku side call.
- CLAUDE_CLI_BIN             path to the binary (default: `claude` on PATH)
- CLAUDE_CLI_FALLBACK_MODEL  optional `--fallback-model` (unset by default)
- CLAUDE_CLI_LIMIT_PAUSE_S   pause between attempts after a usage/rate-limit
                             message (default 300)
- CLAUDE_CLI_LIMIT_RETRIES   attempts after a usage/rate limit (default 6)
- LLM_MAX_CONCURRENT         the factory caps concurrent CLI processes at this
                             value, default 4 (see factory._cli_concurrency)

Per-call `model` follows the other Anthropic-family providers: a full
`claude-*` id is passed through, a known Bedrock/dated id maps to its plain
id, anything else (aliases, foreign ids, None) uses the configured default.
`max_tokens` has no CLI flag and is ignored.

Nested sessions: Claude Code exports CLAUDECODE=1 and CLAUDE_CODE_ENTRYPOINT
into the shells it spawns. Claude Code 2.0.70 was probed (2026-09-22) to run
`claude -p` normally with both set, so stripping them is precautionary: it
keeps a future build that refuses nested sessions from breaking a run
launched from inside Claude Code.

Billing: `cost` is always 0.0 (subscription). The CLI's `total_cost_usd`,
what the same calls would have cost on the API, is summed separately and
reported as `equivalent_cost_usd`.
"""

import asyncio
import json
import logging
import os
import re
import shutil
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from .base import COST_ALIASES, UsageTracker

logger = logging.getLogger(__name__)

DEFAULT_CLAUDE_CLI_MODEL = "claude-sonnet-5"
DEFAULT_MAX_CONCURRENT = 4
DEFAULT_TIMEOUT_S = 180.0
DEFAULT_LIMIT_PAUSE_S = 300.0
DEFAULT_LIMIT_RETRIES = 6
# Transient failures (bad exit, non-JSON stdout, is_error, timeout) retry
# after these delays: three retries, then the call reports an error.
BACKOFF_S: tuple[float, ...] = (2.0, 15.0, 60.0)
# Claude Code marks the shells it spawns; the child never sees these.
NESTED_SESSION_VARS: tuple[str, ...] = ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT")

# Usage-limit / rate-limit wording in `result` or stderr, matched on whole
# words after folding `_`/`-` to spaces ("rate_limit_error", "overloaded_error").
# A bare "rate" is deliberately not a marker: it would match "generate".
_LIMIT_RE = re.compile(r"\b(?:limit(?:s|ed)?|rate ?limit\w*|overloaded|capacity)\b")
_ERROR_CLIP = 500

Runner = Callable[[list[str], bytes, dict[str, str]], Awaitable[tuple[int, bytes, bytes]]]
Sleep = Callable[[float], Awaitable[Any]]

# Module-level alias so tests can substitute a fake process without spawning.
_create_subprocess_exec = asyncio.create_subprocess_exec


class CLIAttemptError(Exception):
    """One failed CLI attempt. Internal: `call_agent` never lets it escape."""

    def __init__(self, message: str, *, limit: bool = False, fatal: bool = False) -> None:
        super().__init__(message)
        self.message = message
        self.limit = limit  # usage/rate limit: pause instead of backing off
        self.fatal = fatal  # retrying cannot help (binary missing)


# ── Pure helpers (unit-tested directly) ─────────────────────────


def looks_like_limit(text: str) -> bool:
    """True when an error message reads like a usage or rate limit."""
    normalized = re.sub(r"[_\-]+", " ", (text or "").lower())
    return bool(_LIMIT_RE.search(normalized))


def _compact_json(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def _clip(text: str, limit: int = _ERROR_CLIP) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _env_number(name: str, default: float) -> float:
    raw = (os.environ.get(name) or "").strip()
    try:
        value = float(raw) if raw else default
    except ValueError:
        return default
    return value if value >= 0 else default


def resolve_binary(binary: str | None = None) -> str:
    """The claude executable: explicit arg, CLAUDE_CLI_BIN, or PATH lookup."""
    candidate = binary or os.environ.get("CLAUDE_CLI_BIN") or "claude"
    if os.sep in candidate:
        return candidate  # explicit path: used as given, checked when spawned
    found = shutil.which(candidate)
    if not found:
        raise RuntimeError(
            "The claude CLI was not found on PATH. Install Claude Code and log in, "
            "set CLAUDE_CLI_BIN to the binary, or pick another provider via "
            "LLM_PROVIDER (anthropic|bedrock|openai|openrouter|ollama|lmstudio|mock)."
        )
    return found


def render_transcript(messages: list[dict]) -> str:
    """
    Flatten Anthropic-style messages into the stdin prompt, deterministically.

    One message: its content verbatim (text blocks joined by newlines).
    Several: a "Conversation so far:" transcript with one `User:` /
    `Assistant:` line per message, tool calls and tool results rendered as
    bracketed text, ending with the final turn.
    """
    turns = [m for m in (messages or []) if isinstance(m, dict)]
    if not turns:
        return ""
    tool_names: dict[str, str] = {}
    if len(turns) == 1:
        return _content_to_text(turns[0].get("content"), tool_names)
    lines = ["Conversation so far:"]
    for turn in turns:
        label = "Assistant" if turn.get("role") == "assistant" else "User"
        lines.append(f"{label}: {_content_to_text(turn.get('content'), tool_names)}")
    return "\n".join(lines)


def _content_to_text(content: Any, tool_names: dict[str, str]) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return str(content)
    parts: list[str] = []
    for block in content:
        if not isinstance(block, dict):
            parts.append(str(block))
            continue
        btype = block.get("type")
        if btype == "text":
            parts.append(str(block.get("text", "")))
        elif btype == "tool_use":
            name = str(block.get("name") or "tool")
            if block.get("id"):
                tool_names[str(block["id"])] = name
            parts.append(f"[Called {name}: {_compact_json(block.get('input', {}))}]")
        elif btype == "tool_result":
            name = tool_names.get(str(block.get("tool_use_id", "")))
            label = f"Result of {name}" if name else "Tool result"
            parts.append(f"[{label}]: {_content_to_text(block.get('content'), tool_names)}")
        else:
            parts.append(f"[{btype or 'block'}]")
    return "\n".join(parts)


def build_output_schema(tools: list[dict] | None) -> tuple[dict | None, list[str]]:
    """
    The `--json-schema` for a tool list, plus the tool names in order.

    One tool: its input schema as-is. Several: a one-of wrapper
    {tool: enum[names], input: anyOf[schemas]} that `unwrap_structured`
    reverses. No tools: (None, []).
    """
    tools = [t for t in (tools or []) if isinstance(t, dict)]
    if not tools:
        return None, []
    names = [str(t.get("name", "")) for t in tools]
    schemas = [dict(t.get("input_schema") or {"type": "object"}) for t in tools]
    if len(tools) == 1:
        return schemas[0], names
    wrapper = {
        "type": "object",
        "properties": {
            "tool": {"type": "string", "enum": names},
            "input": {"anyOf": schemas},
        },
        "required": ["tool", "input"],
        "additionalProperties": False,
    }
    return wrapper, names


def unwrap_structured(structured: Any, names: list[str]) -> tuple[str, dict] | None:
    """(tool name, input) from a structured output, or None when unusable."""
    if not isinstance(structured, dict):
        return None
    if len(names) == 1:
        return names[0], structured
    name = structured.get("tool")
    payload = structured.get("input")
    if name in names and isinstance(payload, dict):
        return str(name), payload
    return None


def parse_result_envelope(stdout: str) -> dict:
    """
    The CLI's JSON result object. Plain `--output-format json` prints one
    object; if several lines arrive, the last `type: "result"` object wins.
    """
    text = (stdout or "").strip()
    if not text:
        raise CLIAttemptError("empty stdout")
    try:
        whole = json.loads(text)
    except ValueError:
        whole = None
    if isinstance(whole, dict):
        return whole
    result: dict | None = None
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            candidate = json.loads(line)
        except ValueError:
            continue
        if isinstance(candidate, dict) and candidate.get("type") == "result":
            result = candidate
    if result is None:
        raise CLIAttemptError(f"non-JSON stdout: {_clip(text, 200)!r}")
    return result


def _json_object_or_none(text: str) -> dict | None:
    stripped = (text or "").strip()
    if not stripped.startswith("{"):
        return None
    try:
        value = json.loads(stripped)
    except ValueError:
        return None
    return value if isinstance(value, dict) else None


# ── Subprocess runner ──────────────────────────────────────────


async def run_claude_process(
    argv: list[str], stdin: bytes, env: dict[str, str]
) -> tuple[int, bytes, bytes]:
    """
    Spawn `argv` directly (never through a shell) and return
    (returncode, stdout, stderr). Cancellation, which is how the provider's
    `asyncio.wait_for` timeout arrives, kills the child before propagating
    so a hung CLI never leaks.
    """
    proc = await _create_subprocess_exec(
        *argv,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
    )
    try:
        stdout, stderr = await proc.communicate(stdin)
    except asyncio.CancelledError:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        await proc.wait()
        raise
    return proc.returncode or 0, stdout, stderr


# ── Provider ───────────────────────────────────────────────────


class ClaudeCLIProvider:
    """Claude via the local `claude` CLI, with the standard `call_agent` contract."""

    provider_name = "claude-cli"
    # Future engine hook (the mock will opt in); the CLI cannot serve priors.
    supports_engine_prior = False

    def __init__(
        self,
        max_concurrent: int = DEFAULT_MAX_CONCURRENT,
        model: str | None = None,
        binary: str | None = None,
        timeout_s: float = DEFAULT_TIMEOUT_S,
        *,
        runner: Runner | None = None,
        sleep: Sleep = asyncio.sleep,
    ) -> None:
        self._binary = resolve_binary(binary)
        self._model = model or os.environ.get("CLAUDE_CLI_MODEL") or DEFAULT_CLAUDE_CLI_MODEL
        self._fallback_model = os.environ.get("CLAUDE_CLI_FALLBACK_MODEL") or None
        self.max_concurrent = max(1, int(max_concurrent))
        self._semaphore = asyncio.Semaphore(self.max_concurrent)
        self._timeout_s = float(timeout_s)
        self._limit_pause_s = _env_number("CLAUDE_CLI_LIMIT_PAUSE_S", DEFAULT_LIMIT_PAUSE_S)
        self._limit_retries = int(_env_number("CLAUDE_CLI_LIMIT_RETRIES", DEFAULT_LIMIT_RETRIES))
        # Injectable for tests: no real process, no real waiting.
        self._runner: Runner = runner or run_claude_process
        self._sleep: Sleep = sleep
        self._usage = UsageTracker()
        self._equivalent_cost_usd = 0.0
        self._calls = 0
        self._errors = 0
        self._pausing = 0
        self._paused_reason: str | None = None
        self._paused_until: datetime | None = None
        logger.info(
            "claude CLI provider initialised: binary=%s model=%s max_concurrent=%d timeout=%gs",
            self._binary,
            self._model,
            self.max_concurrent,
            self._timeout_s,
        )

    # ── Request construction ───────────────────────────────────

    def _resolve_model(self, model: str | None) -> str:
        if not model:
            return self._model
        canonical = COST_ALIASES.get(model, model)
        if canonical.startswith("claude-"):
            return canonical
        return self._model

    def build_argv(
        self, system_prompt: str, *, schema: dict | None, model: str | None = None
    ) -> list[str]:
        """The exact process arguments for one call (a list: never a shell)."""
        argv = [
            self._binary,
            "-p",
            "--output-format",
            "json",
        ]
        if schema is not None:
            argv += ["--json-schema", _compact_json(schema)]
        argv += [
            "--system-prompt",
            system_prompt or "",
            "--tools",
            "",
            "--model",
            model or self._model,
            "--no-session-persistence",
            "--permission-mode",
            "dontAsk",
        ]
        if self._fallback_model:
            argv += ["--fallback-model", self._fallback_model]
        return argv

    @staticmethod
    def child_env() -> dict[str, str]:
        """The parent environment minus Claude Code's nested-session markers."""
        return {k: v for k, v in os.environ.items() if k not in NESTED_SESSION_VARS}

    # ── One attempt ────────────────────────────────────────────

    async def _attempt(self, argv: list[str], stdin: bytes, env: dict[str, str]) -> dict:
        try:
            returncode, stdout, stderr = await asyncio.wait_for(
                self._runner(argv, stdin, env), timeout=self._timeout_s
            )
        except TimeoutError:
            raise CLIAttemptError(f"timed out after {self._timeout_s:g}s") from None
        except FileNotFoundError as e:
            raise CLIAttemptError(f"claude CLI not found: {e}", fatal=True) from None
        except CLIAttemptError:
            raise
        except Exception as e:
            raise CLIAttemptError(f"{type(e).__name__}: {e}") from None

        out = stdout.decode("utf-8", errors="replace")
        err = stderr.decode("utf-8", errors="replace").strip()
        try:
            envelope = parse_result_envelope(out)
        except CLIAttemptError as parse_error:
            if returncode != 0:
                detail = err or out.strip() or "no output"
                raise CLIAttemptError(
                    f"exit {returncode}: {_clip(detail)}", limit=looks_like_limit(detail)
                ) from None
            raise parse_error

        subtype = envelope.get("subtype")
        if envelope.get("is_error") or subtype != "success":
            result_text = str(envelope.get("result") or "").strip()
            detail = " ".join(part for part in (result_text, err) if part) or str(subtype)
            raise CLIAttemptError(
                f"{subtype or 'error'}: {_clip(detail)}", limit=looks_like_limit(detail)
            )
        if returncode != 0:
            detail = err or "no stderr"
            raise CLIAttemptError(
                f"exit {returncode}: {_clip(detail)}", limit=looks_like_limit(detail)
            )
        return envelope

    # ── Retry policy ───────────────────────────────────────────

    async def _call_with_retries(self, argv: list[str], stdin: bytes, env: dict[str, str]) -> dict:
        transient = 0
        limited = 0
        while True:
            try:
                return await self._attempt(argv, stdin, env)
            except CLIAttemptError as failure:
                if failure.fatal:
                    raise
                if failure.limit:
                    if limited >= self._limit_retries:
                        raise
                    limited += 1
                    await self._pause_for_limit(failure.message, limited)
                    continue
                if transient >= len(BACKOFF_S):
                    raise
                delay = BACKOFF_S[transient]
                transient += 1
                logger.warning(
                    "claude CLI call failed (retry %d/%d in %gs): %s",
                    transient,
                    len(BACKOFF_S),
                    delay,
                    failure.message,
                )
                await self._sleep(delay)

    async def _pause_for_limit(self, reason: str, attempt: int) -> None:
        pause = self._limit_pause_s
        self._pausing += 1
        self._paused_reason = reason
        self._paused_until = datetime.now(UTC) + timedelta(seconds=pause)
        logger.warning(
            "claude CLI usage limit (attempt %d/%d) — pausing %gs before retrying: %s",
            attempt,
            self._limit_retries,
            pause,
            reason,
        )
        try:
            await self._sleep(pause)
        finally:
            self._pausing -= 1
            if self._pausing == 0:
                self._paused_reason = None
                self._paused_until = None

    # ── Contract ───────────────────────────────────────────────

    async def call_agent(
        self,
        system_prompt: str,
        messages: list[dict],
        tools: list[dict] | None = None,
        max_tokens: int = 500,
        model: str | None = None,
    ) -> dict:
        self._calls += 1
        schema, tool_names = build_output_schema(tools)
        argv = self.build_argv(system_prompt, schema=schema, model=self._resolve_model(model))
        stdin = render_transcript(messages).encode("utf-8")
        env = self.child_env()

        async with self._semaphore:
            try:
                envelope = await self._call_with_retries(argv, stdin, env)
            except CLIAttemptError as failure:
                return self._error_result(failure.message)
            except Exception as e:  # the engine marks the agent ERROR; never raise
                logger.exception("claude CLI provider: unexpected failure")
                return self._error_result(f"{type(e).__name__}: {e}")

        result = self._success_result(envelope, tool_names)
        if result["stop_reason"] == "error":
            self._errors += 1
            logger.error("claude CLI call failed: %s", result["error"])
        return result

    def _error_result(self, message: str) -> dict:
        self._errors += 1
        logger.error("claude CLI call failed: %s", message)
        return {
            "text": "",
            "tool_use": None,
            "input_tokens": 0,
            "output_tokens": 0,
            "cost": 0.0,
            "stop_reason": "error",
            "error": message,
        }

    def _success_result(self, envelope: dict, tool_names: list[str]) -> dict:
        usage = envelope.get("usage") or {}
        input_tokens = int(usage.get("input_tokens") or 0)
        output_tokens = int(usage.get("output_tokens") or 0)
        cache_read = int(usage.get("cache_read_input_tokens") or 0)
        cache_write = int(usage.get("cache_creation_input_tokens") or 0)
        # Subscription: the call costs nothing; keep the API-equivalent price
        # the CLI reports so a run can still say what it would have cost.
        self._usage.record(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cache_read_tokens=cache_read,
            cache_write_tokens=cache_write,
            cost=0.0,
        )
        try:
            self._equivalent_cost_usd += float(envelope.get("total_cost_usd") or 0.0)
        except (TypeError, ValueError):
            pass

        text = str(envelope.get("result") or "")
        result = {
            "text": text,
            "tool_use": None,
            "input_tokens": input_tokens + cache_read + cache_write,
            "output_tokens": output_tokens,
            "cost": 0.0,
            "stop_reason": "end_turn",
        }
        if not tool_names:
            return result

        structured = envelope.get("structured_output")
        if structured is None:
            structured = _json_object_or_none(text)
        unwrapped = unwrap_structured(structured, tool_names)
        if unwrapped is None:
            return {**result, "text": "", "stop_reason": "error", "error": "no structured output"}
        name, payload = unwrapped
        return {
            **result,
            "tool_use": {"name": name, "input": payload, "id": f"cli-{uuid.uuid4()}"},
            "stop_reason": "tool_use",
        }

    # ── Reporting ──────────────────────────────────────────────

    def status(self) -> dict:
        """Live provider state for the engine/UI: pause, counters."""
        paused = self._pausing > 0
        return {
            "paused": paused,
            "paused_reason": self._paused_reason if paused else None,
            "until": self._paused_until.isoformat() if paused and self._paused_until else None,
            "calls": self._calls,
            "errors": self._errors,
        }

    def get_usage_report(self) -> dict:
        report = self._usage.report(provider=self.provider_name, default_model=self._model)
        report["equivalent_cost_usd"] = round(self._equivalent_cost_usd, 4)
        report["billing"] = "subscription"
        return report

    def reset_usage(self) -> None:
        self._usage.reset()
        self._equivalent_cost_usd = 0.0
        self._calls = 0
        self._errors = 0
