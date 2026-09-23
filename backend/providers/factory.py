"""
Provider selection.

`create_provider()` reads LLM_PROVIDER (bedrock|anthropic|claude-cli|openai|
openrouter|ollama|lmstudio|mock). When unset it auto-detects: an API key
first, then the `claude` CLI on PATH (your Claude subscription), and falls
back to the deterministic mock provider — loudly — so a fresh clone with
zero keys still runs end to end.
"""

import logging
import os
import shutil

from .anthropic_api import AnthropicProvider
from .base import LLMProvider, env_flag
from .bedrock import BedrockProvider
from .claude_cli import DEFAULT_CLAUDE_CLI_MODEL, ClaudeCLIProvider
from .claude_cli import DEFAULT_MAX_CONCURRENT as CLI_DEFAULT_CONCURRENT
from .mock import MockProvider
from .openai_compat import OpenAICompatProvider

logger = logging.getLogger(__name__)

PROVIDER_NAMES = (
    "bedrock",
    "anthropic",
    "claude-cli",
    "openai",
    "openrouter",
    "ollama",
    "lmstudio",
    "mock",
)

MOCK_FALLBACK_MESSAGE = (
    "No LLM credentials found — running with the deterministic mock provider. "
    "Conversations are canned. Set ANTHROPIC_API_KEY / AWS_BEARER_TOKEN_BEDROCK "
    "/ OPENAI_API_KEY, install the claude CLI (LLM_PROVIDER=claude-cli), or set "
    "LLM_PROVIDER to change this."
)

CLI_AUTODETECT_MESSAGE = (
    "No API key found — using your Claude subscription through the claude CLI "
    "(model %s). Set LLM_PROVIDER=mock for the deterministic engine."
)

# Indirection so the test suite can hide `claude` from the factory alone
# (tests/conftest.py) without touching PATH lookups anywhere else.
_which = shutil.which


def _cli_concurrency(max_concurrent: int) -> int:
    """
    Concurrent `claude` processes: LLM_MAX_CONCURRENT when set, else 4, never
    above the cap the app asked for. One subscription should not fan out ten
    CLI processes by default the way an API key can.
    """
    raw = (os.environ.get("LLM_MAX_CONCURRENT") or "").strip()
    cli_cap = int(raw) if raw.isdigit() and int(raw) > 0 else CLI_DEFAULT_CONCURRENT
    return min(max_concurrent, cli_cap)


def _create_named(name: str, max_concurrent: int) -> LLMProvider:
    if name == "bedrock":
        return BedrockProvider(max_concurrent=max_concurrent)
    if name == "anthropic":
        return AnthropicProvider(max_concurrent=max_concurrent)
    if name == "claude-cli":
        return ClaudeCLIProvider(max_concurrent=_cli_concurrency(max_concurrent))
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
    raise ValueError(f"Unknown LLM_PROVIDER {name!r} — valid values: {', '.join(PROVIDER_NAMES)}")


def create_provider(max_concurrent: int = 10) -> LLMProvider:
    """
    Build the LLM provider for this process.

    Explicit LLM_PROVIDER wins; otherwise auto-detect by credential:
    ANTHROPIC_API_KEY → anthropic, AWS_BEARER_TOKEN_BEDROCK → bedrock,
    OPENAI_API_KEY → openai, OPENROUTER_API_KEY → openrouter; with no key,
    a `claude` CLI on PATH → claude-cli (TOWNSHIP_NO_CLI_AUTODETECT=1 skips
    this step; the test suite sets it); else mock.
    """
    env_concurrent = (os.environ.get("LLM_MAX_CONCURRENT") or "").strip()
    if env_concurrent.isdigit() and int(env_concurrent) > 0:
        max_concurrent = int(env_concurrent)

    explicit = (os.environ.get("LLM_PROVIDER") or "").strip().lower()
    if explicit:
        logger.info("LLM_PROVIDER=%s — using the %s provider", explicit, explicit)
        return _create_named(explicit, max_concurrent)

    if os.environ.get("ANTHROPIC_API_KEY"):
        logger.info("Auto-detected ANTHROPIC_API_KEY — using the anthropic provider")
        return AnthropicProvider(max_concurrent=max_concurrent)
    if os.environ.get("AWS_BEARER_TOKEN_BEDROCK"):
        logger.info("Auto-detected AWS_BEARER_TOKEN_BEDROCK — using the bedrock provider")
        return BedrockProvider(max_concurrent=max_concurrent)
    if os.environ.get("OPENAI_API_KEY"):
        logger.info("Auto-detected OPENAI_API_KEY — using the openai provider")
        return OpenAICompatProvider.openai(max_concurrent=max_concurrent)
    if os.environ.get("OPENROUTER_API_KEY"):
        logger.info("Auto-detected OPENROUTER_API_KEY — using the openrouter provider")
        return OpenAICompatProvider.openrouter(max_concurrent=max_concurrent)

    if not env_flag("TOWNSHIP_NO_CLI_AUTODETECT"):
        cli_binary = _which(os.environ.get("CLAUDE_CLI_BIN") or "claude")
        if cli_binary:
            model = os.environ.get("CLAUDE_CLI_MODEL") or DEFAULT_CLAUDE_CLI_MODEL
            logger.warning(CLI_AUTODETECT_MESSAGE, model)
            return ClaudeCLIProvider(
                max_concurrent=_cli_concurrency(max_concurrent), binary=cli_binary
            )

    logger.warning(MOCK_FALLBACK_MESSAGE)
    return MockProvider(max_concurrent=max_concurrent)
