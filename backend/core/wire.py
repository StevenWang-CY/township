"""
Wire-DTO converters.

These helpers convert backend Pydantic models into plain dicts whose key/value
shapes match the frontend's TypeScript interfaces (see
`frontend/src/types/messages.ts`). They are the single source of truth for
what goes "on the wire" (WebSocket events + REST JSON bodies).

If the frontend interface changes, update the converters here — not the
internal backend types.
"""

from __future__ import annotations

from collections import Counter
from typing import Optional

from .types import (
    AgentState,
    DistrictSummary,
    NewsReaction,
    Opinion,
    TownSummary,
)


# ── Town palette (mirrors frontend TOWN_META). Kept here so the backend can
#    fill in a sensible color when emitting an agent_state to the wire.
_TOWN_COLORS: dict[str, str] = {
    "dover": "#dc2626",       # red-600
    "montclair": "#2563eb",   # blue-600
    "parsippany": "#16a34a",  # green-600
    "randolph": "#9333ea",    # purple-600
}


def _initials(name: str) -> str:
    """Return up to 2 uppercase initials for a person name."""
    if not name:
        return "?"
    parts = [p for p in name.replace(".", " ").split() if p]
    if not parts:
        return name[:2].upper()
    if len(parts) == 1:
        return parts[0][:2].upper()
    return (parts[0][0] + parts[-1][0]).upper()


def _color_for_town(town: str) -> str:
    return _TOWN_COLORS.get((town or "").lower(), "#888888")


def opinion_to_wire(o: Optional[Opinion]) -> Optional[dict]:
    """Map a backend Opinion to the frontend Opinion shape (plural top_issues).

    Returns None when given None so that callers can pass through "no opinion
    yet" agents without an explicit None-check at every site.
    """
    if o is None:
        return None
    return {
        "candidate": o.candidate,
        "confidence": o.confidence,
        "reasoning": o.reasoning,
        "top_issues": list(o.top_issues),
        "dealbreaker": o.dealbreaker,
        "round_number": o.round_number,
    }


def agent_state_to_wire(s: AgentState) -> dict:
    """Map a backend AgentState to the frontend AgentState shape."""
    last_op = s.current_opinion
    town = s.definition.town
    if last_op is not None:
        opinion_payload = opinion_to_wire(last_op)
    else:
        opinion_payload = {
            "candidate": s.definition.initial_lean,
            "confidence": 25,
            "reasoning": "Initial impression",
            "top_issues": list(s.definition.top_concerns[:3]) if s.definition.top_concerns else [],
            "dealbreaker": None,
            "round_number": 0,
        }

    return {
        "id": s.agent_id,
        "name": s.definition.name,
        "town": town,
        "occupation": s.definition.occupation,
        "opinion": opinion_payload,
        "location": s.current_location,
        "current_activity": "idle",
        "initials": _initials(s.definition.name),
        "color": _color_for_town(town),
    }


def news_reaction_to_wire(
    r: NewsReaction,
    *,
    agent_id: Optional[str] = None,
    town: Optional[str] = None,
    headline: Optional[str] = None,
) -> dict:
    """Map a backend NewsReaction to the frontend NewsReaction shape."""
    return {
        "agent_id": agent_id or r.agent_id or "",
        "agent_name": r.agent_name,
        "town": town or r.town or "",
        "headline": headline or r.headline or r.event or "",
        "emotional_response": r.emotional_response,
        "impact_on_vote": r.impact_on_vote,
        "reasoning": r.reasoning,
    }


def town_summary_to_wire(s: TownSummary) -> dict:
    """Map a backend TownSummary to the frontend TownSummary shape."""
    # Backend stores top_issues as [{issue, importance}]; frontend wants a flat
    # list of strings. Extract the issue names while preserving order.
    issues_flat: list[str] = []
    for t in s.top_issues:
        if isinstance(t, dict):
            name = t.get("issue", "")
            if name:
                issues_flat.append(name)
        elif t:
            issues_flat.append(str(t))

    return {
        "town": s.town,
        "round": s.rounds_completed,
        "opinions": dict(s.opinion_distribution),
        "top_issues": issues_flat,
        "consensus_points": [],
        "fault_lines": [],
        "notable_conversations": [],
    }


def _aggregate_opinions(d: DistrictSummary) -> dict[str, int]:
    """Sum opinion distributions across all towns in a DistrictSummary."""
    total: Counter = Counter()
    for ts in d.by_town.values():
        for cand, count in ts.opinion_distribution.items():
            total[cand] += int(count)
    # Ensure all four candidates are represented even when zero.
    for k in ("mejia", "hathaway", "bond", "undecided"):
        total.setdefault(k, 0)
    return dict(total)


def district_summary_to_wire(d: DistrictSummary) -> dict:
    """Map a backend DistrictSummary to the frontend DistrictSummary shape."""
    town_wires = [town_summary_to_wire(s) for s in d.by_town.values()]
    # Round is the max rounds_completed across towns
    round_num = 0
    for ts in d.by_town.values():
        if ts.rounds_completed > round_num:
            round_num = ts.rounds_completed
    return {
        "round": round_num,
        "town_summaries": town_wires,
        "overall_opinions": _aggregate_opinions(d),
        "cross_town_themes": [],
        "consensus_zones": list(d.consensus_zones),
        "fault_lines": list(d.fault_lines),
        # Bonus fields the dashboard may want (non-breaking — frontend ignores
        # unknown keys).
        "prediction": dict(d.prediction),
        "total_agents": d.total_agents,
        "total_conversations": d.total_conversations,
        "total_cost": d.total_cost,
    }
