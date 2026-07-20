"""
Anthropic <-> OpenAI translation helpers.

Township's tool schemas (backend/tools/schemas.py) are stored in Anthropic
format. OpenAI-compatible endpoints (OpenAI, OpenRouter, Ollama, LM Studio)
speak the chat-completions "function" format instead, so these helpers
convert tool definitions on the way out and responses back into the
`call_agent` return shape on the way in.
"""

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)

# OpenAI finish_reason → Anthropic-style stop_reason. Unknown values pass
# through unchanged so nothing is silently swallowed.
FINISH_REASON_MAP = {
    "tool_calls": "tool_use",
    "function_call": "tool_use",
    "stop": "end_turn",
    "length": "max_tokens",
    "content_filter": "refusal",
}


def anthropic_tool_to_openai(tool: dict) -> dict:
    """One Anthropic tool ({name, description, input_schema}) → OpenAI function."""
    return {
        "type": "function",
        "function": {
            "name": tool["name"],
            "description": tool.get("description", ""),
            "parameters": tool.get(
                "input_schema", {"type": "object", "properties": {}}
            ),
        },
    }


def anthropic_tools_to_openai(tools: list[dict] | None) -> list[dict]:
    """Convert a whole Anthropic tool list (handles None / multiple tools)."""
    return [anthropic_tool_to_openai(t) for t in (tools or [])]


def openai_tool_to_anthropic(tool: dict) -> dict:
    """Inverse of `anthropic_tool_to_openai` (used for round-trip testing)."""
    fn = tool.get("function", tool)
    return {
        "name": fn["name"],
        "description": fn.get("description", ""),
        "input_schema": fn.get("parameters", {"type": "object", "properties": {}}),
    }


def openai_finish_reason_to_stop_reason(finish_reason: str | None) -> str:
    if not finish_reason:
        return "end_turn"
    return FINISH_REASON_MAP.get(finish_reason, finish_reason)


def flatten_message_content(content: Any) -> str:
    """
    Collapse Anthropic-style content (plain string, or a list of text
    blocks) into the single string OpenAI chat messages expect.
    """
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and "text" in block:
                parts.append(str(block.get("text") or ""))
        return "\n".join(p for p in parts if p)
    return str(content or "")


def _get(obj: Any, key: str, default: Any = None) -> Any:
    """Field access that works on both SDK objects and plain dicts."""
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def openai_completion_to_result(completion: Any, cost: float = 0.0) -> dict:
    """
    An OpenAI chat completion (SDK object or dict) → the `call_agent`
    return shape. The first tool call becomes `tool_use` with its JSON
    arguments parsed; finish_reason is mapped (tool_calls → tool_use,
    stop → end_turn).
    """
    choices = _get(completion, "choices") or []
    message = _get(choices[0], "message") if choices else None
    finish_reason = _get(choices[0], "finish_reason") if choices else None

    text = (_get(message, "content") or "") if message is not None else ""

    tool_use: dict | None = None
    tool_calls = (_get(message, "tool_calls") or []) if message is not None else []
    if tool_calls:
        tc = tool_calls[0]
        fn = _get(tc, "function") or {}
        raw_args = _get(fn, "arguments") or "{}"
        if isinstance(raw_args, str):
            try:
                parsed_input = json.loads(raw_args)
            except json.JSONDecodeError:
                logger.warning(
                    "Tool call arguments were not valid JSON: %.200s", raw_args
                )
                parsed_input = {}
        else:
            parsed_input = dict(raw_args)
        tool_use = {
            "name": _get(fn, "name") or "",
            "input": parsed_input,
            "id": _get(tc, "id") or "",
        }

    usage = _get(completion, "usage")
    input_tokens = (_get(usage, "prompt_tokens", 0) or 0) if usage is not None else 0
    output_tokens = (_get(usage, "completion_tokens", 0) or 0) if usage is not None else 0

    return {
        "text": text,
        "tool_use": tool_use,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cost": cost,
        "stop_reason": openai_finish_reason_to_stop_reason(finish_reason),
    }
