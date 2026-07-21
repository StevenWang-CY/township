"""
Narrative recap — a "what happened" story for a finished simulation run.

``generate_recap()`` makes ONE provider call with a tight prompt built from
the run's real data (final distribution per town, the biggest opinion swings
mined from ``opinion_changed`` events, notable conversation takeaways) and
returns a 250-350 word markdown narrative with a headline.

When the provider is the deterministic mock, or the call errors, or the
model returns something too thin to be a recap, we fall back to a carefully
written template with the same real numbers interpolated — it reads like a
local-paper wrap-up, not a mad-lib.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

RECAP_MAX_TOKENS = 800

# A provider response shorter than this can't be a real 250-word recap —
# treat it as a failure and use the deterministic template instead.
_MIN_ACCEPTABLE_CHARS = 400


# ─── Data mining ───────────────────────────────────────────────


def _mine_swings(event_log: list, scenario) -> list[dict]:
    """Extract genuine stance changes from opinion_changed events.

    Returns one record per agent who ended on a different stance than they
    started with, ordered by how dramatic the journey was (stance switches
    counted along the way).
    """
    first_stance: dict[str, str] = {}
    last: dict[str, dict] = {}
    switch_count: dict[str, int] = {}

    for event in event_log:
        if getattr(event, "type", None) != "opinion_changed":
            continue
        agent_id = event.agent_id
        old = event.old_opinion
        new = event.new_opinion
        if agent_id not in first_stance:
            first_stance[agent_id] = old.candidate if old else scenario.undecided_id
        if old is not None and old.candidate != new.candidate:
            switch_count[agent_id] = switch_count.get(agent_id, 0) + 1
        last[agent_id] = {
            "agent_id": agent_id,
            "name": event.agent_name,
            "town": event.town,
            "stance": new.candidate,
            "confidence": new.confidence,
            "reasoning": (new.reasoning or "")[:200],
        }

    swings = []
    for agent_id, record in last.items():
        start = first_stance.get(agent_id, scenario.undecided_id)
        if record["stance"] != start:
            record["from"] = start
            record["switches"] = switch_count.get(agent_id, 1)
            swings.append(record)
    swings.sort(key=lambda r: r["switches"], reverse=True)
    return swings


def _mine_takeaways(event_log: list, limit: int = 5) -> list[str]:
    """Pull the most substantial conversation summaries from the run."""
    seen: set[str] = set()
    takeaways: list[str] = []
    for event in event_log:
        if getattr(event, "type", None) != "conversation_ended":
            continue
        summary = (getattr(event, "summary", "") or "").strip()
        if len(summary) < 20 or summary in seen:
            continue
        seen.add(summary)
        takeaways.append(summary)
    # Longest summaries carry the most signal; keep original order among picks.
    ranked = sorted(takeaways, key=len, reverse=True)[:limit]
    return [t for t in takeaways if t in set(ranked)][:limit]


def _label(scenario, stance: str) -> str:
    return scenario.option_label.get(stance, stance)


def _fmt_distribution(scenario, distribution: dict[str, int]) -> str:
    parts = [
        f"{_label(scenario, stance)} {count}"
        for stance, count in sorted(distribution.items(), key=lambda kv: -kv[1])
        if count > 0
    ]
    return ", ".join(parts) if parts else "no opinions recorded"


def _leader(prediction: dict[str, float]) -> tuple[str, float]:
    if not prediction:
        return "undecided", 0.0
    stance = max(prediction, key=lambda k: prediction[k])
    return stance, prediction[stance]


# ─── Prompt (real providers) ───────────────────────────────────


def _build_prompt(scenario, district_summary, swings: list[dict], takeaways: list[str]) -> str:
    lines: list[str] = []
    lines.append(f"Scenario: {scenario.title}")
    lines.append(f"The question: {scenario.question}")
    lines.append("")
    leader, pct = _leader(district_summary.prediction)
    lines.append(
        "Final prediction across all towns: "
        + ", ".join(
            f"{_label(scenario, s)} {p}%"
            for s, p in sorted(district_summary.prediction.items(), key=lambda kv: -kv[1])
        )
    )
    lines.append(f"Leading: {_label(scenario, leader)} at {pct}%.")
    lines.append("")
    lines.append("Final distribution per town (agent counts):")
    for town, summary in district_summary.by_town.items():
        lines.append(f"- {town}: {_fmt_distribution(scenario, summary.opinion_distribution)}")
    lines.append("")
    if swings:
        lines.append("Biggest opinion swings:")
        for s in swings[:6]:
            lines.append(
                f"- {s['name']} ({s['town']}): {_label(scenario, s['from'])} -> "
                f"{_label(scenario, s['stance'])} (confidence {s['confidence']}%). "
                f"Why: {s['reasoning']}"
            )
        lines.append("")
    if takeaways:
        lines.append("Notable conversation takeaways:")
        for t in takeaways:
            lines.append(f"- {t}")
        lines.append("")
    lines.append(
        f"{district_summary.total_agents} residents took part across "
        f"{len(district_summary.by_town)} town(s), holding "
        f"{district_summary.total_conversations} conversations."
    )
    lines.append("")
    lines.append(
        "Write a 250-350 word narrative recap in markdown of what happened in this "
        "simulation. Start with a single '# ' headline (under 12 words, punchy, "
        "newspaper-style). Then 3-4 short paragraphs: how the deliberation opened, "
        "who moved and why (name real residents from the swings above), what the "
        "conversations kept circling back to, and where things landed (use the real "
        "percentages). Ground every claim in the data above — no invented people or "
        "numbers. Do not add a title beyond the headline, and do not use bullet lists."
    )
    return "\n".join(lines)


_RECAP_SYSTEM = (
    "You are the town chronicler for a civic deliberation simulation. You write "
    "vivid but scrupulously factual recaps of simulation runs, in the voice of a "
    "sharp local newspaper — concrete, warm, never breathless."
)


# ─── Deterministic template (mock / fallback) ──────────────────


def _join_names(names: list[str]) -> str:
    if not names:
        return ""
    if len(names) == 1:
        return names[0]
    if len(names) == 2:
        return f"{names[0]} and {names[1]}"
    return ", ".join(names[:-1]) + f", and {names[-1]}"


def _template_recap(scenario, district_summary, swings: list[dict], takeaways: list[str]) -> str:
    leader, pct = _leader(district_summary.prediction)
    leader_label = _label(scenario, leader)
    n_towns = len(district_summary.by_town)
    town_word = "town" if n_towns == 1 else "towns"
    undecided_pct = district_summary.prediction.get(scenario.undecided_id, 0.0)

    if leader == scenario.undecided_id:
        headline = f"# Still Undecided: {scenario.title} Ends Without a Verdict"
    else:
        headline = f"# {leader_label} Leads at {pct}% as {scenario.title} Comes to a Head"

    paragraphs: list[str] = [headline, ""]

    paragraphs.append(
        f"{district_summary.total_agents} residents across {n_towns} {town_word} spent the "
        f"simulation wrestling with one question: {scenario.question} Over "
        f"{district_summary.total_conversations} conversations — at kitchen tables, on "
        f"main streets, and in line at the places people actually talk — positions "
        f"hardened, softened, and occasionally flipped outright."
    )
    paragraphs.append("")

    if swings:
        top = swings[:3]
        movers = _join_names([s["name"] for s in top])
        first = top[0]
        paragraphs.append(
            f"The run's biggest movement came from {movers}. {first['name']} of "
            f"{first['town'].replace('-', ' ').title()} started the cycle leaning "
            f"{_label(scenario, first['from'])} and ended at "
            f"{_label(scenario, first['stance'])} with {first['confidence']}% confidence"
            + (
                f' — in their own words: "{first["reasoning"].rstrip(".")}."'
                if first.get("reasoning")
                else "."
            )
        )
    else:
        paragraphs.append(
            "For all the talk, nobody actually crossed the aisle: every resident ended "
            "the run where they began, though plenty came away more certain of why."
        )
    paragraphs.append("")

    if takeaways:
        paragraphs.append(
            f"The conversations kept circling the same ground. One exchange summed it up: "
            f"\"{takeaways[0].rstrip('.')}.\""
        )
        paragraphs.append("")

    town_lines = [
        f"{town.replace('-', ' ').title()} closed at "
        f"{_fmt_distribution(scenario, summary.opinion_distribution)}"
        for town, summary in district_summary.by_town.items()
    ]
    paragraphs.append(
        f"By the final round the map read like this: {'; '.join(town_lines)}. "
        f"District-wide that puts {leader_label} in front at {pct}%"
        + (
            f", with {undecided_pct}% still undecided"
            if undecided_pct > 0 and leader != scenario.undecided_id
            else ""
        )
        + f". Decision day is {scenario.config.dates.decision_day} — and if this run is "
        f"any guide, the last word hasn't been spoken yet."
    )

    return "\n".join(paragraphs)


# ─── Entry point ───────────────────────────────────────────────


async def generate_recap(scenario, district_summary, event_log: list, provider) -> str:
    """Produce the run's markdown recap: one provider call, template fallback.

    Never raises on provider trouble — the deterministic template is always
    available and always well-formed.
    """
    swings = _mine_swings(event_log, scenario)
    takeaways = _mine_takeaways(event_log)

    # The mock provider answers free-form prompts with one canned sentence —
    # skip straight to the template, which is strictly better prose.
    if getattr(provider, "provider_name", "") == "mock":
        return _template_recap(scenario, district_summary, swings, takeaways)

    try:
        result = await provider.call_agent(
            system_prompt=_RECAP_SYSTEM,
            messages=[
                {"role": "user", "content": _build_prompt(scenario, district_summary, swings, takeaways)}
            ],
            tools=None,
            max_tokens=RECAP_MAX_TOKENS,
        )
        if result.get("stop_reason") == "error":
            logger.warning(
                "Recap provider call errored (%s) — using template", result.get("error")
            )
            return _template_recap(scenario, district_summary, swings, takeaways)

        text = (result.get("text") or "").strip()
        if len(text) < _MIN_ACCEPTABLE_CHARS:
            logger.warning(
                "Recap response too short (%d chars) — using template", len(text)
            )
            return _template_recap(scenario, district_summary, swings, takeaways)

        if not text.lstrip().startswith("#"):
            leader, pct = _leader(district_summary.prediction)
            text = f"# {_label(scenario, leader)} Leads at {pct}%: {scenario.title}\n\n{text}"
        return text

    except Exception as e:
        logger.warning("Recap generation failed (%s) — using template", e)
        return _template_recap(scenario, district_summary, swings, takeaways)


def recap_headline(recap_markdown: str) -> str:
    """First markdown heading of a recap, stripped for list views."""
    for line in (recap_markdown or "").splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            return stripped.lstrip("#").strip()
        if stripped:
            return stripped[:120]
    return ""
