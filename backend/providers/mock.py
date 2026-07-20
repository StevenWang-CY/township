"""
Deterministic mock provider — a full simulation with zero credentials.

Every choice is seeded from a hash of the inputs (system prompt + last user
message + tool name), so identical inputs always produce identical outputs
and the whole test suite / demo runs without a network. Flavor is derived
from the prompts themselves: the agent's name is parsed from the persona
("You are Carlos Restrepo, ..."), and concerns are pulled from "Top issues:"
lines, "top concerns" mentions, or civic keywords found in the prompt text,
with a generic fallback.

Env vars:
- MOCK_DELAY_S — per-call async sleep (default 0.05) so the live UI animates.
"""

import asyncio
import hashlib
import json
import logging
import os
import re
from typing import Any

from .base import UsageTracker

logger = logging.getLogger(__name__)

DEFAULT_MOCK_DELAY_S = 0.05

# ── Prompt parsing ─────────────────────────────────────────────

_NAME_RE = re.compile(
    r"You are ([A-Z][a-zA-Z'’.\-]+(?:\s[A-Z][a-zA-Z'’.\-]+){0,3})"
)

_CONCERN_LINE_RES = [
    re.compile(r"[Tt]op issues:\s*([^\n]+)"),
    re.compile(r"[Tt]op concerns[^:\n]*:\s*([^\n]+)"),
    re.compile(r"who cares about ([^\n\"]+)"),
]

# Civic topics scanned for in the prompt body when no explicit list exists.
_CIVIC_KEYWORDS = [
    "healthcare",
    "health insurance",
    "immigration",
    "property taxes",
    "taxes",
    "housing",
    "rent",
    "schools",
    "education",
    "college",
    "childcare",
    "cost of living",
    "small business",
    "public safety",
    "traffic",
    "transit",
    "jobs",
    "wages",
    "insurance",
]

_GENERIC_CONCERNS = ["the cost of living", "property taxes", "local schools"]

# ── Deterministic flavor templates ─────────────────────────────

_DISCUSS_TEMPLATES = [
    "Honestly, {concern} is what keeps me up at night. I want a real plan "
    "before April 16, not another speech.",
    "I keep coming back to {concern}. Everyone around here feels it, and "
    "none of the candidates have fully convinced me yet.",
    "You know how I feel about {concern} — it hits people like us first. "
    "I'm listening for whoever actually addresses it.",
    "Between you and me, {concern} has only gotten worse this year. That's "
    "the lens I'm bringing to this election.",
    "My family talks about {concern} at the dinner table every week. "
    "Whoever speaks to that gets my attention.",
]

_TAKEAWAY_TEMPLATES = [
    "We talked about {concern} and where the candidates stand on it.",
    "This conversation sharpened how much {concern} matters to my vote.",
    "I came away thinking harder about {concern}.",
    "Hearing another perspective on {concern} gave me something to chew on.",
]

_CHAT_TEMPLATES = [
    "Good of you to ask. For me it all comes down to {concern} — that's "
    "what I'm weighing before I vote. What about you?",
    "Things are steady, thanks. Though {concern} is never far from my mind "
    "these days — this election feels like it matters more than most.",
    "I'll be straight with you: {concern} is the thing I need these "
    "candidates to get serious about. So far I'm still listening.",
    "Around here, {concern} is what people actually talk about. The rest "
    "is noise until someone shows me a plan.",
]

_REASONING_TEMPLATES = [
    "After everything I've heard, {lean}. {concern_cap} is still my number "
    "one issue and that's what I'm voting on.",
    "{lean_cap} — mostly because of {concern}. I've listened to neighbors "
    "and watched the debate, and that's where I land for now.",
    "It comes down to {concern} for me and my family, so {lean}.",
]

_SHARE_WITH = [
    "my family over dinner",
    "the regulars at the shop",
    "my neighbors on the block",
    "my sister",
    "the folks at church",
]

_NEWS_REASONING_TEMPLATES = [
    "This lands close to home — with {concern} already squeezing us, news "
    "like this changes the math for my family.",
    "I read this twice. Anything touching {concern} touches my household, "
    "so I can't just shrug it off.",
    "Maybe it's overblown, but with {concern} on my mind it's hard not to "
    "take this personally.",
]

_TRUST_DELTAS = {"curious": 5, "agreeable": 3, "challenging": -2, "hostile": -10}


def _seed(*parts: str) -> int:
    digest = hashlib.sha256("||".join(parts).encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big")


def _pick(seq: list, seed: int) -> Any:
    return seq[seed % len(seq)]


def _extract_name(system_prompt: str) -> str:
    match = _NAME_RE.search(system_prompt or "")
    return match.group(1) if match else "a local resident"


def _extract_concerns(system_prompt: str) -> list[str]:
    text = system_prompt or ""
    concerns: list[str] = []

    for pattern in _CONCERN_LINE_RES:
        match = pattern.search(text)
        if match:
            for item in match.group(1).split(","):
                item = item.strip().strip(".").strip()
                if not item or len(item) > 40:
                    continue
                lowered = item.lower()
                if "approach" in lowered or "says" in lowered:
                    continue  # trailing prose captured by the loose regex
                concerns.append(item)
        if concerns:
            return concerns[:4]

    lowered_text = text.lower()
    for keyword in _CIVIC_KEYWORDS:
        if keyword in lowered_text and keyword not in concerns:
            concerns.append(keyword)
        if len(concerns) >= 4:
            break
    return concerns or list(_GENERIC_CONCERNS)


def _schema_props(tool: dict) -> dict:
    return tool.get("input_schema", {}).get("properties", {})


def _schema_enum(tool: dict, field: str, default: list) -> list:
    enum = _schema_props(tool).get(field, {}).get("enum")
    return list(enum) if enum else list(default)


def _last_user_message(messages: list[dict]) -> str:
    for message in reversed(messages or []):
        if message.get("role") == "user":
            content = message.get("content", "")
            if isinstance(content, list):
                content = " ".join(
                    str(b.get("text", "")) for b in content if isinstance(b, dict)
                )
            return str(content)
    return ""


class MockProvider:
    """Fully deterministic, zero-network stand-in with the standard contract."""

    provider_name = "mock"

    def __init__(self, max_concurrent: int = 10):
        # max_concurrent accepted for interface parity; the mock has no
        # rate limit to protect.
        try:
            self._delay = float(os.environ.get("MOCK_DELAY_S", DEFAULT_MOCK_DELAY_S))
        except ValueError:
            self._delay = DEFAULT_MOCK_DELAY_S
        self._usage = UsageTracker()
        # Per-agent FormOpinion call counts drive the upward confidence drift.
        self._opinion_calls: dict[str, int] = {}

    # ── Tool handlers ──────────────────────────────────────────

    def _discuss(self, tool: dict, seed: int, name: str, concerns: list[str]) -> dict:
        concern = _pick(concerns, seed)
        sentiments = _schema_enum(tool, "sentiment", ["positive", "negative", "neutral"])
        gestures = _schema_enum(tool, "gesture", ["nod", "shrug", "point", "none"])
        return {
            "response": _pick(_DISCUSS_TEMPLATES, seed).format(concern=concern),
            "topic": concern,
            "sentiment": _pick(sentiments, seed >> 8),
            "key_takeaway": _pick(_TAKEAWAY_TEMPLATES, seed >> 16).format(
                concern=concern
            ),
            "gesture": _pick(gestures, seed >> 24),
        }

    def _form_opinion(self, tool: dict, name: str, concerns: list[str]) -> dict:
        stances = _schema_enum(
            tool, "candidate", ["mejia", "hathaway", "bond", "undecided"]
        )
        # Stance is seeded from the agent identity alone, so it stays stable
        # for that agent across every call even as the prompt accretes memories.
        agent_seed = _seed(name, "FormOpinion", str(stances))
        stance = _pick(stances, agent_seed)

        calls = self._opinion_calls.get(name, 0) + 1
        self._opinion_calls[name] = calls
        # Confidence drifts upward each round; undecided stays tentative.
        confidence = min(95, 38 + (agent_seed % 11) + (calls - 1) * 9)
        if stance == "undecided":
            confidence = min(confidence, 55)

        concern = _pick(concerns, agent_seed >> 8)
        lean = (
            "I'm still not settled on anyone"
            if stance == "undecided"
            else f"I'm leaning {stance}"
        )
        reasoning = _pick(_REASONING_TEMPLATES, agent_seed >> 16).format(
            lean=lean,
            lean_cap=lean[0].upper() + lean[1:],
            concern=concern,
            concern_cap=concern[0].upper() + concern[1:],
        )
        result: dict = {
            "candidate": stance,
            "confidence": confidence,
            "reasoning": reasoning,
            "top_issues": concerns[:3],
        }
        if "dealbreaker" in _schema_props(tool) and agent_seed % 3 != 0:
            result["dealbreaker"] = (
                f"A candidate reversing course on {concern} would lose me entirely."
            )
        return result

    def _react_to_news(
        self, tool: dict, seed: int, concerns: list[str], news: str
    ) -> dict:
        emotions = _schema_enum(
            tool,
            "emotional_response",
            ["angry", "hopeful", "anxious", "indifferent", "confused"],
        )
        impacts = _schema_enum(
            tool,
            "impact_on_vote",
            ["strengthens_current", "weakens_current", "changes_mind", "no_effect"],
        )
        concern = _pick(concerns, seed)
        result = {
            "emotional_response": _pick(emotions, seed >> 8),
            "impact_on_vote": _pick(impacts, seed >> 16),
            "reasoning": _pick(_NEWS_REASONING_TEMPLATES, seed >> 24).format(
                concern=concern
            ),
            "would_share_with": _pick(_SHARE_WITH, seed >> 32),
        }
        if "magnitude" in _schema_props(tool):
            magnitudes = _schema_enum(
                tool, "magnitude", ["none", "minor", "moderate", "major"]
            )
            result["magnitude"] = _pick(magnitudes, seed >> 40)
        return result

    def _classify_interaction(self, tool: dict, seed: int) -> dict:
        tones = _schema_enum(
            tool, "tone", ["agreeable", "challenging", "curious", "hostile"]
        )
        tone = _pick(tones, seed)
        delta_schema = _schema_props(tool).get("trust_delta", {})
        minimum = delta_schema.get("minimum", -15)
        maximum = delta_schema.get("maximum", 15)
        delta = max(minimum, min(maximum, _TRUST_DELTAS.get(tone, 0)))
        return {
            "tone": tone,
            "trust_delta": delta,
            "reasoning": f"They came across as {tone}, and that shaped how much I trust them.",
        }

    def _fill_generic(self, tool: dict, seed: int, concerns: list[str]) -> dict:
        """Plausible input for a tool this mock has no bespoke handler for."""
        concern = _pick(concerns, seed)
        filled: dict = {}
        for i, (field, spec) in enumerate(_schema_props(tool).items()):
            field_seed = seed >> (i % 6 * 8)
            if "enum" in spec:
                filled[field] = _pick(list(spec["enum"]), field_seed)
            elif spec.get("type") == "string":
                filled[field] = (
                    f"Thinking about {concern}, that's my honest read on {field.replace('_', ' ')}."
                )
            elif spec.get("type") == "integer":
                low = spec.get("minimum", 0)
                high = spec.get("maximum", low + 10)
                filled[field] = low + field_seed % (high - low + 1)
            elif spec.get("type") == "number":
                low = spec.get("minimum", 0)
                high = spec.get("maximum", low + 1)
                filled[field] = low + (field_seed % 100) / 100 * (high - low)
            elif spec.get("type") == "boolean":
                filled[field] = field_seed % 2 == 0
            elif spec.get("type") == "array":
                filled[field] = [concern]
            elif spec.get("type") == "object":
                filled[field] = {}
        return filled

    # ── Contract ───────────────────────────────────────────────

    async def call_agent(
        self,
        system_prompt: str,
        messages: list[dict],
        tools: list[dict] | None = None,
        max_tokens: int = 500,
        model: str | None = None,
    ) -> dict:
        if self._delay > 0:
            await asyncio.sleep(self._delay)

        name = _extract_name(system_prompt)
        concerns = _extract_concerns(system_prompt)
        last_user = _last_user_message(messages)

        text = ""
        tool_use: dict | None = None

        if tools:
            by_name = {t.get("name", ""): t for t in tools}
            # Mirror the priority a real agent shows: crystallize opinions
            # and reactions before free-form discussion.
            tool_name = next(
                (
                    n
                    for n in (
                        "FormOpinion",
                        "ReactToNews",
                        "ClassifyInteraction",
                        "Discuss",
                    )
                    if n in by_name
                ),
                tools[0].get("name", ""),
            )
            tool = by_name.get(tool_name, tools[0])
            seed = _seed(system_prompt or "", last_user, tool_name)

            if tool_name == "Discuss":
                tool_input = self._discuss(tool, seed, name, concerns)
            elif tool_name == "FormOpinion":
                tool_input = self._form_opinion(tool, name, concerns)
            elif tool_name == "ReactToNews":
                tool_input = self._react_to_news(tool, seed, concerns, last_user)
            elif tool_name == "ClassifyInteraction":
                tool_input = self._classify_interaction(tool, seed)
            else:
                tool_input = self._fill_generic(tool, seed, concerns)

            tool_use = {
                "name": tool_name,
                "input": tool_input,
                "id": f"tu_mock_{seed % 100_000_000:08d}",
            }
        else:
            seed = _seed(system_prompt or "", last_user, "chat")
            text = _pick(_CHAT_TEMPLATES, seed).format(
                concern=_pick(concerns, seed >> 8)
            )

        # Rough, deterministic token estimate (~4 chars per token) so the
        # UI's usage counters move; cost stays 0.
        input_chars = len(system_prompt or "") + sum(
            len(str(m.get("content", ""))) for m in (messages or [])
        )
        output_chars = len(text) if text else len(json.dumps(tool_use["input"]))
        input_tokens = input_chars // 4
        output_tokens = max(1, output_chars // 4)
        self._usage.record(input_tokens=input_tokens, output_tokens=output_tokens)

        return {
            "text": text,
            "tool_use": tool_use,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost": 0.0,
            "stop_reason": "tool_use" if tool_use else "end_turn",
        }

    def get_usage_report(self) -> dict:
        return self._usage.report(provider=self.provider_name, default_model="mock")

    def reset_usage(self) -> None:
        self._usage.reset()
        self._opinion_calls.clear()
