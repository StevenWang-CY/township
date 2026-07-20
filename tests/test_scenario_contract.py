"""
Scenario-engine contract tests:
  - the nj11-2026 scenario package loads and validates
  - GET /api/scenario serves the bootstrap payload shape the frontend expects
  - build_tools() derives the FormOpinion enum from the scenario roster
  - validate_stance() coercion behavior
"""
from conftest import load_nj11_scenario
from fastapi.testclient import TestClient

from backend.core.scenario import validate_stance
from backend.main import app
from backend.tools.schemas import build_tools, form_opinion_tool

# ── nj11-2026 loads + validates ────────────────────────────────

def test_nj11_scenario_loads_and_matches_legacy_behavior():
    s = load_nj11_scenario()
    assert s.id == "nj11-2026"
    assert s.config.kind == "election"
    assert s.option_ids == ["mejia", "hathaway", "bond"]
    assert s.valid_stance_ids == ["mejia", "hathaway", "bond", "undecided"]
    assert s.town_ids == ["dover", "montclair", "parsippany", "randolph"]
    assert s.total_rounds == 5

    # Colors: options match the frontend CANDIDATE_COLORS constants; towns
    # come from each town JSON's accent_color.
    assert s.option_color == {
        "mejia": "#4A8FBF",
        "hathaway": "#C0792A",
        "bond": "#9A8E80",
        "undecided": "#D1D5DB",
    }
    assert s.town_color("dover") == "#E8763B"
    assert s.town_color("montclair") == "#6B5CE7"
    assert s.town_color("no-such-town") == "#888888"

    # Round plan encodes the exact legacy ladder.
    plan = s.config.round_plan
    assert [r.phases for r in plan] == [
        ["seed"],
        ["converse", "news"],
        ["converse", "opinion"],
        ["news", "converse", "opinion"],
        ["converse", "opinion", "decide"],
    ]
    assert [r.clock for r in plan] == ["08:00", "10:00", "13:00", "16:00", "19:00"]
    assert plan[1].news_ids == ["aca-subsidies", "ice-enforcement"]
    assert plan[3].news_ids == ["property-tax"]
    assert set(s.news_by_id) == {"aca-subsidies", "ice-enforcement", "property-tax"}

    # Cross-town machinery preserved verbatim.
    assert len(s.config.cross_town_pairs) == 6
    assert s.config.cross_town_meeting_place == "Morris County Community Event"
    assert s.config.weather_schedule == ["clear", "cloudy", "rain", "clear", "snow"]
    assert s.config.gossip_rounds == [2, 3]

    # 26 agents across 4 towns.
    assert sum(len(v) for v in s.agents.values()) == 26

    # The full context briefing renders options + debate + logistics extras.
    ctx = s.build_full_context()
    assert "Analilia Mejia" in ctx
    assert "Joe Hathaway" in ctx
    assert "DEBATE HIGHLIGHTS" in ctx
    assert "Medicare for All" in ctx
    # The short context is the legacy chat prose.
    assert "You're a voter in NJ-11" in s.context_short()
    assert "New Jersey's 11th Congressional District" in s.context_block()


# ── GET /api/scenario bootstrap payload ────────────────────────

def test_api_scenario_bootstrap_shape():
    with TestClient(app) as c:
        r = c.get("/api/scenario")
    assert r.status_code == 200
    data = r.json()

    assert data["id"] == "nj11-2026"
    assert data["title"]
    assert data["question"]
    assert data["decision_kind"] == "election"
    assert data["total_rounds"] == 5
    assert data["dates"]["decision_day"] == "2026-04-16"
    assert data["dates"]["prose"]

    assert [o["id"] for o in data["options"]] == ["mejia", "hathaway", "bond"]
    for option in data["options"]:
        for key in ("id", "name", "label", "color"):
            assert option.get(key), f"option missing {key}: {option}"
    assert data["undecided"] == {
        "id": "undecided", "label": "Undecided", "color": "#D1D5DB",
    }

    assert [t["id"] for t in data["towns"]] == [
        "dover", "montclair", "parsippany", "randolph",
    ]
    dover = data["towns"][0]
    assert dover["name"] == "Dover"
    assert dover["color"] == "#E8763B"
    assert dover["county"] == "Morris County"
    assert dover["tagline"]
    assert dover["population"] > 0


# ── build_tools: dynamic stance enum ───────────────────────────

def test_build_tools_enum_matches_scenario_roster():
    s = load_nj11_scenario()
    tools = build_tools(s)
    enum = tools["FormOpinion"]["input_schema"]["properties"]["candidate"]["enum"]
    assert enum == s.valid_stance_ids
    # Descriptions carry the scenario title.
    assert s.title in tools["FormOpinion"]["description"]
    assert s.title in tools["Discuss"]["description"]
    assert s.title in tools["ReactToNews"]["description"]
    # ClassifyInteraction stays scenario-independent.
    assert (
        tools["ClassifyInteraction"]["input_schema"]
        == build_tools(s)["ClassifyInteraction"]["input_schema"]
    )
    # The static default schema is still importable with the legacy enum
    # (providers/translation tests rely on the raw shape).
    static_enum = form_opinion_tool["input_schema"]["properties"]["candidate"]["enum"]
    assert static_enum == ["mejia", "hathaway", "bond", "undecided"]


# ── validate_stance coercion ───────────────────────────────────

def test_validate_stance_coercion():
    s = load_nj11_scenario()
    assert validate_stance("mejia", s) == "mejia"                 # exact
    assert validate_stance("Hathaway", s) == "hathaway"           # case-insensitive
    assert validate_stance(" BOND ", s) == "bond"                 # whitespace + case
    assert validate_stance("undecided", s) == "undecided"
    assert validate_stance("malinowski", s) == "undecided"        # hallucinated
    assert validate_stance("", s) == "undecided"                  # empty
    assert validate_stance(None, s) == "undecided"                # not a string
    assert validate_stance("I lean toward Mejia", s) == "undecided"  # prose
