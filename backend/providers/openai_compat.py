"""
OpenAI-compatible provider: one class covering OpenAI, OpenRouter, Ollama,
and LM Studio via `base_url` — anything that speaks the chat-completions
wire format works.

Presets (classmethod factories):
- OpenAICompatProvider.openai()     — api.openai.com, OPENAI_API_KEY,
                                      model OPENAI_MODEL (default gpt-4.1-mini)
- OpenAICompatProvider.openrouter() — openrouter.ai, OPENROUTER_API_KEY,
                                      model OPENROUTER_MODEL
- OpenAICompatProvider.ollama()     — OLLAMA_BASE_URL (default localhost:11434),
                                      model OLLAMA_MODEL (default llama3.1)
- OpenAICompatProvider.lmstudio()   — LMSTUDIO_BASE_URL (default localhost:1234)

The `openai` package is an optional dependency, imported lazily so the
core install stays lean.
"""

import asyncio
import logging
import os

from .base import UsageTracker, lookup_costs
from .translate import (
    anthropic_tools_to_openai,
    flatten_message_content,
    openai_completion_to_result,
)

logger = logging.getLogger(__name__)

# Model ids that only make sense on Anthropic/Bedrock (or legacy Azure
# deployments); when a persona pins one of these, fall back to the
# provider's own default model instead of sending a bogus id.
_FOREIGN_MODEL_PREFIXES = (
    "claude",
    "us.anthropic.",
    "anthropic.",
    "global.anthropic.",
)
_LEGACY_AZURE_MODELS = {"gpt-5-mini"}


class OpenAICompatProvider:
    """Chat-completions provider with the standard `call_agent` contract."""

    def __init__(
        self,
        base_url: str,
        api_key: str | None,
        default_model: str,
        provider_name: str = "openai-compat",
        max_concurrent: int = 10,
    ):
        try:
            from openai import AsyncOpenAI
        except ImportError as e:
            raise ImportError(
                f"The '{provider_name}' provider needs the openai package. "
                "Install it with: pip install 'township[openai]' "
                "(or: pip install openai)."
            ) from e

        self.provider_name = provider_name
        self._client = AsyncOpenAI(
            base_url=base_url,
            # Local servers (Ollama / LM Studio) ignore the key but the SDK
            # requires a non-empty one.
            api_key=api_key or "not-needed",
            timeout=60.0,
            max_retries=2,
        )
        self._default_model = default_model
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._usage = UsageTracker()
        logger.info(
            "%s provider initialised: base_url=%s model=%s",
            provider_name,
            base_url,
            default_model,
        )

    # ── Presets ────────────────────────────────────────────────

    @classmethod
    def openai(cls, max_concurrent: int = 10) -> "OpenAICompatProvider":
        return cls(
            base_url=os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1"),
            api_key=os.environ.get("OPENAI_API_KEY"),
            default_model=os.environ.get("OPENAI_MODEL", "gpt-4.1-mini"),
            provider_name="openai",
            max_concurrent=max_concurrent,
        )

    @classmethod
    def openrouter(cls, max_concurrent: int = 10) -> "OpenAICompatProvider":
        return cls(
            base_url=os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
            api_key=os.environ.get("OPENROUTER_API_KEY"),
            default_model=os.environ.get("OPENROUTER_MODEL", "anthropic/claude-sonnet-4.5"),
            provider_name="openrouter",
            max_concurrent=max_concurrent,
        )

    @classmethod
    def ollama(cls, max_concurrent: int = 10) -> "OpenAICompatProvider":
        return cls(
            base_url=os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434/v1"),
            api_key="ollama",
            default_model=os.environ.get("OLLAMA_MODEL", "llama3.1"),
            provider_name="ollama",
            max_concurrent=max_concurrent,
        )

    @classmethod
    def lmstudio(cls, max_concurrent: int = 10) -> "OpenAICompatProvider":
        return cls(
            base_url=os.environ.get("LMSTUDIO_BASE_URL", "http://localhost:1234/v1"),
            api_key="lm-studio",
            default_model=os.environ.get("LMSTUDIO_MODEL", "local-model"),
            provider_name="lmstudio",
            max_concurrent=max_concurrent,
        )

    # ── Contract ───────────────────────────────────────────────

    def _resolve_model(self, model: str | None) -> str:
        if not model:
            return self._default_model
        if model.startswith(_FOREIGN_MODEL_PREFIXES) or model in _LEGACY_AZURE_MODELS:
            return self._default_model
        return model

    async def call_agent(
        self,
        system_prompt: str,
        messages: list[dict],
        tools: list[dict] | None = None,
        max_tokens: int = 500,
        model: str | None = None,
    ) -> dict:
        resolved_model = self._resolve_model(model)

        # System prompt goes first as a system message; contents are
        # flattened to plain strings (chat completions take no block lists).
        oai_messages: list[dict] = []
        if system_prompt:
            oai_messages.append(
                {"role": "system", "content": flatten_message_content(system_prompt)}
            )
        for m in messages:
            oai_messages.append(
                {
                    "role": m.get("role", "user"),
                    "content": flatten_message_content(m.get("content", "")),
                }
            )

        async with self._semaphore:
            try:
                kwargs: dict = {
                    "model": resolved_model,
                    "max_tokens": max_tokens,
                    "messages": oai_messages,
                }
                if tools:
                    kwargs["tools"] = anthropic_tools_to_openai(tools)
                    kwargs["tool_choice"] = "auto"

                completion = await self._client.chat.completions.create(**kwargs)

                result = openai_completion_to_result(completion)

                # Cost: known models (the `openai` preset's gpt-* catalog)
                # are priced; local / unknown models gracefully cost 0.0.
                costs = lookup_costs(resolved_model)
                call_cost = (result["input_tokens"] / 1_000_000) * costs.get("input", 0.0) + (
                    result["output_tokens"] / 1_000_000
                ) * costs.get("output", 0.0)
                result["cost"] = call_cost

                self._usage.record(
                    input_tokens=result["input_tokens"],
                    output_tokens=result["output_tokens"],
                    cost=call_cost,
                )
                return result

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
        return self._usage.report(provider=self.provider_name, default_model=self._default_model)

    def reset_usage(self) -> None:
        self._usage.reset()
