"""
DEPRECATED back-compat shim.

The Bedrock client that used to live here is now
`backend.providers.bedrock.BedrockProvider`; the provider abstraction
(protocol, factory, other backends) lives in `backend.providers`. This
module only keeps stale imports working:

    from backend.providers.anthropic_client import AnthropicClient

New code should use `backend.providers.create_provider()` (or import a
provider class from `backend.providers`) instead.
"""

from .base import MODEL_COSTS  # noqa: F401  (legacy re-export)
from .bedrock import (  # noqa: F401  (legacy re-exports)
    DEFAULT_BEDROCK_MODEL,
    MODEL_MAP,
    BedrockProvider,
)
from .bedrock import (
    BedrockProvider as AnthropicClient,
)

__all__ = [
    "AnthropicClient",
    "BedrockProvider",
    "DEFAULT_BEDROCK_MODEL",
    "MODEL_COSTS",
    "MODEL_MAP",
]
