"""
Provider abstraction core: the LLMProvider protocol, shared usage/cost
tracking, the model-cost catalog, and the common Anthropic-family
implementation shared by the Bedrock and Anthropic API providers.

Every provider speaks the same narrow contract (already duck-typed by
`tests/conftest.py::FakeClient`):

    async call_agent(system_prompt, messages, tools=None,
                     max_tokens=500, model=None) -> dict
        {text, tool_use: {name, input, id} | None, input_tokens,
         output_tokens, cost, stop_reason, [error]}
    get_usage_report() -> dict
    reset_usage() -> None
"""

import asyncio
import logging
import os
from typing import Protocol, runtime_checkable

logger = logging.getLogger(__name__)

# ── Cost catalog ───────────────────────────────────────────────
# USD per million tokens. Anthropic Claude pricing is identical on the
# Anthropic API and AWS Bedrock; cache_write_5m / cache_read apply when
# prompt caching kicks in. OpenAI entries feed the `openai` preset of
# OpenAICompatProvider. Unknown models simply cost 0.0 (local providers).
MODEL_COSTS: dict[str, dict[str, float]] = {
    # Anthropic Claude
    "claude-sonnet-4-5": {
        "input": 3.00,
        "output": 15.00,
        "cache_write_5m": 3.75,
        "cache_read": 0.30,
    },
    "claude-opus-4-1": {
        "input": 15.00,
        "output": 75.00,
        "cache_write_5m": 18.75,
        "cache_read": 1.50,
    },
    "claude-haiku-4-5": {
        "input": 1.00,
        "output": 5.00,
        "cache_write_5m": 1.25,
        "cache_read": 0.10,
    },
    # OpenAI (chat completions)
    "gpt-4.1": {"input": 2.00, "output": 8.00},
    "gpt-4.1-mini": {"input": 0.40, "output": 1.60},
    "gpt-4.1-nano": {"input": 0.10, "output": 0.40},
    "gpt-4o": {"input": 2.50, "output": 10.00},
    "gpt-4o-mini": {"input": 0.15, "output": 0.60},
}

# Full provider-specific ids → canonical cost-catalog keys.
COST_ALIASES: dict[str, str] = {
    # Bedrock inference-profile ids
    "us.anthropic.claude-sonnet-4-5-20250929-v1:0": "claude-sonnet-4-5",
    "us.anthropic.claude-opus-4-1-20250805-v1:0": "claude-opus-4-1",
    "us.anthropic.claude-haiku-4-5-20251001-v1:0": "claude-haiku-4-5",
    "anthropic.claude-sonnet-4-5-20250929-v1:0": "claude-sonnet-4-5",
    "anthropic.claude-opus-4-1-20250805-v1:0": "claude-opus-4-1",
    "anthropic.claude-haiku-4-5-20251001-v1:0": "claude-haiku-4-5",
    # Dated Anthropic API ids
    "claude-sonnet-4-5-20250929": "claude-sonnet-4-5",
    "claude-opus-4-1-20250805": "claude-opus-4-1",
    "claude-haiku-4-5-20251001": "claude-haiku-4-5",
}


def lookup_costs(model_id: str, fallback: str | None = None) -> dict[str, float]:
    """
    Per-million-token pricing for a model id (provider-specific ids are
    aliased to canonical keys). Returns `fallback`'s pricing when unknown,
    or {} when there is no fallback — callers then price the call at 0.0.
    """
    costs = MODEL_COSTS.get(COST_ALIASES.get(model_id, model_id))
    if costs is None and fallback:
        costs = MODEL_COSTS.get(fallback)
    return costs or {}


def env_flag(name: str, default: bool = True) -> bool:
    """Read a boolean env var; '0'/'false'/'' disable, anything else enables."""
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw not in ("0", "false", "False", "")


# ── Contract ───────────────────────────────────────────────────


@runtime_checkable
class LLMProvider(Protocol):
    """The contract every provider (and tests' FakeClient) satisfies."""

    async def call_agent(
        self,
        system_prompt: str,
        messages: list[dict],
        tools: list[dict] | None = None,
        max_tokens: int = 500,
        model: str | None = None,
    ) -> dict:
        """
        Returns a dict with:
        - text: str
        - tool_use: Optional[dict] with {name, input, id}
        - input_tokens: int
        - output_tokens: int
        - cost: float
        - stop_reason: str ("error" adds an `error` key)
        """
        ...

    def get_usage_report(self) -> dict: ...

    def reset_usage(self) -> None: ...


# ── Usage tracking ─────────────────────────────────────────────


class UsageTracker:
    """Token/cost accumulator shared by every provider implementation."""

    def __init__(self) -> None:
        self.reset()

    def record(
        self,
        *,
        input_tokens: int = 0,
        output_tokens: int = 0,
        cache_read_tokens: int = 0,
        cache_write_tokens: int = 0,
        cost: float = 0.0,
    ) -> None:
        self.total_input_tokens += input_tokens
        self.total_output_tokens += output_tokens
        self.total_cache_read_tokens += cache_read_tokens
        self.total_cache_write_tokens += cache_write_tokens
        self.total_cost += cost
        self.call_count += 1

    def report(self, *, provider: str, default_model: str) -> dict:
        return {
            "total_input_tokens": self.total_input_tokens,
            "total_output_tokens": self.total_output_tokens,
            "total_cache_read_tokens": self.total_cache_read_tokens,
            "total_cache_write_tokens": self.total_cache_write_tokens,
            "total_tokens": (
                self.total_input_tokens
                + self.total_output_tokens
                + self.total_cache_read_tokens
                + self.total_cache_write_tokens
            ),
            "total_cost": round(self.total_cost, 4),
            "total_calls": self.call_count,
            "default_model": default_model,
            "provider": provider,
        }

    def reset(self) -> None:
        self.total_input_tokens = 0
        self.total_output_tokens = 0
        self.total_cache_read_tokens = 0
        self.total_cache_write_tokens = 0
        self.total_cost = 0.0
        self.call_count = 0


# ── Shared Anthropic-family implementation ─────────────────────


class _AnthropicFamilyProvider:
    """
    Everything Bedrock and the plain Anthropic API have in common: the
    Anthropic Messages API request/response shape, cache_control prompt
    caching on the system block, concurrency limiting, token accounting,
    and the error-dict contract. Subclasses supply the SDK client, the
    model map, and the native-id prefixes.
    """

    provider_name: str = "anthropic-family"
    MODEL_MAP: dict[str, str] = {}
    NATIVE_PREFIXES: tuple[str, ...] = ()
    # Cost-catalog key used when a resolved model has no pricing entry.
    COST_FALLBACK: str = "claude-sonnet-4-5"

    def __init__(
        self,
        client,
        default_model: str,
        max_concurrent: int = 10,
        cache_system: bool = True,
    ) -> None:
        self._client = client
        self._default_model = default_model
        self._semaphore = asyncio.Semaphore(max_concurrent)
        # Optional prompt caching: cache the system block on every call.
        # Saves ~80% of input cost when the same persona is hit many times
        # per round.
        self._cache_system = cache_system
        self._usage = UsageTracker()

    def _resolve_model(self, model: str | None) -> str:
        if not model:
            return self._default_model
        if model in self.MODEL_MAP:
            return self.MODEL_MAP[model]
        if self.NATIVE_PREFIXES and model.startswith(self.NATIVE_PREFIXES):
            return model  # already a native id for this provider
        return self._default_model

    async def call_agent(
        self,
        system_prompt: str,
        messages: list[dict],
        tools: list[dict] | None = None,
        max_tokens: int = 500,
        model: str | None = None,
    ) -> dict:
        resolved_model = self._resolve_model(model)

        # System block — wrap as an Anthropic content list when prompt
        # caching is enabled so a `cache_control` marker can be attached.
        # A plain string is also accepted by the SDK and is cheaper when
        # the persona prompt changes per call.
        if self._cache_system and system_prompt:
            system_block = [
                {
                    "type": "text",
                    "text": system_prompt,
                    "cache_control": {"type": "ephemeral"},
                }
            ]
        else:
            system_block = system_prompt or ""

        async with self._semaphore:
            try:
                kwargs: dict = {
                    "model": resolved_model,
                    "max_tokens": max_tokens,
                    "system": system_block,
                    "messages": messages,
                }
                if tools:
                    # `tools/schemas.py` already stores tools in Anthropic
                    # format — pass through unchanged.
                    kwargs["tools"] = tools

                response = await self._client.messages.create(**kwargs)

                # Token accounting (with prompt-cache awareness)
                usage = response.usage
                input_tokens = getattr(usage, "input_tokens", 0) or 0
                output_tokens = getattr(usage, "output_tokens", 0) or 0
                cache_read = getattr(usage, "cache_read_input_tokens", 0) or 0
                cache_write = getattr(usage, "cache_creation_input_tokens", 0) or 0

                # Cost: fresh inputs + outputs + cache reads + cache writes
                # are all billed separately, so add them up explicitly.
                costs = lookup_costs(resolved_model, fallback=self.COST_FALLBACK)
                call_cost = (
                    (input_tokens / 1_000_000) * costs.get("input", 0.0)
                    + (output_tokens / 1_000_000) * costs.get("output", 0.0)
                    + (cache_read / 1_000_000) * costs.get("cache_read", 0.0)
                    + (cache_write / 1_000_000) * costs.get("cache_write_5m", 0.0)
                )
                self._usage.record(
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    cache_read_tokens=cache_read,
                    cache_write_tokens=cache_write,
                    cost=call_cost,
                )

                # Walk content blocks: collect text + first tool_use.
                text_chunks: list[str] = []
                tool_use_result: dict | None = None
                for block in response.content or []:
                    btype = getattr(block, "type", None)
                    if btype == "text":
                        text_chunks.append(getattr(block, "text", "") or "")
                    elif btype == "tool_use" and tool_use_result is None:
                        raw_input = getattr(block, "input", {}) or {}
                        tool_use_result = {
                            "name": getattr(block, "name", ""),
                            "input": dict(raw_input) if isinstance(raw_input, dict) else raw_input,
                            "id": getattr(block, "id", ""),
                        }

                stop_reason = getattr(response, "stop_reason", None) or "end_turn"

                return {
                    "text": "".join(text_chunks),
                    "tool_use": tool_use_result,
                    "input_tokens": input_tokens + cache_read + cache_write,
                    "output_tokens": output_tokens,
                    "cost": call_cost,
                    "stop_reason": stop_reason,
                }

            except Exception as e:
                logger.error("%s API error: %s", self.provider_name, e)
                return {
                    "text": f"[API Error: {e}]",
                    "tool_use": None,
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "cost": 0.0,
                    "stop_reason": "error",
                    "error": str(e),
                }

    def get_usage_report(self) -> dict:
        return self._usage.report(
            provider=self.provider_name, default_model=self._default_model
        )

    def reset_usage(self) -> None:
        self._usage.reset()
