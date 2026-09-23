"""
Attribution — the bridge between a model's own account of why it moved and
the engine's ledger of what actually pushed it.

* ``known_refs`` — the ids a resident may legitimately cite for a window.
* ``validate_influences`` — keep only cited refs that exist, clamp weights,
  cap at six; fill from the ledger when the model cites nothing.
* ``build_digest`` — the reflection prompt section: what happened since the
  last read-out, with bracketed ids, plus where the options stand on the
  resident's issues and the instruction to cite.
"""

from __future__ import annotations

from backend.core.types import AgentState, InfluenceRef, LedgerEntry

DIGEST_CHAR_CAP = 1400
MAX_INFLUENCES = 6


def _kind_for_ref(ref: str) -> str:
    head = ref.split(":", 1)[0]
    return {
        "conv": "conversation",
        "news": "news",
        "gossip": "gossip",
        "persona": "persona",
        "god": "god_view",
        "event": "event",
        "seed": "seed",
    }.get(head, "persona")


def known_refs(agent: AgentState, since_round: int) -> dict[str, LedgerEntry]:
    """Refs the resident can cite: every ledger entry since the window opened."""
    out: dict[str, LedgerEntry] = {}
    if agent.beliefs is None:
        return out
    for entry in agent.beliefs.ledger:
        if entry.round >= since_round or entry.kind == "seed":
            out.setdefault(entry.ref, entry)
    for rec in agent.memory_records:
        if rec.round >= since_round:
            for ref in rec.refs:
                out.setdefault(
                    ref,
                    LedgerEntry(
                        round=rec.round,
                        kind=_kind_for_ref(ref)
                        if _kind_for_ref(ref)
                        in (
                            "seed",
                            "conversation",
                            "news",
                            "gossip",
                            "god_view",
                            "event",
                            "reflection",
                        )
                        else "event",
                        ref=ref,
                        option=agent.current_opinion.candidate if agent.current_opinion else "",
                        delta=0.0,
                        note=rec.text[:80],
                    ),
                )  # type: ignore[arg-type]
    return out


def from_ledger(
    agent: AgentState, since_round: int, new_stance: str, limit: int = MAX_INFLUENCES
) -> list[InfluenceRef]:
    """Influences derived purely from the ledger (the mock path, and the fill)."""
    if agent.beliefs is None:
        return []
    entries = [e for e in agent.beliefs.ledger if e.round >= since_round and e.delta != 0.0]
    if not entries:
        return []
    biggest = max(abs(e.delta) for e in entries) or 1.0
    entries.sort(key=lambda e: -abs(e.delta))
    out: list[InfluenceRef] = []
    seen: set[str] = set()
    for e in entries:
        if e.ref in seen:
            continue
        seen.add(e.ref)
        out.append(
            InfluenceRef(
                kind=_kind_for_ref(e.ref),  # type: ignore[arg-type]
                ref=e.ref,
                agent_id=e.agent_id,
                direction="toward" if e.option == new_stance else "away",
                weight=round(min(1.0, abs(e.delta) / biggest), 3),
                note=e.note[:160],
            )
        )
        if len(out) >= limit:
            break
    return out


def validate_influences(
    cited: list[dict] | None,
    agent: AgentState,
    since_round: int,
    new_stance: str,
) -> tuple[list[InfluenceRef], bool]:
    """Keep the model's valid citations; fill from the ledger when it cites nothing.

    Returns (influences, cited_anything_valid).
    """
    known = known_refs(agent, since_round)
    out: list[InfluenceRef] = []
    seen: set[str] = set()
    for item in cited or []:
        if not isinstance(item, dict):
            continue
        ref = str(item.get("ref", "")).strip().strip("[]")
        if not ref or ref not in known or ref in seen:
            continue
        seen.add(ref)
        entry = known[ref]
        try:
            weight = float(item.get("weight", 0.5))
        except (TypeError, ValueError):
            weight = 0.5
        direction = item.get("direction", "toward")
        if direction not in ("toward", "away"):
            direction = "toward"
        out.append(
            InfluenceRef(
                kind=_kind_for_ref(ref),  # type: ignore[arg-type]
                ref=ref,
                agent_id=entry.agent_id,
                direction=direction,  # type: ignore[arg-type]
                weight=max(0.0, min(1.0, weight)),
                note=str(item.get("note", ""))[:160],
            )
        )
        if len(out) >= MAX_INFLUENCES:
            break
    if out:
        return out, True
    return from_ledger(agent, since_round, new_stance), False


def build_digest(agent: AgentState, since_round: int, model, latest_round: int) -> str:
    """The reflection window as prompt text with bracketed ids."""
    lines: list[str] = ["SINCE YOUR LAST REFLECTION (cite these ids if they moved you):"]
    records = [r for r in agent.memory_records if r.round >= since_round]
    if not records:
        lines.append("- Nothing new has reached you.")
    else:
        # Latest round in full; older rounds compressed to the two most salient.
        by_round: dict[int, list] = {}
        for r in records:
            by_round.setdefault(r.round, []).append(r)
        for rnd in sorted(by_round):
            items = by_round[rnd]
            if rnd < latest_round:
                items = sorted(items, key=lambda r: -r.salience)[:2]
            for r in items:
                tag = f"[{r.refs[0]}] " if r.refs else ""
                lines.append(f"- r{rnd} {tag}{r.text}")
    if agent.beliefs is not None and model is not None:
        weights = sorted(agent.beliefs.weights.items(), key=lambda kv: -kv[1])[:3]
        if weights:
            lines.append("")
            lines.append("WHERE THE OPTIONS STAND ON YOUR ISSUES:")
            labels = {i.id: i.label for i in model.issues}
            for issue_id, w in weights:
                if w <= 0:
                    continue
                stands = []
                for o in model.option_ids:
                    a = model.alignment.get(o, {}).get(issue_id, 0.0)
                    if a >= 0.5:
                        stands.append(f"{o}: for")
                    elif a <= -0.5:
                        stands.append(f"{o}: against")
                    elif a != 0:
                        stands.append(f"{o}: mixed")
                if stands:
                    lines.append(f"- {labels.get(issue_id, issue_id)}: " + ", ".join(stands))
    lines.append("")
    lines.append(
        "In `influences`, cite only the bracketed ids above that changed or confirmed your view; "
        "leave it empty if nothing did. Put one repeatable sentence in `reason`."
    )
    text = "\n".join(lines)
    if len(text) > DIGEST_CHAR_CAP:
        text = text[: DIGEST_CHAR_CAP - 1].rstrip() + "…"
    return text
