"""
Anthropic API provider (api.anthropic.com).

Same Messages API semantics as the Bedrock provider — including
cache_control prompt caching on the system block — but authenticated with
a plain `ANTHROPIC_API_KEY` and addressed with plain Anthropic model ids
(`claude-sonnet-4-5` etc.). Bedrock-style ids are mapped to their plain
API equivalents so personas written for either provider work unchanged.

Env vars:
- ANTHROPIC_API_KEY       (required)
- ANTHROPIC_MODEL         (default claude-sonnet-4-5)
- ANTHROPIC_CACHE_SYSTEM  (default off; "1" enables experimental caching)
"""

import logging
import os

from anthropic import AsyncAnthropic

from .base import _AnthropicFamilyProvider, env_flag

logger = logging.getLogger(__name__)

DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5"

# Bedrock-style and legacy ids → plain Anthropic API ids. Native
# `claude-*` ids (claude-sonnet-4-5, claude-sonnet-4-6, claude-opus-4-7,
# dated snapshots, ...) pass through via the prefix check.
MODEL_MAP = {
    # Bedrock inference-profile ids
    "us.anthropic.claude-sonnet-4-5-20250929-v1:0": "claude-sonnet-4-5",
    "us.anthropic.claude-opus-4-1-20250805-v1:0": "claude-opus-4-1",
    "us.anthropic.claude-haiku-4-5-20251001-v1:0": "claude-haiku-4-5",
    "anthropic.claude-sonnet-4-5-20250929-v1:0": "claude-sonnet-4-5",
    "anthropic.claude-opus-4-1-20250805-v1:0": "claude-opus-4-1",
    "anthropic.claude-haiku-4-5-20251001-v1:0": "claude-haiku-4-5",
    # Retired Anthropic ids → current equivalents
    "claude-haiku-3-5": "claude-haiku-4-5",
    # Legacy Azure OpenAI deployment names
    "gpt-5-mini": "claude-sonnet-4-5",
    "gpt-4o": "claude-sonnet-4-5",
    "gpt-4o-mini": "claude-haiku-4-5",
}


class AnthropicProvider(_AnthropicFamilyProvider):
    """Direct Anthropic API provider with the standard `call_agent` contract."""

    provider_name = "anthropic"
    MODEL_MAP = MODEL_MAP
    NATIVE_PREFIXES = ("claude-",)

    def __init__(self, api_key: str | None = None, max_concurrent: int = 10):
        key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            raise RuntimeError(
                "ANTHROPIC_API_KEY is not set — it is required for the "
                "anthropic provider. Export it, or pick another provider "
                "via LLM_PROVIDER (bedrock|openai|openrouter|ollama|lmstudio|mock)."
            )
        client = AsyncAnthropic(api_key=key, timeout=60.0, max_retries=2)
        default_model = os.environ.get("ANTHROPIC_MODEL", DEFAULT_ANTHROPIC_MODEL)
        cache_system = env_flag("ANTHROPIC_CACHE_SYSTEM", default=False)
        super().__init__(
            client,
            default_model=default_model,
            max_concurrent=max_concurrent,
            cache_system=cache_system,
        )
        logger.info(
            "Anthropic API provider initialised: model=%s cache_system=%s",
            default_model,
            cache_system,
        )
