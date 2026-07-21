"""
Scenario-engine contract tests:
  - the nj11-2026 scenario package loads and validates
  - GET /api/scenario serves the bootstrap payload shape the frontend expects
  - build_tools() derives the FormOpinion enum from the scenario roster
  - validate_stance() coercion behavior
"""

import copy
import json
import shutil
from types import SimpleNamespace

import frontmatter
import pytest
from conftest import load_nj11_scenario
from starlette.testclient import TestClient

from backend.core.agent_loader import agent_id_from_name, validate_agent_ids
from backend.core.scenario import (
    CANONICAL_CORE_NOTICE,
    CrossTownPair,
    ResponsibleUseSpec,
    ScenarioConfig,
    _validate_scenario_references,
    load_scenario,
    load_scenario_with_fallback,
    validate_stance,
)
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
    assert s.responsible_use.core_notice == CANONICAL_CORE_NOTICE
    assert "summarized from public sources" in s.responsible_use.subjects_notice

    # Colors are scenario-owned: options come from the manifest and towns
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
    assert "Reported debate summary:" in ctx
    assert 'Key moment: "' not in ctx
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
    assert data["responsible_use"] == app.state.scenario.responsible_use.model_dump()
    assert data["responsible_use"]["core_notice"] == CANONICAL_CORE_NOTICE

    assert [o["id"] for o in data["options"]] == ["mejia", "hathaway", "bond"]
    for option in data["options"]:
        for key in ("id", "name", "label", "color"):
            assert option.get(key), f"option missing {key}: {option}"
    assert data["undecided"] == {
        "id": "undecided",
        "label": "Undecided",
        "color": "#D1D5DB",
    }

    assert [t["id"] for t in data["towns"]] == [
        "dover",
        "montclair",
        "parsippany",
        "randolph",
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
    # The static schema stays importable without leaking a shipped scenario;
    # provider/translation tests rely only on the raw tool shape.
    static_enum = form_opinion_tool["input_schema"]["properties"]["candidate"]["enum"]
    assert static_enum == ["option-a", "option-b", "undecided"]


# ── validate_stance coercion ───────────────────────────────────


def test_validate_stance_coercion():
    s = load_nj11_scenario()
    assert validate_stance("mejia", s) == "mejia"  # exact
    assert validate_stance("Hathaway", s) == "hathaway"  # case-insensitive
    assert validate_stance(" BOND ", s) == "bond"  # whitespace + case
    assert validate_stance("undecided", s) == "undecided"
    assert validate_stance("malinowski", s) == "undecided"  # hallucinated
    assert validate_stance("", s) == "undecided"  # empty
    assert validate_stance(None, s) == "undecided"  # not a string
    assert validate_stance("I lean toward Mejia", s) == "undecided"  # prose


def test_missing_package_never_falls_back_to_unrelated_root_data(tmp_path):
    """Civic facts must come from a named scenario package, never code/data shims."""
    from backend.core.scenario import load_scenario_with_fallback

    (tmp_path / "data" / "towns").mkdir(parents=True)
    with pytest.raises(FileNotFoundError, match="scenario package"):
        load_scenario_with_fallback("not-a-scenario", tmp_path)


def test_core_responsible_use_warning_cannot_be_replaced():
    with pytest.raises(ValueError, match="canonical simulation-not-a-poll"):
        ResponsibleUseSpec(
            core_notice="This exercise is only a simulation.",
            residents_notice="Residents are fictional.",
            subjects_notice="Subjects are documented.",
            outputs_notice="Outputs are synthetic.",
        )

    with pytest.raises(ValueError, match="exactly match"):
        ResponsibleUseSpec(
            core_notice=f"{CANONICAL_CORE_NOTICE} However this is a real poll.",
            residents_notice="Residents are fictional.",
            subjects_notice="Subjects are documented.",
            outputs_notice="Outputs are synthetic.",
        )

    spec = ResponsibleUseSpec(
        core_notice=CANONICAL_CORE_NOTICE,
        residents_notice="Residents are fictional.",
        subjects_notice="Subjects are documented.",
        outputs_notice="Outputs are synthetic.",
    )
    assert spec.core_notice == CANONICAL_CORE_NOTICE


def test_agent_ids_are_route_bounded_and_globally_unique():
    assert agent_id_from_name('Jennifer "Jen" Russo') == 'jennifer-"jen"-russo'
    with pytest.raises(ValueError, match="URL delimiters"):
        agent_id_from_name("A Resident/Elsewhere")

    roster = {
        "north": [SimpleNamespace(name="Jamie Q. Public")],
        "south": [SimpleNamespace(name="Jamie Q Public")],
    }
    with pytest.raises(ValueError, match="duplicate derived agent id"):
        validate_agent_ids(roster)


def test_manifest_rejects_frontend_and_runtime_incompatible_values():
    scenario = load_nj11_scenario()
    manifest = json.loads((scenario.scenario_dir / "scenario.json").read_text(encoding="utf-8"))

    invalid_kind = copy.deepcopy(manifest)
    invalid_kind["kind"] = "survey"
    with pytest.raises(ValueError, match="election.*vote"):
        ScenarioConfig.model_validate(invalid_kind)

    blank_label = copy.deepcopy(manifest)
    blank_label["options"][0]["label"] = "   "
    with pytest.raises(ValueError, match="must not be empty"):
        ScenarioConfig.model_validate(blank_label)

    invalid_weather = copy.deepcopy(manifest)
    invalid_weather["weather_schedule"][0] = "hurricane"
    with pytest.raises(ValueError, match="clear"):
        ScenarioConfig.model_validate(invalid_weather)

    partial_weather = copy.deepcopy(manifest)
    partial_weather["weather_schedule"] = partial_weather["weather_schedule"][:-1]
    with pytest.raises(ValueError, match="exactly one entry per round"):
        ScenarioConfig.model_validate(partial_weather)

    duplicate_phase = copy.deepcopy(manifest)
    duplicate_phase["round_plan"][0]["phases"] = ["seed", "seed"]
    with pytest.raises(ValueError, match="must not repeat"):
        ScenarioConfig.model_validate(duplicate_phase)

    stance_collision = copy.deepcopy(manifest)
    stance_collision["undecided"]["id"] = stance_collision["options"][0]["id"]
    with pytest.raises(ValueError, match="must be unique"):
        ScenarioConfig.model_validate(stance_collision)


def test_cross_town_pair_references_fail_at_scenario_load_boundary():
    scenario = load_nj11_scenario()
    config = scenario.config.model_copy(
        update={
            "cross_town_pairs": [
                CrossTownPair(
                    agents=["Carlos Restrepo", "No Such Resident"],
                    connection="A test connection.",
                )
            ]
        }
    )
    with pytest.raises(ValueError, match="unknown resident"):
        _validate_scenario_references(
            config,
            scenario.scenario_dir,
            scenario.towns,
            scenario.agents,
        )

    config = scenario.config.model_copy(
        update={
            "cross_town_pairs": [
                CrossTownPair(
                    agents=["Carlos Restrepo", "Sofia Ramirez"],
                    connection="A same-town test connection.",
                )
            ]
        }
    )
    with pytest.raises(ValueError, match="must cross towns"):
        _validate_scenario_references(
            config,
            scenario.scenario_dir,
            scenario.towns,
            scenario.agents,
        )


def _copy_nj11_package(tmp_path):
    source = load_nj11_scenario().scenario_dir
    target = tmp_path / source.name
    shutil.copytree(source, target)
    return target


def test_town_landmark_contract_fails_at_package_load(tmp_path):
    package = _copy_nj11_package(tmp_path)
    town_path = package / "towns" / "dover.json"
    town = json.loads(town_path.read_text(encoding="utf-8"))
    town["landmarks"] = [{"name": "Broken at runtime"}]
    town_path.write_text(json.dumps(town), encoding="utf-8")

    with pytest.raises(ValueError, match="landmark"):
        load_scenario(package)


def test_town_art_paths_and_landmark_extents_are_package_qualified(tmp_path):
    package = _copy_nj11_package(tmp_path)
    town_path = package / "towns" / "dover.json"
    town = json.loads(town_path.read_text(encoding="utf-8"))
    town["map"]["path"] = "assets/maps/another-scenario/dover.tmj"
    town_path.write_text(json.dumps(town), encoding="utf-8")
    with pytest.raises(ValueError, match="scenario-qualified"):
        load_scenario(package)

    package = tmp_path / "second" / "nj11-2026"
    shutil.copytree(load_nj11_scenario().scenario_dir, package)
    town_path = package / "towns" / "dover.json"
    town = json.loads(town_path.read_text(encoding="utf-8"))
    town["landmarks"][0].update({"x": 1190, "width": 20})
    town_path.write_text(json.dumps(town), encoding="utf-8")
    with pytest.raises(ValueError, match="1200x800"):
        load_scenario(package)


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (lambda metadata: metadata.update(top_concerns=[]), "top_concerns"),
        (
            lambda metadata: metadata.update(
                routine=[{"time": "not-a-clock", "location": "Town Hall", "activity": "Work"}]
            ),
            "routine time",
        ),
        (lambda metadata: metadata.update(top_concernz=["typo"]), "unknown persona"),
        (
            lambda metadata: metadata.update(
                relationships=[
                    {
                        "agent": "no-such-resident",
                        "type": "friend",
                        "strength": 0.5,
                        "context": "This target does not exist.",
                    }
                ]
            ),
            "unknown agents",
        ),
    ],
)
def test_malformed_persona_metadata_fails_at_package_load(tmp_path, mutation, message):
    package = _copy_nj11_package(tmp_path)
    persona_path = package / "agents" / "dover" / "colombian-restaurant-owner.md"
    post = frontmatter.load(str(persona_path))
    mutation(post.metadata)
    persona_path.write_text(frontmatter.dumps(post), encoding="utf-8")

    with pytest.raises(ValueError, match=message):
        load_scenario(package)


def test_rich_option_and_context_shapes_fail_at_package_load(tmp_path):
    package = _copy_nj11_package(tmp_path)
    option_path = package / "options" / "mejia.json"
    option = json.loads(option_path.read_text(encoding="utf-8"))
    option["positions"] = {"issue": "not a list"}
    option_path.write_text(json.dumps(option), encoding="utf-8")
    with pytest.raises(ValueError, match="positions"):
        load_scenario(package)

    package = tmp_path / "second" / "nj11-2026"
    shutil.copytree(load_nj11_scenario().scenario_dir, package)
    debate_path = package / "context" / "debate-excerpts.json"
    debate = json.loads(debate_path.read_text(encoding="utf-8"))
    debate["exchanges"] = {"topic": "not a list"}
    debate_path.write_text(json.dumps(debate), encoding="utf-8")
    with pytest.raises(ValueError, match="exchanges"):
        load_scenario(package)


def test_manifest_and_god_view_presets_reject_unknown_shapes(tmp_path):
    package = _copy_nj11_package(tmp_path)
    manifest_path = package / "scenario.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["typo_rounds"] = 5
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(ValueError, match="Extra inputs are not permitted"):
        load_scenario(package)

    package = tmp_path / "second" / "nj11-2026"
    shutil.copytree(load_nj11_scenario().scenario_dir, package)
    presets = package / "god-scenarios.json"
    presets.write_text(json.dumps({"id": "not-an-array"}), encoding="utf-8")
    with pytest.raises(ValueError, match="JSON array"):
        load_scenario(package)


@pytest.mark.parametrize(
    "relative_path",
    [
        "scenario.json",
        "towns/dover.json",
        "agents/dover/colombian-restaurant-owner.md",
        "context/logistics.json",
        "god-scenarios.json",
        "demo/simulation_cache.json",
    ],
)
def test_scenario_package_file_symlinks_cannot_escape_root(tmp_path, relative_path):
    package = _copy_nj11_package(tmp_path)
    target = package / relative_path
    outside = tmp_path / f"outside-{target.name}"
    outside.write_text(target.read_text(encoding="utf-8"), encoding="utf-8")
    target.unlink()
    target.symlink_to(outside)

    with pytest.raises(ValueError, match="must (?:stay within|not be a symbolic link)") as exc_info:
        load_scenario(package)
    assert str(outside) not in str(exc_info.value)


def test_named_scenario_symlink_cannot_escape_search_root(tmp_path):
    scenarios_root = tmp_path / "scenarios"
    scenarios_root.mkdir()
    outside = tmp_path / "downloaded-package"
    shutil.copytree(load_nj11_scenario().scenario_dir, outside)
    (scenarios_root / "nj11-2026").symlink_to(outside, target_is_directory=True)

    with pytest.raises(ValueError, match="must (?:stay within|not be a symbolic link)") as exc_info:
        load_scenario_with_fallback("nj11-2026", project_root=tmp_path)
    assert str(outside) not in str(exc_info.value)


def test_named_scenario_alias_symlink_is_rejected_even_inside_search_root(tmp_path):
    scenarios_root = tmp_path / "scenarios"
    scenarios_root.mkdir()
    real_package = scenarios_root / "nj11-2026"
    shutil.copytree(load_nj11_scenario().scenario_dir, real_package)
    (scenarios_root / "alias-package").symlink_to(real_package, target_is_directory=True)

    with pytest.raises(ValueError, match="must not be a symbolic link"):
        load_scenario_with_fallback("alias-package", project_root=tmp_path)
