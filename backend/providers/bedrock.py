"""
AWS Bedrock provider (Anthropic Claude on Bedrock).

Speaks the native Anthropic Messages API via `anthropic.AsyncAnthropicBedrock`.
Auth uses the Bedrock API-key bearer-token mechanism via the
`AWS_BEARER_TOKEN_BEDROCK` environment variable, with SigV4 fallback through
the standard AWS credential chain when the bearer token is absent.

Env vars:
- AWS_REGION / AWS_DEFAULT_REGION  (default us-east-2)
- BEDROCK_MODEL_ID                 (default Claude Sonnet 4.5 inference profile)
- BEDROCK_CACHE_SYSTEM             (default on; "0" disables prompt caching)
"""

import logging
import os

from anthropic import AsyncAnthropicBedrock

from .base import _AnthropicFamilyProvider, env_flag

logger = logging.getLogger(__name__)

# Default Bedrock model — Anthropic Claude Sonnet 4.5 via cross-region
# inference profile. Overridable via the BEDROCK_MODEL_ID env var.
DEFAULT_BEDROCK_MODEL = "us.anthropic.claude-sonnet-4-5-20250929-v1:0"

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


class BedrockProvider(_AnthropicFamilyProvider):
    """
    AWS Bedrock provider exposing the standard `call_agent` contract.
    Formerly `AnthropicClient` — that name survives as an alias in
    `backend/providers/anthropic_client.py` for stale imports.
    """

    provider_name = "bedrock"
    MODEL_MAP = MODEL_MAP
    NATIVE_PREFIXES = ("us.anthropic.", "anthropic.", "global.anthropic.")

    def __init__(self, api_key: str | None = None, max_concurrent: int = 10):
        region = (
            os.environ.get("AWS_REGION")
            or os.environ.get("AWS_DEFAULT_REGION")
            or "us-east-2"
        )
        # Bearer-token API key auth (`AWS_BEARER_TOKEN_BEDROCK`) is auto-detected
        # by the Anthropic SDK; SigV4 via boto3's default credential chain is
        # the fallback. The `api_key` arg is preserved only so the legacy
        # caller signature still type-checks; it is ignored.
        client = AsyncAnthropicBedrock(aws_region=region, timeout=60.0, max_retries=2)
        default_model = os.environ.get("BEDROCK_MODEL_ID", DEFAULT_BEDROCK_MODEL)
        cache_system = env_flag("BEDROCK_CACHE_SYSTEM", default=True)
        super().__init__(
            client,
            default_model=default_model,
            max_concurrent=max_concurrent,
            cache_system=cache_system,
        )
        logger.info(
            "Bedrock provider initialised: region=%s model=%s cache_system=%s",
            region, default_model, cache_system,
        )
