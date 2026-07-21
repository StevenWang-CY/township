"""
CLI tests (typer CliRunner) — zero credentials, zero network.

Covers:
  - `township scenarios` lists the shipped packages
  - `township new-scenario` scaffolds a package that loads via load_scenario
    and passes the persona-lint invariants out of the box
  - `township new-agent` writes frontmatter that parses and lands on the
    scenario's stance roster
  - `township run` completes a 1-round mock town run, printing the recap and
    the run directory

Everything is written to tmp dirs and cleaned up by pytest.
"""
import os

from typer.testing import CliRunner

from backend.cli import app
from backend.core.agent_loader import load_agent
from backend.core.scenario import load_scenario

runner = CliRunner()


def test_scenarios_lists_shipped_packages():
    result = runner.invoke(app, ["scenarios"])
    assert result.exit_code == 0, result.output
    assert "nj11-2026" in result.output
    assert "millbrook-budget" in result.output


def test_new_scenario_scaffold_loads_and_lints(tmp_path):
    result = runner.invoke(
        app, ["new-scenario", "test-town-vote", "--dir", str(tmp_path)]
    )
    assert result.exit_code == 0, result.output
    scenario_dir = tmp_path / "test-town-vote"
    assert (scenario_dir / "scenario.json").is_file()

    # Must LOAD — load_scenario validates config, towns, and agent leans.
    sc = load_scenario(scenario_dir)
    assert sc.id == "test-town-vote"
    assert sc.agents, "scaffold shipped no agents"

    # Persona-lint invariants (mirrors tests/test_persona_lint.py).
    valid = set(sc.valid_stance_ids)
    known_names = set()
    for defs in sc.agents.values():
        for d in defs:
            known_names.add(d.name.lower())
    for town, defs in sc.agents.items():
        assert town in sc.towns
        landmark_names = {
            lm.get("name") for lm in sc.towns[town].get("landmarks", [])
        }
        for d in defs:
            assert d.initial_lean in valid
            assert d.town == town
            for rel in d.relationships:
                assert rel.get("agent", "").lower() in known_names
            for entry in d.routine:
                assert entry.get("location") in landmark_names

    # Refuses to clobber an existing scenario.
    again = runner.invoke(
        app, ["new-scenario", "test-town-vote", "--dir", str(tmp_path)]
    )
    assert again.exit_code != 0


def test_new_agent_writes_valid_frontmatter(tmp_path):
    scaffold = runner.invoke(
        app, ["new-scenario", "test-agent-home", "--dir", str(tmp_path)]
    )
    assert scaffold.exit_code == 0, scaffold.output

    result = runner.invoke(
        app,
        ["new-agent", "test-agent-home", "townsville",
         "--name", "Jamie Q. Public", "--dir", str(tmp_path)],
    )
    assert result.exit_code == 0, result.output

    agent_path = tmp_path / "test-agent-home" / "agents" / "townsville" / "jamie-q-public.md"
    assert agent_path.is_file()

    definition = load_agent(agent_path)
    sc = load_scenario(tmp_path / "test-agent-home")
    assert definition.name == "Jamie Q. Public"
    assert definition.town == "townsville"
    assert definition.initial_lean == sc.undecided_id
    assert definition.top_concerns

    # The whole scenario still loads with the new resident in it.
    sc2 = load_scenario(tmp_path / "test-agent-home")
    assert any(
        d.name == "Jamie Q. Public" for defs in sc2.agents.values() for d in defs
    )

    # Unknown town is refused.
    bad = runner.invoke(
        app,
        ["new-agent", "test-agent-home", "atlantis",
         "--name", "Nobody Home", "--dir", str(tmp_path)],
    )
    assert bad.exit_code != 0


def test_run_single_town_mock_completes(tmp_path, monkeypatch):
    monkeypatch.setenv("TOWNSHIP_RUNS_DIR", str(tmp_path / "runs"))
    monkeypatch.setenv("MOCK_DELAY_S", "0")
    # The CLI sets LLM_PROVIDER itself; setting it here too makes monkeypatch
    # restore the pre-test value so the env never leaks into other tests.
    monkeypatch.setenv("LLM_PROVIDER", "mock")
    result = runner.invoke(
        app,
        ["run", "--scenario", "millbrook-budget", "--provider", "mock",
         "--town", "millbrook-village", "--rounds", "1"],
    )
    assert result.exit_code == 0, result.output
    assert "millbrook-village" in result.output
    assert "Run saved to:" in result.output
    # The recap headline made it to the terminal.
    assert "# " in result.output

    run_dirs = list((tmp_path / "runs").iterdir())
    assert len(run_dirs) == 1
    assert (run_dirs[0] / "recap.md").is_file()
    assert os.environ.get("TOWNSHIP_RUNS_DIR", "").startswith(str(tmp_path))
