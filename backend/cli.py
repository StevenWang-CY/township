"""
Township CLI — `township serve | run | replay | scenarios | new-scenario | new-agent`.

Plain terminal output, no TUI. Heavy imports happen inside commands so
`township --help` stays instant.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import tempfile
from pathlib import Path

import typer

app = typer.Typer(
    name="township",
    help="Township — a civic deliberation engine. AI residents deliberate in a living pixel town.",
    no_args_is_help=True,
    add_completion=False,
)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BUNDLED_SCENARIOS_DIR = PROJECT_ROOT / "scenarios"
FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"

# Shared option singleton (module-level so it isn't re-built per call — B008).
_DEST_DIR_OPTION = typer.Option(
    None, "--dir", help="Scenarios parent directory (default: scenarios/)."
)


_SCENARIO_ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def _authoring_scenarios_dir() -> Path:
    """Writable default for scenario scaffolds in source and wheel installs."""
    override = os.environ.get("TOWNSHIP_SCENARIOS_DIR")
    if override:
        path = Path(override).expanduser()
        return path if path.is_absolute() else Path.cwd() / path
    if (PROJECT_ROOT / "pyproject.toml").is_file():
        return BUNDLED_SCENARIOS_DIR
    return Path.cwd() / "scenarios"


def _slug(name: str) -> str:
    """Turn a display name into a safe filename stem."""
    if "/" in name or "\\" in name or "\0" in name:
        raise ValueError("agent name cannot contain path separators")
    slug = re.sub(r"[^\w]+", "-", name.casefold()).strip("-_")
    slug = re.sub(r"[-_]+", "-", slug)
    if not slug:
        raise ValueError("agent name must contain at least one letter or number")
    return slug


def _direct_child(root: Path, child: str, *, label: str) -> Path:
    """Return ``root/child`` only when it resolves to a direct child of root."""
    resolved_root = root.resolve()
    candidate = resolved_root / child
    if candidate.is_symlink():
        raise ValueError(f"{label} must not be a symbolic link")
    resolved_child = candidate.resolve()
    if resolved_child.parent != resolved_root:
        raise ValueError(f"{label} must resolve directly beneath {resolved_root}")
    return resolved_child


def _scenario_child(root: Path, scenario_id: str) -> Path:
    if not _SCENARIO_ID_RE.fullmatch(scenario_id):
        raise ValueError("scenario id must use lowercase letters, numbers, and single hyphens")
    return _direct_child(root, scenario_id, label="scenario directory")


@app.command()
def serve(
    host: str = typer.Option(
        "127.0.0.1",
        help="Bind address. Use 0.0.0.0 only for an intentionally protected deployment.",
    ),
    port: int = typer.Option(8001, help="Port."),
    scenario: str = typer.Option(None, help="Scenario id (sets SCENARIO)."),
    provider: str = typer.Option(None, help="LLM provider (sets LLM_PROVIDER)."),
    reload: bool = typer.Option(False, help="Auto-reload on code changes."),
):
    """Start the Township API server (backend.main:app)."""
    if scenario:
        os.environ["SCENARIO"] = scenario
    if provider:
        os.environ["LLM_PROVIDER"] = provider
    if not (FRONTEND_DIST / "index.html").is_file():
        typer.secho(
            "API-only mode: no compiled Township UI is bundled here. "
            "Use the Docker image for the complete app, or run the frontend "
            "from a source checkout.",
            fg=typer.colors.YELLOW,
            err=True,
        )
    import uvicorn

    uvicorn.run("backend.main:app", host=host, port=port, reload=reload)


@app.command()
def run(
    scenario: str = typer.Option(None, help="Scenario id (default: SCENARIO env or nj11-2026)."),
    town: str = typer.Option(None, help="Run a single town instead of the whole district."),
    rounds: int = typer.Option(None, help="Cap the run at the first N rounds of the plan."),
    provider: str = typer.Option(None, help="LLM provider (sets LLM_PROVIDER)."),
):
    """Run a headless simulation, then print the recap and the run directory."""
    if provider:
        os.environ["LLM_PROVIDER"] = provider
    # Headless runs don't need the mock's animation pacing.
    os.environ.setdefault("MOCK_DELAY_S", "0")

    from .core.event_bus import EventBus
    from .core.scenario import load_scenario_with_fallback
    from .providers import create_provider
    from .simulation.orchestrator import SimulationOrchestrator

    scenario_id = scenario or os.environ.get("SCENARIO", "nj11-2026")
    sc = load_scenario_with_fallback(scenario_id)
    llm = create_provider(max_concurrent=10)
    bus = EventBus()
    orch = SimulationOrchestrator(anthropic_client=llm, event_bus=bus, scenario=sc)

    n_agents = sum(len(v) for v in orch.agent_states.values())
    provider_name = llm.get_usage_report().get("provider", "?")
    typer.echo(f"Scenario: {sc.id} — {sc.title}")
    typer.echo(
        f"Provider: {provider_name} | {n_agents} agents | towns: {', '.join(orch.agent_states)}"
    )

    async def _on_round_started(e):
        where = f" [{e.town}]" if getattr(e, "town", None) else ""
        typer.echo(f"  round {e.round}/{e.total_rounds - 1}{where} started")

    async def _on_round_ended(e):
        where = f" [{e.town}]" if getattr(e, "town", None) else ""
        typer.echo(f"  round {e.round}{where} done")

    async def _on_news(e):
        typer.echo(f"  news: {e.headline}")

    bus.subscribe("round_started", _on_round_started)
    bus.subscribe("round_ended", _on_round_ended)
    bus.subscribe("news_injected", _on_news)

    if town:
        summary = asyncio.run(orch.run_single_town(town, rounds))
        typer.echo(
            f"\n{town}: {summary.total_conversations} conversations, "
            f"distribution {summary.opinion_distribution}"
        )
    else:
        district = asyncio.run(orch.run_full_simulation(rounds))
        typer.echo(f"\nDistrict prediction: {district.prediction}")

    usage = llm.get_usage_report()
    typer.echo(
        f"Cost: ${usage.get('total_cost', 0):.4f} across {usage.get('total_calls', 0)} calls"
    )
    if orch.last_recap:
        typer.echo("\n" + orch.last_recap)
    if orch.last_run_dir:
        typer.echo(f"\nRun saved to: {orch.last_run_dir}")


@app.command()
def replay(
    run_id: str = typer.Option(None, "--run-id", help="Replay a persisted runs/<run_id>."),
    demo: bool = typer.Option(False, "--demo", help="Replay the active scenario's demo cache."),
    scenario: str = typer.Option(None, help="Scenario id for --demo (default: SCENARIO env)."),
    speed: float = typer.Option(10.0, help="Playback speed multiplier."),
):
    """Replay a cached run to the terminal (speech, opinions, rounds)."""
    from .core.artifacts import (
        LEGACY_ARTIFACT_MESSAGE,
        ArtifactFormatError,
        ArtifactPrivacyError,
    )
    from .core.event_bus import EventBus
    from .simulation.replay import replay as replay_events

    if run_id:
        from .routes.runs import resolve_run_dir

        run_dir = resolve_run_dir(run_id)
        path = run_dir / "events.json" if run_dir is not None else None
    elif demo:
        from .core.scenario import load_scenario_with_fallback

        scenario_id = scenario or os.environ.get("SCENARIO", "nj11-2026")
        path = load_scenario_with_fallback(scenario_id).demo_cache_path
    else:
        typer.echo("Pass --run-id <id> or --demo (see `township run` / /api/runs).", err=True)
        raise typer.Exit(code=2)

    if path is None or not path.is_file():
        typer.echo("No replayable events found.", err=True)
        raise typer.Exit(code=1)

    def _fmt(e) -> str | None:
        t = getattr(e, "type", "")
        if t == "round_started":
            return f"── Round {e.round} ──"
        if t == "agent_speech":
            return f"{e.agent_name}: {e.text[:100]}"
        if t == "opinion_changed":
            old = e.old_opinion.candidate if e.old_opinion else "no recorded stance"
            return f"* {e.agent_name} now leans {e.new_opinion.candidate} (was {old})"
        if t == "news_injected":
            return f"NEWS: {e.headline}"
        if t == "simulation_ended":
            return "── Simulation ended ──"
        return None

    bus = EventBus()

    async def _printer(e):
        line = _fmt(e)
        if line:
            typer.echo(line)

    bus.subscribe("*", _printer)
    try:
        asyncio.run(replay_events(bus, str(path), speed))
    except ArtifactPrivacyError as exc:
        typer.echo(LEGACY_ARTIFACT_MESSAGE, err=True)
        raise typer.Exit(code=1) from exc
    except (ArtifactFormatError, json.JSONDecodeError, OSError) as exc:
        typer.echo("Replay artifact is invalid or unreadable.", err=True)
        raise typer.Exit(code=1) from exc


@app.command()
def scenarios():
    """List every scenario package under scenarios/."""
    from .core.scenario import load_scenario, scenario_search_roots

    by_id: dict[str, Path] = {}
    for root in scenario_search_roots():
        if not root.is_dir():
            continue
        for path in sorted(root.iterdir()):
            if (path / "scenario.json").is_file():
                by_id.setdefault(path.name, path)
    found = [by_id[scenario_id] for scenario_id in sorted(by_id)]
    if not found:
        typer.echo("No scenarios found.")
        raise typer.Exit(code=1)
    for path in found:
        try:
            sc = load_scenario(path)
            n_agents = sum(len(v) for v in sc.agents.values())
            typer.echo(
                f"{sc.id:<20} {sc.title} — {len(sc.towns)} towns, "
                f"{n_agents} agents, {sc.total_rounds} rounds"
            )
        except Exception as e:
            typer.echo(f"{path.name:<20} INVALID: {e}")


# ─── Scaffolding templates ─────────────────────────────────────


def _template_scenario_json(scenario_id: str) -> dict:
    return {
        "id": scenario_id,
        "title": scenario_id.replace("-", " ").title(),
        "question": "What should the town decide? (Edit scenario.json to frame your question.)",
        "kind": "vote",
        "options": [
            {"id": "option-a", "name": "Option A", "label": "Option A", "color": "#4A8FBF"},
            {"id": "option-b", "name": "Option B", "label": "Option B", "color": "#C0792A"},
        ],
        "undecided": {"id": "undecided", "label": "Undecided", "color": "#D1D5DB"},
        "dates": {
            "decision_day": "2026-12-01",
            "prose": "The town decides on December 1, 2026.",
        },
        "context_md": (
            "You are a resident of Townsville. The community faces a decision "
            "between Option A and Option B on December 1, 2026."
        ),
        "context_short_md": "Townsville decides between Option A and Option B on December 1, 2026.",
        "responsible_use": {
            "core_notice": (
                "Township is a simulation, not a poll. Its outputs do not measure "
                "real public opinion and must never be presented as if they do."
            ),
            "residents_notice": (
                "Residents in this scaffold are fictional characters created for simulation."
            ),
            "subjects_notice": (
                "Replace this scaffold notice with accurate context and sourcing for any "
                "people, places, or institutions your scenario references."
            ),
            "outputs_notice": (
                "Outputs are synthetic scenario results, not measurements, predictions, "
                "or evidence about real people."
            ),
        },
        "round_plan": [
            {"round": 0, "phases": ["seed"], "clock": "08:00"},
            {"round": 1, "phases": ["converse", "opinion"], "clock": "12:00"},
            {"round": 2, "phases": ["converse", "opinion", "decide"], "clock": "18:00"},
        ],
        "news": [],
        "weather_schedule": ["clear", "cloudy", "clear"],
        "gossip_rounds": [],
        "town_order": ["townsville"],
    }


_TEMPLATE_TOWN = {
    "name": "Townsville",
    "tagline": "A town deciding together",
    "accent_color": "#7A9E7E",
    "demographics": {"population": 1000},
    "character": "A small template town. Replace with your own texture.",
    "landmarks": [
        {
            "name": "Town Hall",
            "x": 500,
            "y": 300,
            "width": 200,
            "height": 150,
            "color": "#8B7355",
            "type": "civic",
            "description": "Where the decision happens.",
        },
        {
            "name": "Main Street Cafe",
            "x": 200,
            "y": 500,
            "width": 150,
            "height": 100,
            "color": "#C9A66B",
            "type": "commercial",
            "description": "Where people actually talk.",
        },
    ],
}


def _persona_md(
    name: str,
    town: str,
    lean: str,
    description: str,
    occupation: str,
    counterpart: str | None = None,
    routine_locations: tuple[str, str] = ("Main Street Cafe", "Town Hall"),
) -> str:
    import frontmatter

    metadata = {
        "name": name,
        "town": town,
        "description": description,
        "age": 45,
        "occupation": occupation,
        "household": "Lives locally.",
        "income_bracket": "~$60k",
        "language": "English",
        "political_registration": "unaffiliated",
        "initial_lean": lean,
        "top_concerns": ["the town's future", "keeping taxes reasonable"],
        "routine": [
            {
                "time": "09:00",
                "location": routine_locations[0],
                "activity": "Morning coffee and talk",
            },
            {
                "time": "14:00",
                "location": routine_locations[1],
                "activity": "Errands and gossip",
            },
        ],
        "relationships": (
            [
                {
                    "agent": counterpart,
                    "type": "neighbor",
                    "strength": 0.5,
                    "context": "They talk over the fence most mornings",
                }
            ]
            if counterpart
            else []
        ),
        "idle_thoughts": ["I keep going back and forth on this decision."],
    }
    content = (
        f"You are {name}, a resident of the town. Write this persona in second person: "
        "their history, voice, worries, and what would change their mind. "
        "The richer this file, the better the deliberation."
    )
    return frontmatter.dumps(frontmatter.Post(content, **metadata)) + "\n"


def _publish_new_text(path: Path, text: str) -> None:
    """Atomically create a complete new file without overwriting a race winner."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.link(temporary, path)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


@app.command("new-scenario")
def new_scenario(
    scenario_id: str = typer.Argument(..., help="New scenario id (lowercase, hyphens)."),
    dest: Path = _DEST_DIR_OPTION,
):
    """Scaffold a minimal scenario package that loads and lints out of the box."""
    root = dest or _authoring_scenarios_dir()
    try:
        target = _scenario_child(root, scenario_id)
    except ValueError as exc:
        typer.echo(str(exc), err=True)
        raise typer.Exit(code=2) from exc
    if target.exists():
        typer.echo(f"{target} already exists — refusing to overwrite.", err=True)
        raise typer.Exit(code=1)

    (target / "towns").mkdir(parents=True)
    (target / "agents" / "townsville").mkdir(parents=True)
    (target / "options").mkdir()

    (target / "scenario.json").write_text(
        json.dumps(_template_scenario_json(scenario_id), indent=2) + "\n", encoding="utf-8"
    )
    (target / "towns" / "townsville.json").write_text(
        json.dumps(_TEMPLATE_TOWN, indent=2) + "\n", encoding="utf-8"
    )
    (target / "agents" / "townsville" / "first-resident.md").write_text(
        _persona_md(
            "Alex Morgan",
            "townsville",
            "option-a",
            "Longtime resident who backs Option A.",
            "Shop owner",
            counterpart="Riley Chen",
        ),
        encoding="utf-8",
    )
    (target / "agents" / "townsville" / "second-resident.md").write_text(
        _persona_md(
            "Riley Chen",
            "townsville",
            "undecided",
            "Newer arrival still weighing both options.",
            "Teacher",
            counterpart="Alex Morgan",
        ),
        encoding="utf-8",
    )

    # Prove the scaffold actually loads before declaring success.
    from .core.scenario import load_scenario

    sc = load_scenario(target)
    typer.echo(f"Created scenario {sc.id!r} at {target}")
    typer.echo("Next: edit scenario.json, add towns/, and write personas in agents/<town>/.")
    typer.echo(f"Try it: township run --scenario {scenario_id} --provider mock")


@app.command("new-agent")
def new_agent(
    scenario_id: str = typer.Argument(..., help="Existing scenario id."),
    town: str = typer.Argument(..., help="Town directory the agent lives in."),
    name: str = typer.Option(..., "--name", help='Display name, e.g. "Jane Doe".'),
    dest: Path = _DEST_DIR_OPTION,
):
    """Add a persona skeleton with valid frontmatter for the scenario's stances."""
    from .core.agent_loader import agent_id_from_name
    from .core.scenario import load_scenario

    root = dest or _authoring_scenarios_dir()
    try:
        scenario_dir = _scenario_child(root, scenario_id)
    except ValueError as exc:
        typer.echo(str(exc), err=True)
        raise typer.Exit(code=2) from exc
    if not (scenario_dir / "scenario.json").is_file():
        typer.echo(f"No scenario at {scenario_dir}", err=True)
        raise typer.Exit(code=1)
    sc = load_scenario(scenario_dir)
    if town not in sc.towns:
        typer.echo(f"Unknown town {town!r} — towns: {', '.join(sc.town_ids)}", err=True)
        raise typer.Exit(code=1)

    try:
        new_agent_id = agent_id_from_name(name)
        existing_ids = {
            agent_id_from_name(definition.name)
            for definitions in sc.agents.values()
            for definition in definitions
        }
        if new_agent_id in existing_ids:
            raise ValueError(f"resident id {new_agent_id!r} already exists in this scenario")
        agents_dir = _direct_child(scenario_dir, "agents", label="scenario agents directory")
        town_dir = _direct_child(agents_dir, town, label="agent town directory")
        path = _direct_child(town_dir, f"{_slug(name)}.md", label="agent file")
    except ValueError as exc:
        typer.echo(str(exc), err=True)
        raise typer.Exit(code=2) from exc
    if path.exists():
        typer.echo(f"{path} already exists — refusing to overwrite.", err=True)
        raise typer.Exit(code=1)
    path.parent.mkdir(parents=True, exist_ok=True)

    landmarks = [lm.get("name") for lm in sc.towns[town].get("landmarks", []) if lm.get("name")]
    routine_locations = (
        (
            landmarks[0],
            landmarks[min(1, len(landmarks) - 1)],
        )
        if landmarks
        else ("Town Center", "Town Center")
    )
    body = _persona_md(
        name,
        town,
        sc.undecided_id,
        f"A resident of {town} with a view worth hearing.",
        "Resident",
        routine_locations=routine_locations,
    )
    try:
        _publish_new_text(path, body)
        load_scenario(scenario_dir)
    except FileExistsError as exc:
        typer.echo(f"{path} already exists — refusing to overwrite.", err=True)
        raise typer.Exit(code=1) from exc
    except Exception as exc:
        path.unlink(missing_ok=True)
        typer.echo(f"Could not create a valid resident: {exc}", err=True)
        raise typer.Exit(code=1) from exc

    typer.echo(f"Created {path}")
    typer.echo(f"Valid stances for initial_lean: {', '.join(sc.valid_stance_ids)}")


if __name__ == "__main__":
    app()
