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

from .scenario import validate_stance
from .types import (
    AgentState,
    DistrictSummary,
    NewsReaction,
    Opinion,
    TownSummary,
)


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


def _color_for_town(town: str, scenario=None) -> str:
    """Accent color for a town, sourced from the scenario's town JSON."""
    if scenario is not None:
        return scenario.town_color(town)
    return "#888888"


def opinion_to_wire(o: Opinion | None) -> dict | None:
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


def agent_state_to_wire(s: AgentState, scenario=None) -> dict:
    """Map a backend AgentState to the frontend AgentState shape.

    `scenario` supplies the town accent color (town JSON `accent_color`);
    without it the color falls back to a neutral gray.
    """
    last_op = s.current_opinion
    town = s.definition.town
    if last_op is not None:
        opinion_payload = opinion_to_wire(last_op)
    else:
        # Pre-seed roster entry: synthesize an opinion from the persona's
        # initial lean, coerced onto the scenario's stance roster so a bad
        # lean can never reach the frontend as an unknown color bucket.
        lean = s.definition.initial_lean
        if scenario is not None:
            lean = validate_stance(lean, scenario)
        opinion_payload = {
            "candidate": lean,
            "confidence": 25,
            "reasoning": "Initial impression",
            "top_issues": list(s.definition.top_concerns[:3]) if s.definition.top_concerns else [],
            "dealbreaker": None,
            "round_number": 0,
        }

    # Relationships → {agent_id: type} map (skip malformed entries)
    relationships: dict[str, str] = {}
    for r in s.definition.relationships:
        if isinstance(r, dict) and r.get("agent"):
            relationships[r["agent"]] = r.get("type", "")

    return {
        "id": s.agent_id,
        "name": s.definition.name,
        "town": town,
        "occupation": s.definition.occupation,
        "opinion": opinion_payload,
        "location": s.current_location,
        "current_activity": "idle",
        "initials": _initials(s.definition.name),
        "color": _color_for_town(town, scenario),
        "idle_thoughts": list(s.definition.idle_thoughts),
        "routine": list(s.definition.routine),
        "top_concerns": list(s.definition.top_concerns),
        "relationships": relationships,
    }


def news_reaction_to_wire(
    r: NewsReaction,
    *,
    agent_id: str | None = None,
    town: str | None = None,
    headline: str | None = None,
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
        "failed_agents": s.failed_agents,
    }


def _aggregate_opinions(d: DistrictSummary, scenario=None) -> dict[str, int]:
    """Sum opinion distributions across all towns in a DistrictSummary."""
    total: Counter = Counter()
    for ts in d.by_town.values():
        for cand, count in ts.opinion_distribution.items():
            total[cand] += int(count)
    # Ensure every stance on the scenario roster is represented even when zero.
    if scenario is not None:
        for k in scenario.valid_stance_ids:
            total.setdefault(k, 0)
    return dict(total)


def district_summary_to_wire(d: DistrictSummary, scenario=None) -> dict:
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
        "overall_opinions": _aggregate_opinions(d, scenario),
        "cross_town_themes": [],
        "consensus_zones": list(d.consensus_zones),
        "fault_lines": list(d.fault_lines),
        # Bonus fields the dashboard may want (non-breaking — frontend ignores
        # unknown keys).
        "prediction": dict(d.prediction),
        "total_agents": d.total_agents,
        "total_conversations": d.total_conversations,
        "total_cost": d.total_cost,
        "failed_agents": d.failed_agents,
    }
