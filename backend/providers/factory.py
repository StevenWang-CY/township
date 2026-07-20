"""
Provider selection.

`create_provider()` reads LLM_PROVIDER (bedrock|anthropic|openai|openrouter|
ollama|lmstudio|mock). When unset it auto-detects from whichever credential
is present, and falls back to the deterministic mock provider — loudly — so
a fresh clone with zero keys still runs end to end.
"""

import logging
import os

from .anthropic_api import AnthropicProvider
from .base import LLMProvider
from .bedrock import BedrockProvider
from .mock import MockProvider
from .openai_compat import OpenAICompatProvider

logger = logging.getLogger(__name__)

PROVIDER_NAMES = (
    "bedrock",
    "anthropic",
    "openai",
    "openrouter",
    "ollama",
    "lmstudio",
    "mock",
)

MOCK_FALLBACK_MESSAGE = (
    "No LLM credentials found — running with the deterministic mock provider. "
    "Conversations are canned. Set ANTHROPIC_API_KEY / AWS_BEARER_TOKEN_BEDROCK "
    "/ OPENAI_API_KEY or LLM_PROVIDER to change this."
)


def _create_named(name: str, max_concurrent: int) -> LLMProvider:
    if name == "bedrock":
        return BedrockProvider(max_concurrent=max_concurrent)
    if name == "anthropic":
        return AnthropicProvider(max_concurrent=max_concurrent)
    if name == "openai":
        return OpenAICompatProvider.openai(max_concurrent=max_concurrent)
    if name == "openrouter":
        return OpenAICompatProvider.openrouter(max_concurrent=max_concurrent)
    if name == "ollama":
        return OpenAICompatProvider.ollama(max_concurrent=max_concurrent)
    if name == "lmstudio":
        return OpenAICompatProvider.lmstudio(max_concurrent=max_concurrent)
    if name == "mock":
        return MockProvider(max_concurrent=max_concurrent)
    raise ValueError(
        f"Unknown LLM_PROVIDER {name!r} — valid values: {', '.join(PROVIDER_NAMES)}"
    )


def create_provider(max_concurrent: int = 10) -> LLMProvider:
    """
    Build the LLM provider for this process.

    Explicit LLM_PROVIDER wins; otherwise auto-detect by credential:
    ANTHROPIC_API_KEY → anthropic, AWS_BEARER_TOKEN_BEDROCK → bedrock,
    OPENAI_API_KEY → openai, OPENROUTER_API_KEY → openrouter, else mock.
    """
    explicit = (os.environ.get("LLM_PROVIDER") or "").strip().lower()
    if explicit:
        logger.info("LLM_PROVIDER=%s — using the %s provider", explicit, explicit)
        return _create_named(explicit, max_concurrent)

    if os.environ.get("ANTHROPIC_API_KEY"):
        logger.info("Auto-detected ANTHROPIC_API_KEY — using the anthropic provider")
        return AnthropicProvider(max_concurrent=max_concurrent)
    if os.environ.get("AWS_BEARER_TOKEN_BEDROCK"):
        logger.info(
            "Auto-detected AWS_BEARER_TOKEN_BEDROCK — using the bedrock provider"
        )
        return BedrockProvider(max_concurrent=max_concurrent)
    if os.environ.get("OPENAI_API_KEY"):
        logger.info("Auto-detected OPENAI_API_KEY — using the openai provider")
        return OpenAICompatProvider.openai(max_concurrent=max_concurrent)
    if os.environ.get("OPENROUTER_API_KEY"):
        logger.info("Auto-detected OPENROUTER_API_KEY — using the openrouter provider")
        return OpenAICompatProvider.openrouter(max_concurrent=max_concurrent)

    logger.warning(MOCK_FALLBACK_MESSAGE)
    return MockProvider(max_concurrent=max_concurrent)
