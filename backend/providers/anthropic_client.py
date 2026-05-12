"""
AWS Bedrock client wrapper (Anthropic Claude on Bedrock).

Speaks the native Anthropic Messages API via `anthropic.AsyncAnthropicBedrock`.
Auth uses the Bedrock API-key bearer-token mechanism via the
`AWS_BEARER_TOKEN_BEDROCK` environment variable, with SigV4 fallback through
the standard AWS credential chain when the bearer token is absent.

The public interface (`AnthropicClient.call_agent`, `.get_usage_report`,
`.reset_usage`) is preserved exactly so every caller (round_manager,
orchestrator, chat/gods_view routes) works unchanged.
"""

import asyncio
import logging
import os
from typing import Optional

from anthropic import AsyncAnthropicBedrock

logger = logging.getLogger(__name__)

# Default Bedrock model — Anthropic Claude Sonnet 4.5 via cross-region
# inference profile. Overridable via the BEDROCK_MODEL_ID env var.
DEFAULT_BEDROCK_MODEL = "us.anthropic.claude-sonnet-4-5-20250929-v1:0"

# Cost per million tokens (USD) — Bedrock pricing mirrors Anthropic API for
# Claude Sonnet 4.5. Cache-read / cache-write entries are used when prompt
# caching kicks in. Source: AWS Bedrock pricing page (2025-10).
MODEL_COSTS = {
    "us.anthropic.claude-sonnet-4-5-20250929-v1:0": {
        "input": 3.00,
        "output": 15.00,
        "cache_write_5m": 3.75,
        "cache_read": 0.30,
    },
    "us.anthropic.claude-opus-4-1-20250805-v1:0": {
        "input": 15.00,
        "output": 75.00,
        "cache_write_5m": 18.75,
        "cache_read": 1.50,
    },
    "us.anthropic.claude-haiku-4-5-20251001-v1:0": {
        "input": 1.00,
        "output": 5.00,
        "cache_write_5m": 1.25,
        "cache_read": 0.10,
    },
}

# Map every logical model id that personas / callers might pass to a real
# Bedrock model id. Legacy Azure deployment names and Anthropic API ids both
# resolve to Sonnet 4.5 on Bedrock so we never break a persona by switching
# providers.
MODEL_MAP = {
    # Bedrock IDs pass through unchanged
    "us.anthropic.claude-sonnet-4-5-20250929-v1:0": "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    "us.anthropic.claude-opus-4-1-20250805-v1:0": "us.anthropic.claude-opus-4-1-20250805-v1:0",
    "us.anthropic.claude-haiku-4-5-20251001-v1:0": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    # Logical shorthand
    "claude-sonnet-4-5": "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    "claude-opus-4-1": "us.anthropic.claude-opus-4-1-20250805-v1:0",
    "claude-haiku-4-5": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    # Legacy Anthropic API ids
    "claude-sonnet-4-6": "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    "claude-sonnet-4-20250514": "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    "claude-haiku-3-5": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    "claude-opus-4-7": "us.anthropic.claude-opus-4-1-20250805-v1:0",
    # Legacy Azure OpenAI deployment names — back-compat with any caller that
    # still passes them in.
    "gpt-5-mini": "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    "gpt-4o": "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    "gpt-4o-mini": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
}


def _resolve_model(model: str, fallback: str) -> str:
    if model in MODEL_MAP:
        return MODEL_MAP[model]
    if model.startswith("us.anthropic.") or model.startswith("anthropic.") or model.startswith("global.anthropic."):
        return model  # already a Bedrock id
    return fallback


class AnthropicClient:
    """
    AWS Bedrock wrapper exposing the same `call_agent` contract the rest of
    the codebase already uses. Class name kept for backward compatibility.
    """

    def __init__(self, api_key: Optional[str] = None, max_concurrent: int = 10):
        region = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "us-east-2"
        # Bearer-token API key auth (`AWS_BEARER_TOKEN_BEDROCK`) is auto-detected
        # by the Anthropic SDK; SigV4 via boto3's default credential chain is
        # the fallback. The `api_key` arg here is preserved only so the legacy
        # caller signature in `backend/main.py` still type-checks; it is
        # ignored unless an explicit Anthropic API key is also intended.
        self._client = AsyncAnthropicBedrock(aws_region=region)
        self._default_model = os.environ.get("BEDROCK_MODEL_ID", DEFAULT_BEDROCK_MODEL)
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._total_input_tokens = 0
        self._total_output_tokens = 0
        self._total_cache_read_tokens = 0
        self._total_cache_write_tokens = 0
        self._total_cost = 0.0
        self._call_count = 0
        # Optional prompt caching: cache the system block on every call. Saves
        # ~80% of input cost when the same persona is hit many times per round.
        self._cache_system = os.environ.get("BEDROCK_CACHE_SYSTEM", "1") not in ("0", "false", "False", "")
        logger.info(
            "Bedrock client initialised: region=%s model=%s cache_system=%s",
            region, self._default_model, self._cache_system,
        )

    async def call_agent(
        self,
        system_prompt: str,
        messages: list[dict],
        tools: Optional[list[dict]] = None,
        max_tokens: int = 500,
        model: str = DEFAULT_BEDROCK_MODEL,
    ) -> dict:
        """
        Call Bedrock Claude with the Anthropic Messages API.

        Returns a dict with:
        - text: str (text content joined across blocks)
        - tool_use: Optional[dict] with {name, input, id}
        - input_tokens: int
        - output_tokens: int
        - cost: float
        - stop_reason: str
        """
        resolved_model = _resolve_model(model, self._default_model)

        # System block — wrap as Anthropic content list when prompt caching is
        # enabled so a `cache_control` marker can be attached. Plain string is
        # also accepted by the SDK and is cheaper when the persona prompt
        # changes per call.
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

                self._total_input_tokens += input_tokens
                self._total_output_tokens += output_tokens
                self._total_cache_read_tokens += cache_read
                self._total_cache_write_tokens += cache_write
                self._call_count += 1

                # Cost: fresh inputs + outputs + cache reads + cache writes.
                # Bedrock bills `input_tokens` separately from cache fields,
                # so we add them all up explicitly.
                costs = MODEL_COSTS.get(resolved_model, MODEL_COSTS[DEFAULT_BEDROCK_MODEL])
                call_cost = (
                    (input_tokens / 1_000_000) * costs["input"]
                    + (output_tokens / 1_000_000) * costs["output"]
                    + (cache_read / 1_000_000) * costs["cache_read"]
                    + (cache_write / 1_000_000) * costs["cache_write_5m"]
                )
                self._total_cost += call_cost

                # Walk content blocks: collect text + first tool_use.
                text_chunks: list[str] = []
                tool_use_result: Optional[dict] = None
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
                logger.error("Bedrock API error: %s", e)
                return {
                    "text": f"[API Error: {e}]",
                    "tool_use": None,
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "cost": 0.0,
                    "stop_reason": "error",
                }

    def get_usage_report(self) -> dict:
        return {
            "total_input_tokens": self._total_input_tokens,
            "total_output_tokens": self._total_output_tokens,
            "total_cache_read_tokens": self._total_cache_read_tokens,
            "total_cache_write_tokens": self._total_cache_write_tokens,
            "total_tokens": (
                self._total_input_tokens
                + self._total_output_tokens
                + self._total_cache_read_tokens
                + self._total_cache_write_tokens
            ),
            "total_cost": round(self._total_cost, 4),
            "total_calls": self._call_count,
            "default_model": self._default_model,
            "provider": "bedrock",
        }

    def reset_usage(self) -> None:
        self._total_input_tokens = 0
        self._total_output_tokens = 0
        self._total_cache_read_tokens = 0
        self._total_cache_write_tokens = 0
        self._total_cost = 0.0
        self._call_count = 0
