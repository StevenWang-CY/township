"""
Campaign calendar — expands a scenario's ``campaign`` block into the flat list
of rounds the engine already knows how to run.

Each calendar day becomes a few beats (morning / midday / evening …) chosen
from the day-type template (weekday, saturday, sunday, election, aftermath);
each beat is a ``RoundSpec`` carrying its day, date, weekday, beat name,
scheduled news, an optional event and, once per day, the weather. The seed
phase is prepended to the very first round. Pure and deterministic: the same
manifest always expands to the same plan.
"""

from __future__ import annotations

from datetime import date, timedelta

from backend.core.scenario import CampaignSpec, RoundSpec, ScenarioConfig

WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")


def _template_for(campaign: CampaignSpec, day: date, election: date) -> tuple[str, list]:
    if day == election:
        name = "election"
    elif day > election:
        name = "aftermath"
    elif day.weekday() == 5:
        name = "saturday"
    elif day.weekday() == 6:
        name = "sunday"
    else:
        name = "weekday"
    beats = campaign.beats.get(name)
    if not beats:
        # Fall back to the weekday template for any day type left unauthored,
        # except election/aftermath which must be explicit to exist at all.
        if name in ("election", "aftermath"):
            return name, []
        beats = campaign.beats["weekday"]
    return name, beats


def expand_campaign(
    config: ScenarioConfig,
    *,
    days: int | None = None,
    until_election: bool = False,
) -> list[RoundSpec]:
    """Expand ``config.campaign`` into rounds (see the module docstring).

    ``days`` shortens the campaign to its last N days so the election is
    always reached; ``until_election`` drops the aftermath.
    """
    campaign = config.campaign
    if campaign is None:
        raise ValueError("scenario declares no campaign")
    election = date.fromisoformat(campaign.election_date)
    start = date.fromisoformat(campaign.start_date)
    if days is not None:
        if days < 1:
            raise ValueError("days must be at least 1")
        start = election - timedelta(days=days - 1)
    end = election if until_election else election + timedelta(days=campaign.aftermath_days)

    news_by_day: dict[tuple[int, str | None], list[tuple[str, list[str]]]] = {}
    for item in campaign.news_schedule:
        news_by_day.setdefault((item.day, item.beat), []).append((item.news_id, list(item.towns)))
    events_by_day: dict[tuple[int, str | None], list] = {}
    for ev in campaign.events:
        events_by_day.setdefault((ev.day, ev.beat), []).append(ev)

    rounds: list[RoundSpec] = []
    day_num = 0
    current = start
    # Day numbers count from the campaign's authored start so news/events keep
    # their authored days even when `days` trims the front of the campaign.
    authored_start = date.fromisoformat(campaign.start_date)
    while current <= end:
        day_num = (current - authored_start).days + 1
        template_name, beats = _template_for(campaign, current, election)
        weather = None
        if campaign.weather:
            weather = campaign.weather[(day_num - 1) % len(campaign.weather)]
        first_of_day = True
        for beat in beats:
            phases = list(beat.phases)
            news_ids: list[str] = []
            for key in ((day_num, beat.beat), (day_num, None)):
                for news_id, _towns in news_by_day.get(key, []):
                    if news_id not in news_ids:
                        news_ids.append(news_id)
            # A day-level news item lands on the first beat that carries news,
            # else on the first beat of the day.
            if (day_num, None) in news_by_day and "news" in phases:
                news_by_day.pop((day_num, None))
            elif (day_num, None) in news_by_day and first_of_day:
                for news_id, _towns in news_by_day.pop((day_num, None)):
                    if news_id not in news_ids:
                        news_ids.append(news_id)
                if "news" not in phases:
                    phases.insert(0, "news")
            event = None
            label = None
            for key in ((day_num, beat.beat), (day_num, None)):
                evs = events_by_day.get(key)
                if evs:
                    event = evs.pop(0).model_dump()
                    if not evs:
                        events_by_day.pop(key)
                    break
            if event:
                label = event["label"]
                if event.get("news_id") and event["news_id"] not in news_ids:
                    news_ids.append(event["news_id"])
                    if "news" not in phases:
                        phases.insert(0, "news")
            if "news" in phases and not news_ids:
                phases = [p for p in phases if p != "news"]
            if not phases:
                continue
            if not rounds:
                phases = ["seed", *[p for p in phases if p != "seed"]]
            rounds.append(
                RoundSpec(
                    round=len(rounds),
                    clock=beat.clock,
                    phases=phases,
                    news_ids=news_ids,
                    day=day_num,
                    date=current.isoformat(),
                    weekday=WEEKDAYS[current.weekday()],
                    beat=beat.beat,
                    label=label
                    or (
                        "Election day"
                        if template_name == "election"
                        else "The morning after"
                        if template_name == "aftermath"
                        else None
                    ),
                    event=event,
                    weather=weather if first_of_day else None,
                )
            )
            first_of_day = False
        current += timedelta(days=1)
    if not rounds:
        raise ValueError("campaign expanded to no rounds")
    return rounds


def campaign_facts(config: ScenarioConfig) -> dict | None:
    """The calendar summary the API exposes next to the quick round plan."""
    campaign = config.campaign
    if campaign is None:
        return None
    plan = expand_campaign(config)
    days = sorted({r.day for r in plan if r.day is not None})
    return {
        "start_date": campaign.start_date,
        "election_date": campaign.election_date,
        "days": len(days),
        "total_rounds": len(plan),
        "beats_per_day": round(len(plan) / max(1, len(days)), 2),
    }
