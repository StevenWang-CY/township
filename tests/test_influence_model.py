"""The deterministic influence model (backend/simulation/influence.py) and
attribution (attribution.py): seeds, pushes, read-outs, ballots, digests."""

from __future__ import annotations

import random

import pytest
from conftest import load_nj11_scenario

from backend.core.types import AgentDefinition, AgentState, Opinion
from backend.simulation import attribution
from backend.simulation.influence import (
    EPS_GAP,
    UNDECIDED_MARGIN,
    InfluenceModel,
)


@pytest.fixture(scope="module")
def scenario():
    return load_nj11_scenario()


@pytest.fixture(scope="module")
def model(scenario):
    return InfluenceModel(scenario)


def _defn(
    name: str, lean: str = "undecided", registration: str = "unaffiliated", concerns=None, **extra
) -> AgentDefinition:
    return AgentDefinition(
        name=name,
        town="dover",
        description="test resident",
        age=40,
        occupation="tester",
        household="solo",
        income_bracket="~$50k",
        language="English",
        political_registration=registration,
        initial_lean=lean,
        top_concerns=concerns or ["healthcare costs", "property taxes"],
        tools=["Discuss", "FormOpinion"],
        system_prompt="You are a test resident.",
        **extra,
    )


def _agent(
    model: InfluenceModel, defn: AgentDefinition, stance: str | None = None, seed: int = 1
) -> AgentState:
    rng = random.Random(seed)
    state = AgentState(
        agent_id=defn.name.lower().replace(" ", "-"), definition=defn, current_location="Town Park"
    )
    state.beliefs = model.seed(defn, rng, stance=stance)
    r = model.readout(state.beliefs)
    state.opinions.append(
        Opinion(
            candidate=r.stance,
            confidence=r.confidence,
            reasoning="seed",
            top_issues=defn.top_concerns[:3],
            round_number=0,
        )
    )
    return state


def test_issue_space_and_keyword_matching(model):
    # NJ-11 declares issues (authored in scenario.json) or falls back to positions; either way
    # a healthcare concern and an ICE headline map to distinct issues.
    health = model.match_issue("healthcare costs (no employer insurance, ACA marketplace)")
    ice = model.match_issue("ICE Enforcement Increases in Morris County")
    assert health is not None and ice is not None
    assert health != ice
    assert model.match_issue("") is None


def test_seed_is_deterministic_and_respects_the_declared_lean(model):
    d = _defn("Firm Dem", lean="mejia", registration="democrat")
    a = model.seed(d, random.Random(7))
    b = model.seed(d, random.Random(7))
    assert a.utilities == b.utilities
    assert model.readout(a).stance == "mejia"
    assert 0 <= model.readout(a).confidence <= 95


def test_undecided_listener_flips_after_firm_partners_and_cites_the_conversation(model):
    listener = _agent(model, _defn("Wavering Walt", lean="undecided"), stance="undecided")
    speaker = _agent(
        model, _defn("Firm Fran", lean="mejia", registration="democrat"), stance="mejia", seed=3
    )
    assert listener.current_opinion.candidate == "undecided"
    before = model.readout(listener.beliefs).margin
    for i in range(3):
        entry = model.apply_exchange(
            listener,
            speaker,
            "healthcare costs and the ACA",
            round_num=1,
            ref=f"conv:c{i}",
            relationship=0.6,
        )
        assert entry is not None and entry.delta > 0
    after = model.readout(listener.beliefs)
    assert after.margin > before
    assert after.stance == "mejia"
    refs = attribution.from_ledger(listener, since_round=1, new_stance="mejia")
    assert refs and refs[0].ref.startswith("conv:") and refs[0].direction == "toward"


def test_firm_opposite_agent_dismisses_arguments_from_far_away(model):
    firm = _agent(
        model,
        _defn("Rock Rita", lean="hathaway", registration="republican", persuadability=0.05),
        stance="hathaway",
    )
    # Widen the gap artificially so the bounded-confidence rule triggers.
    firm.beliefs.utilities["hathaway"] += EPS_GAP + 1.0
    speaker = _agent(
        model, _defn("Firm Fran", lean="mejia", registration="democrat"), stance="mejia", seed=3
    )
    entry = model.apply_exchange(
        firm, speaker, "immigration enforcement", round_num=2, ref="conv:far"
    )
    assert entry is not None and entry.delta == 0.0
    assert model.readout(firm.beliefs).stance == "hathaway"


def test_news_effect_derives_a_reaction_and_moves_utilities(model, scenario):
    agent = _agent(
        model,
        _defn("News Nadia", lean="undecided", concerns=["healthcare costs", "ACA premiums"]),
        stance="undecided",
    )
    item = scenario.news_by_id["aca-subsidies"]
    entries, reaction = model.apply_news(agent, item, round_num=1, ref="news:aca-subsidies")
    assert entries, "the headline should push at least one option"
    assert reaction["impact_on_vote"] in {
        "changes_mind",
        "strengthens_current",
        "weakens_current",
        "no_effect",
    }
    assert reaction["emotional_response"] in {
        "angry",
        "hopeful",
        "anxious",
        "indifferent",
        "confused",
    }
    assert any(e.ref == "news:aca-subsidies" for e in agent.beliefs.ledger)


def test_confidence_is_monotone_in_margin(model):
    agent = _agent(model, _defn("Mono Mo", lean="mejia", registration="democrat"), stance="mejia")
    confs = []
    for bump in (0.0, 0.2, 0.5, 1.0):
        agent.beliefs.utilities["mejia"] += bump
        confs.append(model.readout(agent.beliefs).confidence)
    assert confs == sorted(confs)
    assert model.readout(agent.beliefs).margin >= UNDECIDED_MARGIN


def test_ballot_rules_and_forced_abstention(model):
    decided = _agent(
        model, _defn("Decided Dee", lean="mejia", registration="democrat"), stance="mejia"
    )
    b = model.ballot(decided, random.Random(1), round_num=4)
    assert b.option == "mejia"
    # A resident whose turnout is 0 always abstains.
    stay_home = _agent(
        model,
        _defn("Home Hal", lean="hathaway", registration="republican", turnout=0.0),
        stance="hathaway",
    )
    assert model.ballot(stay_home, random.Random(2), round_num=4).option is None
    # Undecided but loyal → the party's option.
    loyal = _agent(
        model,
        _defn(
            "Loyal Lou", lean="undecided", registration="republican", party_loyalty=0.6, turnout=1.0
        ),
        stance="undecided",
    )
    loyal.beliefs.utilities = {o: 0.0 for o in loyal.beliefs.utilities}
    assert model.ballot(loyal, random.Random(3), round_num=4).option == "hathaway"
    # Undecided, unaffiliated, no lean → blank ballot.
    blank = _agent(model, _defn("Blank Bea", lean="undecided", turnout=1.0), stance="undecided")
    blank.beliefs.utilities = {o: 0.0 for o in blank.beliefs.utilities}
    blank.opinions[-1] = Opinion(
        candidate="undecided", confidence=20, reasoning="", top_issues=[], round_number=0
    )
    assert model.ballot(blank, random.Random(4), round_num=4).option is None


def test_validate_influences_keeps_known_refs_and_fills_from_ledger(model):
    listener = _agent(model, _defn("Cite Cy", lean="undecided"), stance="undecided")
    speaker = _agent(
        model, _defn("Firm Fran", lean="mejia", registration="democrat"), stance="mejia", seed=3
    )
    model.apply_exchange(listener, speaker, "healthcare", round_num=2, ref="conv:abc")
    listener.remember("conversation", 2, "Talked with Fran about healthcare.", refs=["conv:abc"])
    valid, cited = attribution.validate_influences(
        [
            {"ref": "conv:abc", "direction": "toward", "weight": 1.7, "note": "she had numbers"},
            {"ref": "conv:nope", "weight": 1},
        ],
        listener,
        since_round=1,
        new_stance="mejia",
    )
    assert cited is True
    assert [v.ref for v in valid] == ["conv:abc"] and valid[0].weight == 1.0
    filled, cited2 = attribution.validate_influences(
        [], listener, since_round=1, new_stance="mejia"
    )
    assert cited2 is False and filled and filled[0].ref == "conv:abc"


def test_digest_lists_bracketed_ids_and_stays_within_the_cap(model):
    agent = _agent(model, _defn("Digest Dan", lean="undecided"), stance="undecided")
    for i in range(12):
        agent.remember(
            "conversation",
            1 + i % 2,
            f"Talked about thing {i} at length with a neighbour who had opinions.",
            refs=[f"conv:{i}"],
            salience=0.3 + (i % 3) * 0.2,
        )
    text = attribution.build_digest(agent, since_round=1, model=model, latest_round=2)
    assert "[conv:" in text
    assert len(text) <= attribution.DIGEST_CHAR_CAP
    assert "cite only the bracketed ids" in text


def test_two_runs_of_the_same_pushes_are_identical(model, scenario):
    def run():
        a = _agent(model, _defn("Twin A", lean="undecided"), stance="undecided", seed=11)
        s = _agent(
            model, _defn("Firm Fran", lean="mejia", registration="democrat"), stance="mejia", seed=3
        )
        model.apply_exchange(a, s, "healthcare", 1, "conv:1")
        model.apply_news(a, scenario.news_by_id["ice-enforcement"], 1, "news:ice-enforcement")
        return a.beliefs.model_dump()

    assert run() == run()
