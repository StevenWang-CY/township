"""The campaign calendar: expansion is deterministic, complete and shaped
the way the engine, the API and the frontend expect."""

from __future__ import annotations

import pytest
from conftest import load_nj11_scenario

from backend.core.scenario import ScenarioConfig, load_scenario_with_fallback
from backend.simulation.calendar import campaign_facts, expand_campaign


@pytest.fixture(scope="module")
def nj11():
    return load_nj11_scenario()


def test_expansion_is_deterministic_and_covers_every_day(nj11):
    a = expand_campaign(nj11.config)
    b = expand_campaign(nj11.config)
    assert [r.model_dump() for r in a] == [r.model_dump() for r in b]
    days = sorted({r.day for r in a})
    assert days == list(range(1, 23)), "21 campaign days plus one aftermath day"
    assert [r.round for r in a] == list(range(len(a)))
    assert a[0].phases[0] == "seed" and all("seed" not in r.phases for r in a[1:])
    # Every day starts with its weather, once.
    for d in days:
        beats = [r for r in a if r.day == d]
        assert beats[0].weather is not None
        assert all(r.weather is None for r in beats[1:])
    assert 60 <= len(a) <= 70


def test_day_types_election_and_aftermath(nj11):
    plan = expand_campaign(nj11.config)
    election = [r for r in plan if r.date == "2026-04-16"]
    assert [r.beat for r in election] == ["early", "midday", "evening", "night"]
    assert election[-1].phases == ["results"]
    assert all("vote" in r.phases for r in election[:-1])
    after = [r for r in plan if r.date == "2026-04-17"]
    assert len(after) == 1 and after[0].phases == ["aftermath"]
    sundays = [r for r in plan if r.weekday == "sunday"]
    assert sundays and any("reflect" in r.phases for r in sundays)
    assert all(
        r.weekday in ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
        for r in plan
    )


def test_news_and_events_land_on_their_days(nj11):
    plan = expand_campaign(nj11.config)
    by_news = {
        nid: [r.day for r in plan if nid in r.news_ids]
        for nid in ("aca-subsidies", "ice-enforcement", "property-tax", "bond-record")
    }
    assert by_news["aca-subsidies"] == [2]
    assert by_news["ice-enforcement"] == [6]
    assert by_news["property-tax"] == [12]
    assert by_news["bond-record"] == [18]
    # Beats without a scheduled item drop the news phase entirely.
    assert all(("news" in r.phases) == bool(r.news_ids) for r in plan)
    debate = [r for r in plan if r.event and r.event["kind"] == "debate"]
    assert (
        len(debate) == 1 and debate[0].day == 9 and debate[0].label == "Debate night in Montclair"
    )
    assert "debate-night" in debate[0].news_ids and "news" in debate[0].phases


def test_days_and_until_election_controls(nj11):
    short = expand_campaign(nj11.config, days=5)
    assert sorted({r.date for r in short})[0] == "2026-04-12"
    assert any(r.date == "2026-04-16" for r in short), "the election is always reached"
    assert short[0].phases[0] == "seed"
    trimmed = expand_campaign(nj11.config, until_election=True)
    assert max(r.date for r in trimmed) == "2026-04-16"
    with pytest.raises(ValueError):
        expand_campaign(nj11.config, days=0)


def test_presets_and_facts(nj11):
    assert nj11.presets == ["quick", "campaign"]
    assert [r.round for r in nj11.plan_for("quick")] == [0, 1, 2, 3, 4]
    assert len(nj11.plan_for("campaign")) == len(expand_campaign(nj11.config))
    facts = campaign_facts(nj11.config)
    assert facts and facts["days"] == 22 and facts["election_date"] == "2026-04-16"
    with pytest.raises(ValueError):
        nj11.plan_for("weekly")


def test_scenario_without_campaign_only_has_the_quick_preset(nj11):
    raw = nj11.config.model_dump()
    raw.pop("campaign")
    cfg = ScenarioConfig.model_validate(raw)
    assert cfg.campaign is None
    with pytest.raises(ValueError):
        expand_campaign(cfg)


def test_millbrook_campaign_expands():
    sc = load_scenario_with_fallback("millbrook-budget")
    plan = sc.plan_for("campaign")
    assert sorted({r.day for r in plan}) == list(range(1, 12))
    assert any(r.phases == ["results"] for r in plan)
