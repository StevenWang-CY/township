"""
Scenario engine — the data-driven heart of Township.

A *scenario* is a directory (``scenarios/<id>/``) describing one civic
deliberation: the question a community faces, the options on the table,
the towns it plays out in, the agent personas, the news beats, and the
round-by-round plan the simulation follows.

Layout::

    scenarios/<id>/
        scenario.json          # ScenarioConfig (validated below)
        towns/*.json           # per-town layout, demographics, accent_color
        options/*.json         # rich per-option data (positions, background)
        agents/<town>/*.md     # persona files (frontmatter + body)
        context/*.json         # OPTIONAL extras (debate-excerpts, logistics)
        god-scenarios.json     # OPTIONAL curated God's View injections

Everything the engine previously hardcoded about the NJ-11 special
election now lives in ``scenarios/nj11-2026/``.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path

from pydantic import BaseModel, Field, field_validator

from .agent_loader import load_all_agents
from .types import AgentDefinition

logger = logging.getLogger(__name__)

# township/ — anchored on this file (backend/core/scenario.py → repo root).
PROJECT_ROOT = Path(__file__).resolve().parents[2]
SCENARIOS_DIR = PROJECT_ROOT / "scenarios"

VALID_PHASES = ("seed", "converse", "news", "opinion", "decide")

_CLOCK_RE = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")


# ─── Config models (the scenario.json schema) ──────────────────────────────

class ScenarioOption(BaseModel):
    """One choice on the table (a candidate, a budget line, a policy)."""
    id: str
    name: str
    label: str
    color: str
    group: str | None = None          # e.g. party for elections
    data_file: str | None = None      # path (relative to scenario dir) to rich data


class UndecidedSpec(BaseModel):
    id: str = "undecided"
    label: str = "Undecided"
    color: str = "#D1D5DB"


class DatesSpec(BaseModel):
    decision_day: str                 # ISO date the community decides
    prose: str                        # human framing ("Early voting runs ...")


class RoundSpec(BaseModel):
    round: int
    clock: str = "12:00"              # in-game wall clock "HH:MM"
    phases: list[str] = Field(default_factory=list)
    news_ids: list[str] = Field(default_factory=list)

    @field_validator("phases")
    @classmethod
    def _known_phases(cls, v: list[str]) -> list[str]:
        unknown = [p for p in v if p not in VALID_PHASES]
        if unknown:
            raise ValueError(
                f"unknown phases {unknown}; valid phases: {list(VALID_PHASES)}"
            )
        return v

    @field_validator("clock")
    @classmethod
    def _clock_format(cls, v: str) -> str:
        if not _CLOCK_RE.match(v):
            raise ValueError(f"clock must be 'HH:MM' (24h), got {v!r}")
        return v

    def clock_tuple(self) -> tuple[int, int]:
        hour, minute = self.clock.split(":")
        return int(hour), int(minute)


class NewsItem(BaseModel):
    id: str
    headline: str
    description: str


class CrossTownPair(BaseModel):
    agents: list[str]                 # exactly two agent display names
    connection: str

    @field_validator("agents")
    @classmethod
    def _two_agents(cls, v: list[str]) -> list[str]:
        if len(v) != 2:
            raise ValueError(f"a cross-town pair needs exactly 2 agents, got {len(v)}")
        return v


class ScenarioConfig(BaseModel):
    id: str
    title: str
    question: str
    kind: str = "vote"                # "election" | "vote"
    options: list[ScenarioOption]
    undecided: UndecidedSpec = Field(default_factory=UndecidedSpec)
    dates: DatesSpec
    context_md: str
    context_short_md: str
    round_plan: list[RoundSpec]
    news: list[NewsItem] = Field(default_factory=list)
    cross_town_pairs: list[CrossTownPair] = Field(default_factory=list)
    cross_town_meeting_place: str = "Community Event"
    weather_schedule: list[str] = Field(default_factory=list)
    gossip_rounds: list[int] = Field(default_factory=list)
    town_order: list[str] | None = None

    @field_validator("options")
    @classmethod
    def _at_least_one_option(cls, v: list[ScenarioOption]) -> list[ScenarioOption]:
        if not v:
            raise ValueError("a scenario needs at least one option")
        ids = [o.id for o in v]
        if len(set(ids)) != len(ids):
            raise ValueError(f"duplicate option ids: {ids}")
        return v

    @field_validator("round_plan")
    @classmethod
    def _rounds_contiguous(cls, v: list[RoundSpec]) -> list[RoundSpec]:
        """Round numbers must be 0-based, unique, and contiguous (0..N-1).

        This keeps "run the first N rounds" well-defined everywhere the
        engine truncates the plan (round_manager, /api/simulation/start).
        """
        if not v:
            raise ValueError("round_plan must contain at least one round")
        numbers = [s.round for s in v]
        expected = list(range(len(v)))
        if sorted(numbers) != expected:
            raise ValueError(
                f"round_plan rounds must be unique and 0-based contiguous "
                f"(expected {expected}, got {numbers})"
            )
        return sorted(v, key=lambda s: s.round)


# ─── Runtime object ────────────────────────────────────────────────────────

class Scenario:
    """A fully loaded scenario: config + towns + options data + agent roster."""

    def __init__(
        self,
        config: ScenarioConfig,
        scenario_dir: Path,
        towns: dict[str, dict],
        options_data: dict[str, dict],
        agents: dict[str, list[AgentDefinition]],
        extras: dict[str, dict],
        god_scenarios_path: Path | None = None,
    ):
        self.config = config
        self.scenario_dir = scenario_dir
        self.towns = towns
        self.options_data = options_data
        self.agents = agents
        self.extras = extras          # context/*.json keyed by file stem
        # Curated God's View injections. The legacy data/ layout shipped this
        # under a different filename, so the loader owns the path — not the
        # route (backend/routes/gods_view.py just reads whatever this points at).
        self.god_scenarios_path = (
            god_scenarios_path or scenario_dir / "god-scenarios.json"
        )

    # ── Identity / options ─────────────────────────────────────

    @property
    def id(self) -> str:
        return self.config.id

    @property
    def title(self) -> str:
        return self.config.title

    @property
    def question(self) -> str:
        return self.config.question

    @property
    def option_ids(self) -> list[str]:
        return [o.id for o in self.config.options]

    @property
    def undecided_id(self) -> str:
        return self.config.undecided.id

    @property
    def valid_stance_ids(self) -> list[str]:
        return self.option_ids + [self.undecided_id]

    @property
    def option_color(self) -> dict[str, str]:
        colors = {o.id: o.color for o in self.config.options}
        colors[self.undecided_id] = self.config.undecided.color
        return colors

    @property
    def option_label(self) -> dict[str, str]:
        labels = {o.id: o.label for o in self.config.options}
        labels[self.undecided_id] = self.config.undecided.label
        return labels

    @property
    def news_by_id(self) -> dict[str, NewsItem]:
        return {n.id: n for n in self.config.news}

    @property
    def total_rounds(self) -> int:
        return len(self.config.round_plan)

    # ── Towns ──────────────────────────────────────────────────

    @property
    def town_ids(self) -> list[str]:
        if self.config.town_order:
            # Honor explicit order; append any towns not listed so nothing
            # silently disappears.
            ordered = [t for t in self.config.town_order if t in self.towns]
            ordered += [t for t in sorted(self.towns) if t not in ordered]
            return ordered
        return sorted(self.towns)

    def town_color(self, town_id: str) -> str:
        town = self.towns.get((town_id or "").lower(), {})
        return town.get("accent_color") or "#888888"

    # ── Prompt context builders ────────────────────────────────

    def context_block(self) -> str:
        """The per-agent prompt context (a few sentences of framing)."""
        return self.config.context_md

    def context_short(self) -> str:
        """The compact context used in chat / God's View prompts."""
        return self.config.context_short_md

    def _options_summary_line(self) -> str:
        parts = []
        for o in self.config.options:
            parts.append(f"{o.name} ({o.group})" if o.group else o.name)
        return ", ".join(parts)

    def build_full_context(self) -> str:
        """
        The comprehensive briefing given to agents in the seed round:
        title + question + dates + every option's rich data, plus any
        optional extras (debate excerpts, logistics) the scenario ships.
        """
        parts: list[str] = []
        parts.append(f"## {self.title.upper()} — WHERE THE OPTIONS STAND\n")
        parts.append(f"The question: {self.question}")
        parts.append(self.config.dates.prose)
        parts.append("")

        for option in self.config.options:
            data = self.options_data.get(option.id, {})
            header = f"### {data.get('name', option.name)}"
            group = data.get("party") or option.group
            if group:
                header += f" ({group})"
            parts.append(header)
            background = data.get("background") or data.get("summary")
            if background:
                parts.append(f"Background: {background}")

            for pos in data.get("positions", []):
                parts.append(f"- {pos.get('issue', '?')}: {pos.get('stance', '?')}")

            endorsements = data.get("endorsements", [])
            if endorsements:
                parts.append(f"Endorsements: {', '.join(endorsements)}")

            fraud = data.get("fraud_conviction")
            if fraud:
                parts.append(f"NOTE: {fraud.get('description', '')}")

            parts.append("")

        # ── Optional: debate excerpts (context/debate-excerpts.json) ──
        debate = self.extras.get("debate-excerpts") or {}
        exchanges = debate.get("exchanges", [])
        if exchanges:
            debate_meta = debate.get("debate", {})
            date = debate_meta.get("date", "")
            parts.append(f"## DEBATE HIGHLIGHTS{f' ({date})' if date else ''}\n")
            for ex in exchanges:
                parts.append(
                    f"**{ex.get('topic', '?')}** (tension: {ex.get('tension_level', '?')}/5)"
                )
                for key, value in ex.items():
                    if key.endswith("_position") and value:
                        speaker = key[: -len("_position")].replace("_", " ").title()
                        parts.append(f"  {speaker}: {value}")
                quote = ex.get("key_quote")
                if quote:
                    parts.append(f'  Key moment: "{quote}"')
                parts.append("")

        # ── Optional: logistics highlights (context/logistics.json) ──
        logistics = self.extras.get("logistics") or {}
        if logistics:
            highlights: list[str] = []
            race = logistics.get("race")
            if race:
                highlights.append(f"Race: {race}")
            election_day = logistics.get("election_day", {})
            if election_day.get("date"):
                day = election_day.get("day_of_week", "")
                highlights.append(
                    f"Decision day: {election_day['date']}{f' ({day})' if day else ''}"
                )
            early = logistics.get("early_voting", {})
            if early.get("dates"):
                highlights.append(f"Early voting: {early['dates']}")
            if highlights:
                parts.append("## LOGISTICS\n")
                parts.extend(f"- {h}" for h in highlights)
                parts.append("")

        return "\n".join(parts)


# ─── Stance validation ─────────────────────────────────────────────────────

def validate_stance(value: str, scenario: Scenario) -> str:
    """
    Coerce a model-produced stance string onto the scenario's roster.

    Exact match wins; then a case-insensitive match; anything else
    (hallucinated candidates, prose answers) becomes the undecided id so a
    single bad tool call can never corrupt summaries or the wire.
    """
    if not isinstance(value, str) or not value:
        return scenario.undecided_id
    valid = scenario.valid_stance_ids
    if value in valid:
        return value
    lowered = value.strip().lower()
    for stance in valid:
        if stance.lower() == lowered:
            return stance
    logger.warning(
        "Unknown stance %r coerced to %r (valid: %s)",
        value, scenario.undecided_id, valid,
    )
    return scenario.undecided_id


def _validate_agent_leans(
    config: ScenarioConfig, agents: dict[str, list[AgentDefinition]]
) -> None:
    """
    Fail loudly at load when a persona's ``initial_lean`` is off the stance
    roster (options + undecided).

    ``AgentDefinition.initial_lean`` is a free-form string so any scenario can
    define its own stances — this is where the scenario-level check the old
    ``Literal`` type used to provide now lives. Without it, a typo'd lean
    would ride the wire to the frontend (unknown color bucket) and then be
    silently coerced to undecided at seed time.
    """
    valid = {o.id for o in config.options} | {config.undecided.id}
    bad = [
        f"{town}/{a.name}: initial_lean={a.initial_lean!r}"
        for town, town_agents in agents.items()
        for a in town_agents
        if a.initial_lean not in valid
    ]
    if bad:
        raise ValueError(
            f"scenario {config.id!r}: persona initial_lean not on the stance "
            f"roster {sorted(valid)}: {bad}"
        )


# ─── Loading ───────────────────────────────────────────────────────────────

def find_scenario_dir(scenario_id: str) -> Path:
    """Resolve ``scenarios/<id>`` under the project root."""
    return SCENARIOS_DIR / scenario_id


def _load_json(path: Path) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def load_scenario(scenario_dir: Path | str) -> Scenario:
    """Load and validate a scenario directory into a runtime Scenario."""
    scenario_dir = Path(scenario_dir)
    manifest = scenario_dir / "scenario.json"
    if not manifest.is_file():
        raise FileNotFoundError(f"scenario.json not found in {scenario_dir}")

    config = ScenarioConfig.model_validate(_load_json(manifest))

    # Towns
    towns: dict[str, dict] = {}
    towns_dir = scenario_dir / "towns"
    if towns_dir.is_dir():
        for f in sorted(towns_dir.glob("*.json")):
            towns[f.stem] = _load_json(f)
    if not towns:
        raise ValueError(f"scenario {config.id!r} has no towns/*.json files")

    # Options data — data_file wins, then options/<id>.json, else empty dict.
    options_data: dict[str, dict] = {}
    for option in config.options:
        data: dict = {}
        if option.data_file:
            path = scenario_dir / option.data_file
            if path.is_file():
                data = _load_json(path)
            else:
                logger.warning(
                    "Option %r data_file missing: %s", option.id, path
                )
        else:
            default_path = scenario_dir / "options" / f"{option.id}.json"
            if default_path.is_file():
                data = _load_json(default_path)
        options_data[option.id] = data

    # Agents (optional at load time — a scenario being authored may not have
    # its roster yet; the orchestrator will simply have zero agents).
    agents: dict[str, list[AgentDefinition]] = {}
    agents_dir = scenario_dir / "agents"
    if agents_dir.is_dir():
        agents = load_all_agents(str(agents_dir))
    _validate_agent_leans(config, agents)

    # Optional context extras (debate excerpts, logistics, ...).
    extras: dict[str, dict] = {}
    context_dir = scenario_dir / "context"
    if context_dir.is_dir():
        for f in sorted(context_dir.glob("*.json")):
            try:
                extras[f.stem] = _load_json(f)
            except json.JSONDecodeError as e:
                logger.warning("Skipping invalid context file %s: %s", f, e)

    # News-id sanity: every round_plan news_id must exist.
    news_ids = {n.id for n in config.news}
    for spec in config.round_plan:
        missing = [i for i in spec.news_ids if i not in news_ids]
        if missing:
            raise ValueError(
                f"round {spec.round} references unknown news ids {missing}"
            )

    logger.info(
        "Loaded scenario %r: %d towns, %d options, %d agents, %d rounds",
        config.id, len(towns), len(config.options),
        sum(len(v) for v in agents.values()), len(config.round_plan),
    )
    return Scenario(
        config=config,
        scenario_dir=scenario_dir,
        towns=towns,
        options_data=options_data,
        agents=agents,
        extras=extras,
    )


# ─── Legacy fallback (deprecated — one release only) ───────────────────────

# The pre-scenario repo layout: agents/ + data/{towns,candidates,...} at the
# project root. External forks/scripts built on that layout keep working for
# one release via this shim, which synthesizes the NJ-11 ScenarioConfig the
# engine used to hardcode.

_LEGACY_NJ11_CONFIG: dict = {
    "id": "nj11-2026",
    "title": "The NJ-11 Special Election",
    "question": (
        "Who should represent New Jersey's 11th Congressional District — "
        "Analilia Mejia (D), Joe Hathaway (R), or Alan B. Bond (I)?"
    ),
    "kind": "election",
    "options": [
        {"id": "mejia", "name": "Analilia Mejia", "label": "Mejia", "color": "#4A8FBF", "group": "Democrat"},
        {"id": "hathaway", "name": "Joe Hathaway", "label": "Hathaway", "color": "#C0792A", "group": "Republican"},
        {"id": "bond", "name": "Alan B. Bond", "label": "Bond", "color": "#9A8E80", "group": "Independent"},
    ],
    "undecided": {"id": "undecided", "label": "Undecided", "color": "#D1D5DB"},
    "dates": {
        "decision_day": "2026-04-16",
        "prose": "Early voting runs April 6-14. Election Day is Thursday, April 16, 2026.",
    },
    "context_md": (
        "You are a voter in New Jersey's 11th Congressional District. "
        "A special election is happening on April 16, 2026 to replace Mikie Sherrill, "
        "who became governor. The candidates are:\n"
        "- Analilia Mejia (Democrat): Progressive, supports Medicare for All, $25 min wage, abolish ICE\n"
        "- Joe Hathaway (Republican): 'New generation Republican', lower taxes, supports One Big Beautiful Bill\n"
        "- Alan Bond (Independent): Former Wall Street fund manager with fraud conviction, limited platform\n"
        "\nEarly voting is April 6-14. Election Day is April 16."
    ),
    "context_short_md": (
        "You're a voter in NJ-11. Special election is April 16, 2026. "
        "Candidates: Analilia Mejia (D), Joe Hathaway (R), Alan Bond (I). "
        "Early voting is happening now (April 6-14)."
    ),
    "round_plan": [
        {"round": 0, "phases": ["seed"], "clock": "08:00"},
        {"round": 1, "phases": ["converse", "news"], "clock": "10:00",
         "news_ids": ["aca-subsidies", "ice-enforcement"]},
        {"round": 2, "phases": ["converse", "opinion"], "clock": "13:00"},
        {"round": 3, "phases": ["news", "converse", "opinion"], "clock": "16:00",
         "news_ids": ["property-tax"]},
        {"round": 4, "phases": ["converse", "opinion", "decide"], "clock": "19:00"},
    ],
    "news": [
        {
            "id": "aca-subsidies",
            "headline": "ACA Subsidies at Risk in One Big Beautiful Bill",
            "description": (
                "Congressional Republicans are pushing the 'One Big Beautiful Bill' which would "
                "end enhanced ACA subsidies. For NJ-11, this could mean 40,000+ residents losing "
                "health insurance subsidies worth $400-$800/month per family."
            ),
        },
        {
            "id": "ice-enforcement",
            "headline": "ICE Enforcement Increases in Morris County",
            "description": (
                "Immigration and Customs Enforcement has increased operations in Morris County, "
                "with reports of workplace raids in Dover and Parsippany. Community organizations "
                "report a chilling effect on residents seeking public services."
            ),
        },
        {
            "id": "property-tax",
            "headline": "Property Tax Reassessment Coming to Morris County",
            "description": (
                "Morris County has announced a county-wide property tax reassessment for 2027. "
                "Homeowners in rapidly appreciating areas like Montclair and Randolph could see "
                "significant increases, while some Dover properties may see decreases."
            ),
        },
    ],
    # The 6 strategic gossip pairings round_manager.CROSS_TOWN_PAIRS used to
    # hardcode — kept verbatim so legacy forks don't lose curated pairings.
    "cross_town_pairs": [
        {
            "agents": ["Carlos Restrepo", "Pawan Sharma"],
            "connection": (
                "Fellow restaurant owners who met at a Morris County Restaurant "
                "Association mixer. They bonded over the challenges of running a "
                "small food business in NJ."
            ),
        },
        {
            "agents": ["Maria Santos", "Grace Reyes"],
            "connection": (
                "Both healthcare workers who occasionally cross paths at "
                "Morristown Medical Center during shift changes. They share "
                "frustrations about insurance paperwork and patient loads."
            ),
        },
        {
            "agents": ["Tom Kowalski", "Frank DeLuca"],
            "connection": (
                "Veterans who know each other from the Morris County VFW post. "
                "They served in different eras but share a deep bond over "
                "military service and VA healthcare struggles."
            ),
        },
        {
            "agents": ["Sofia Ramirez", "Jordan Williams"],
            "connection": (
                "Connected on social media through mutual activist friends. Both "
                "are young, frustrated with the political establishment, and "
                "active in local organizing circles."
            ),
        },
        {
            "agents": ["Raj Krishnamurthy", "Vikram Iyer"],
            "connection": (
                "Indian-American tech professionals who know each other from the "
                "Parsippany-area tech meetup circuit. Their families attend some "
                "of the same community events."
            ),
        },
        {
            "agents": ["Priya Patel", "Jen Russo"],
            "connection": (
                "Suburban moms whose kids played in the same Morris County youth "
                "soccer league. They chat at games about schools, property "
                "taxes, and local politics."
            ),
        },
    ],
    "cross_town_meeting_place": "Morris County Community Event",
    "weather_schedule": ["clear", "cloudy", "rain", "clear", "snow"],
    "gossip_rounds": [2, 3],
    "town_order": ["dover", "montclair", "parsippany", "randolph"],
}


def _load_legacy_layout(project_root: Path) -> Scenario:
    """Deprecated: synthesize a Scenario from the pre-scenario repo layout."""
    logger.warning(
        "DEPRECATED: loading from the legacy data/ + agents/ layout. "
        "Move your content into scenarios/<id>/ — this fallback will be "
        "removed in the next release."
    )
    data_dir = project_root / "data"
    config = ScenarioConfig.model_validate(_LEGACY_NJ11_CONFIG)

    towns: dict[str, dict] = {}
    towns_dir = data_dir / "towns"
    if towns_dir.is_dir():
        for f in sorted(towns_dir.glob("*.json")):
            towns[f.stem] = _load_json(f)
    if not towns:
        raise FileNotFoundError(
            f"legacy layout has no towns under {towns_dir} — nothing to load"
        )

    options_data: dict[str, dict] = {}
    candidates_dir = data_dir / "candidates"
    if candidates_dir.is_dir():
        for f in sorted(candidates_dir.glob("*.json")):
            options_data[f.stem] = _load_json(f)

    agents: dict[str, list[AgentDefinition]] = {}
    agents_dir = project_root / "agents"
    if agents_dir.is_dir():
        agents = load_all_agents(str(agents_dir))
    _validate_agent_leans(config, agents)

    extras: dict[str, dict] = {}
    for legacy_name, extra_key in (
        ("debate-excerpts.json", "debate-excerpts"),
        ("election-logistics.json", "logistics"),
    ):
        path = data_dir / legacy_name
        if path.is_file():
            extras[extra_key] = _load_json(path)

    return Scenario(
        config=config,
        scenario_dir=data_dir,
        towns=towns,
        options_data=options_data,
        agents=agents,
        extras=extras,
        # The legacy layout shipped God's View presets under a different name.
        god_scenarios_path=data_dir / "god_view_scenarios.json",
    )


def load_scenario_with_fallback(
    scenario_id: str, project_root: Path | None = None
) -> Scenario:
    """
    Load ``scenarios/<id>``; when that directory is missing, fall back —
    loudly — to the deprecated pre-scenario ``data/`` + ``agents/`` layout.
    """
    root = project_root or PROJECT_ROOT
    scenario_dir = root / "scenarios" / scenario_id
    if (scenario_dir / "scenario.json").is_file():
        return load_scenario(scenario_dir)

    legacy_data = root / "data"
    if (legacy_data / "towns").is_dir():
        logger.warning(
            "Scenario dir %s not found — falling back to legacy data/ layout",
            scenario_dir,
        )
        return _load_legacy_layout(root)

    raise FileNotFoundError(
        f"No scenario found: {scenario_dir} does not exist and no legacy "
        f"data/ layout is present under {root}"
    )
