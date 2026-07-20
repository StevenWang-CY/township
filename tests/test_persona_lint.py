"""
Persona lint — data-quality gate for EVERY scenario package in scenarios/.

For each scenario directory that ships agents, verify:
  - every persona frontmatter parses into an AgentDefinition (load fails loudly)
  - every agent's initial_lean is on the scenario's stance roster
  - agent town directories correspond to towns/*.json files
  - relationship targets resolve to real agents in the same scenario (exact
    slug match)
  - routine locations mostly (>=80%) resolve to real landmark names in the
    agent's town (some prose locations are intentional, so this is
    warning-level, not exact)

New scenarios (e.g. scenarios/millbrook-budget) participate automatically the
moment they have a scenario.json and an agents/ directory.
"""
from pathlib import Path

import pytest
from conftest import REPO_ROOT

from backend.core.scenario import load_scenario

SCENARIOS_ROOT = Path(REPO_ROOT) / "scenarios"

SCENARIO_DIRS = sorted(
    p
    for p in (SCENARIOS_ROOT.iterdir() if SCENARIOS_ROOT.is_dir() else [])
    if (p / "scenario.json").is_file() and (p / "agents").is_dir()
)


def _agent_slug(name: str) -> str:
    """Mirror the orchestrator's agent_id derivation (name → slug)."""
    return name.lower().replace(" ", "-").replace(".", "")


@pytest.fixture(params=SCENARIO_DIRS, ids=lambda p: p.name)
def scenario(request):
    return load_scenario(request.param)


def test_at_least_one_scenario_ships_agents():
    assert SCENARIO_DIRS, "no scenario under scenarios/ has an agents/ directory"


def test_personas_parse_and_leans_are_valid(scenario):
    valid = set(scenario.valid_stance_ids)
    assert scenario.agents, f"{scenario.id}: agents/ directory is empty"
    for town, defs in scenario.agents.items():
        for d in defs:
            assert d.name, f"{scenario.id}/{town}: agent with empty name"
            assert d.initial_lean in valid, (
                f"{scenario.id}: {d.name} initial_lean {d.initial_lean!r} "
                f"not in stance roster {sorted(valid)}"
            )
            assert d.town == town, (
                f"{scenario.id}: {d.name} frontmatter town {d.town!r} does not "
                f"match its directory {town!r}"
            )


def test_agent_town_dirs_match_town_files(scenario):
    orphan_towns = set(scenario.agents) - set(scenario.towns)
    assert not orphan_towns, (
        f"{scenario.id}: agent town dirs without a towns/*.json file: "
        f"{sorted(orphan_towns)}"
    )


def test_relationships_resolve_to_real_agents(scenario):
    # Relationship targets may be written as agent slugs ("tom-kowalski") or
    # display names ("Tom Kowalski") — the engine's name lookup handles both,
    # so the lint accepts both. What it rejects is a target that matches no
    # agent in the scenario at all.
    known = set()
    for defs in scenario.agents.values():
        for d in defs:
            known.add(_agent_slug(d.name))
            known.add(d.name.lower())
    unresolved: list[str] = []
    for defs in scenario.agents.values():
        for d in defs:
            for rel in d.relationships:
                target = rel.get("agent") if isinstance(rel, dict) else None
                if not target:
                    unresolved.append(f"{d.name}: malformed relationship {rel!r}")
                elif target.lower() not in known:
                    unresolved.append(f"{d.name} -> {target}")
    assert not unresolved, (
        f"{scenario.id}: relationships referencing unknown agents:\n  "
        + "\n  ".join(unresolved)
    )


def test_routine_locations_mostly_resolve_to_landmarks(scenario):
    total = 0
    resolved = 0
    misses: list[str] = []
    for town, defs in scenario.agents.items():
        landmark_names = {
            lm.get("name")
            for lm in scenario.towns.get(town, {}).get("landmarks", [])
        }
        for d in defs:
            for entry in d.routine:
                location = entry.get("location") if isinstance(entry, dict) else None
                if not location:
                    continue
                total += 1
                if location in landmark_names:
                    resolved += 1
                else:
                    misses.append(f"{d.name} @ {location!r}")
    if total == 0:
        pytest.skip(f"{scenario.id}: no routines declared")
    ratio = resolved / total
    assert ratio >= 0.8, (
        f"{scenario.id}: only {resolved}/{total} ({ratio:.0%}) routine locations "
        f"resolve to town landmarks (need >=80%). Misses:\n  "
        + "\n  ".join(misses)
    )
