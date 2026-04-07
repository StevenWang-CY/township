"""
Azure OpenAI client wrapper.
Maintains the same call_agent() interface as the original Anthropic client
so all callers (round_manager, chat, gods_view) work unchanged.
"""

import asyncio
import json
import logging
import os
from typing import Optional

from openai import AsyncAzureOpenAI

logger = logging.getLogger(__name__)

# Cost per million tokens (USD) — Azure OpenAI pricing
MODEL_COSTS = {
    "gpt-5-mini": {"input": 1.50, "output": 6.00},
    "gpt-4o": {"input": 2.50, "output": 10.00},
    "gpt-4o-mini": {"input": 0.15, "output": 0.60},
}

# Map old Anthropic model names to Azure deployment for backward compatibility
MODEL_MAP = {
    "claude-sonnet-4-6": "gpt-5-mini",
    "claude-sonnet-4-20250514": "gpt-5-mini",
    "claude-haiku-3-5": "gpt-5-mini",
}


def _anthropic_tool_to_openai(tool: dict) -> dict:
    """Convert Anthropic tool schema to OpenAI function calling format."""
    return {
        "type": "function",
        "function": {
            "name": tool["name"],
            "description": tool.get("description", ""),
            "parameters": tool.get("input_schema", {}),
        },
    }


class AnthropicClient:
    """
    Azure OpenAI wrapper that exposes the same interface as the original
    Anthropic client. Class name kept as AnthropicClient for backward
    compatibility with all import sites.
    """

    def __init__(self, api_key: Optional[str] = None, max_concurrent: int = 10):
        self._client = AsyncAzureOpenAI(
            azure_endpoint=os.environ.get(
                "AZURE_OPENAI_ENDPOINT",
                "https://franklink-openai.openai.azure.com/",
            ),
            api_key=api_key or os.environ.get("AZURE_OPENAI_API_KEY", ""),
            api_version=os.environ.get(
                "AZURE_OPENAI_API_VERSION", "2025-01-01-preview"
            ),
        )
        self._deployment = os.environ.get(
            "AZURE_OPENAI_DEPLOYMENT_NAME", "gpt-5-mini"
        )
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._total_input_tokens = 0
        self._total_output_tokens = 0
        self._total_cost = 0.0
        self._call_count = 0

    async def call_agent(
        self,
        system_prompt: str,
        messages: list[dict],
        tools: Optional[list[dict]] = None,
        max_tokens: int = 500,
        model: str = "gpt-5-mini",
    ) -> dict:
        """
        Call Azure OpenAI with a system prompt, messages, and optional tools.

        Returns a dict with:
        - text: str (any text content from response)
        - tool_use: Optional[dict] with {name: str, input: dict, id: str}
        - input_tokens: int
        - output_tokens: int
        - cost: float
        - stop_reason: str
        """
        # Map old Anthropic model names to Azure deployment
        resolved_model = MODEL_MAP.get(model, self._deployment)

        async with self._semaphore:
            try:
                # Build messages with system prompt
                full_messages = [{"role": "system", "content": system_prompt}]
                full_messages.extend(messages)

                kwargs: dict = {
                    "model": resolved_model,
                    "max_completion_tokens": max_tokens,
                    "messages": full_messages,
                }

                if tools:
                    # Convert Anthropic tool format to OpenAI function format
                    openai_tools = [_anthropic_tool_to_openai(t) for t in tools]
                    kwargs["tools"] = openai_tools
                    kwargs["tool_choice"] = "auto"

                response = await self._client.chat.completions.create(**kwargs)

                # Track usage
                usage = response.usage
                input_tokens = usage.prompt_tokens if usage else 0
                output_tokens = usage.completion_tokens if usage else 0
                self._total_input_tokens += input_tokens
                self._total_output_tokens += output_tokens
                self._call_count += 1

                # Calculate cost
                costs = MODEL_COSTS.get(resolved_model, MODEL_COSTS["gpt-5-mini"])
                call_cost = (
                    (input_tokens / 1_000_000) * costs["input"]
                    + (output_tokens / 1_000_000) * costs["output"]
                )
                self._total_cost += call_cost

                # Extract content
                choice = response.choices[0]
                message = choice.message
                text = message.content or ""
                tool_use_result = None

                # Extract tool calls (OpenAI format)
                if message.tool_calls:
                    tc = message.tool_calls[0]
                    try:
                        parsed_args = json.loads(tc.function.arguments)
                    except (json.JSONDecodeError, TypeError):
                        parsed_args = {}
                    tool_use_result = {
                        "name": tc.function.name,
                        "input": parsed_args,
                        "id": tc.id,
                    }

                # Map OpenAI finish_reason to our stop_reason
                finish_reason = choice.finish_reason or "stop"
                stop_reason_map = {
                    "stop": "end_turn",
                    "tool_calls": "tool_use",
                    "length": "max_tokens",
                    "content_filter": "content_filter",
                }
                stop_reason = stop_reason_map.get(finish_reason, finish_reason)

                return {
                    "text": text,
                    "tool_use": tool_use_result,
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "cost": call_cost,
                    "stop_reason": stop_reason,
                }

            except Exception as e:
                logger.error(f"Azure OpenAI API error: {e}")
                return {
                    "text": f"[API Error: {str(e)}]",
                    "tool_use": None,
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "cost": 0.0,
                    "stop_reason": "error",
                }

    def get_usage_report(self) -> dict:
        """Return cumulative usage statistics."""
        return {
            "total_input_tokens": self._total_input_tokens,
            "total_output_tokens": self._total_output_tokens,
            "total_tokens": self._total_input_tokens + self._total_output_tokens,
            "total_cost": round(self._total_cost, 4),
            "total_calls": self._call_count,
        }

    def reset_usage(self) -> None:
        """Reset usage counters."""
        self._total_input_tokens = 0
        self._total_output_tokens = 0
        self._total_cost = 0.0
        self._call_count = 0
