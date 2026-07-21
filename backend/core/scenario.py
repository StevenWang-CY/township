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
import os
import re
from datetime import date
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .agent_loader import agent_id_from_name, load_all_agents, validate_agent_ids
from .types import AgentDefinition

logger = logging.getLogger(__name__)

# township/ — anchored on this file (backend/core/scenario.py → repo root).
PROJECT_ROOT = Path(__file__).resolve().parents[2]
SCENARIOS_DIR = PROJECT_ROOT / "scenarios"

VALID_PHASES = ("seed", "converse", "news", "opinion", "decide")

_CLOCK_RE = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")
_PACKAGE_ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_STANCE_ID_RE = re.compile(r"^[a-z0-9]+(?:[-_][a-z0-9]+)*$")
_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")

CANONICAL_CORE_NOTICE = (
    "Township is a simulation, not a poll. Its outputs do not measure real public "
    "opinion and must never be presented as if they do."
)


# ─── Config models (the scenario.json schema) ──────────────────────────────


class ScenarioOption(BaseModel):
    """One choice on the table (a candidate, a budget line, a policy)."""

    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    label: str
    color: str
    group: str | None = None  # e.g. party for elections
    data_file: str | None = None  # path (relative to scenario dir) to rich data

    @field_validator("id")
    @classmethod
    def _safe_option_id(cls, value: str) -> str:
        value = value.strip()
        if not _STANCE_ID_RE.fullmatch(value):
            raise ValueError(
                "option id must use lowercase letters, numbers, hyphens, or underscores"
            )
        return value

    @field_validator("name", "label")
    @classmethod
    def _visible_option_copy(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("option names and labels must not be empty")
        return value

    @field_validator("color")
    @classmethod
    def _option_color(cls, value: str) -> str:
        value = value.strip()
        if not _HEX_COLOR_RE.fullmatch(value):
            raise ValueError("option color must be a six-digit hex color such as #4A8FBF")
        return value

    @field_validator("data_file")
    @classmethod
    def _relative_data_file(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        posix_path = Path(value)
        windows_path = PureWindowsPath(value)
        if (
            not value
            or "\\" in value
            or posix_path.is_absolute()
            or windows_path.is_absolute()
            or ".." in posix_path.parts
            or ".." in windows_path.parts
        ):
            raise ValueError("data_file must be a relative path within the scenario directory")
        return value


class UndecidedSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = "undecided"
    label: str = "Undecided"
    color: str = "#D1D5DB"

    @field_validator("id")
    @classmethod
    def _safe_undecided_id(cls, value: str) -> str:
        value = value.strip()
        if not _STANCE_ID_RE.fullmatch(value):
            raise ValueError(
                "undecided id must use lowercase letters, numbers, hyphens, or underscores"
            )
        return value

    @field_validator("label")
    @classmethod
    def _visible_undecided_label(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("undecided label must not be empty")
        return value

    @field_validator("color")
    @classmethod
    def _undecided_color(cls, value: str) -> str:
        value = value.strip()
        if not _HEX_COLOR_RE.fullmatch(value):
            raise ValueError("undecided color must be a six-digit hex color")
        return value


class DatesSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision_day: str  # ISO date the community decides
    prose: str  # human framing ("Early voting runs ...")

    @field_validator("decision_day")
    @classmethod
    def _iso_decision_day(cls, value: str) -> str:
        value = value.strip()
        try:
            date.fromisoformat(value)
        except ValueError as exc:
            raise ValueError("decision_day must be an ISO date in YYYY-MM-DD form") from exc
        return value

    @field_validator("prose")
    @classmethod
    def _visible_date_copy(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("date prose must not be empty")
        return value


class ResponsibleUseSpec(BaseModel):
    """Scenario-owned notices that must travel with every rendered/exported run.

    The core notice is intentionally shared across scenario kinds.  The other
    fields let a fictional policy exercise describe its subjects truthfully
    without inheriting election-specific language about real candidates.
    """

    model_config = ConfigDict(extra="forbid")

    core_notice: str
    residents_notice: str
    subjects_notice: str
    outputs_notice: str

    @field_validator("*")
    @classmethod
    def _notice_is_visible_copy(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("responsible-use notices must not be empty")
        return value

    @field_validator("core_notice")
    @classmethod
    def _core_notice_keeps_canonical_warning(cls, value: str) -> str:
        if value != CANONICAL_CORE_NOTICE:
            raise ValueError(
                "core_notice must exactly match Township's canonical simulation-not-a-poll warning"
            )
        return value


class RoundSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    round: int
    clock: str = "12:00"  # in-game wall clock "HH:MM"
    phases: list[str] = Field(default_factory=list)
    news_ids: list[str] = Field(default_factory=list)

    @field_validator("phases")
    @classmethod
    def _known_phases(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("a round must declare at least one phase")
        unknown = [p for p in v if p not in VALID_PHASES]
        if unknown:
            raise ValueError(f"unknown phases {unknown}; valid phases: {list(VALID_PHASES)}")
        if len(set(v)) != len(v):
            raise ValueError("a round must not repeat a phase")
        return v

    @field_validator("news_ids")
    @classmethod
    def _visible_news_ids(cls, values: list[str]) -> list[str]:
        cleaned = [value.strip() for value in values]
        if any(not value for value in cleaned):
            raise ValueError("round news_ids must not contain blank ids")
        if len(set(cleaned)) != len(cleaned):
            raise ValueError("round news_ids must not contain duplicates")
        return cleaned

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
    model_config = ConfigDict(extra="forbid")

    id: str
    headline: str
    description: str

    @field_validator("id", "headline", "description")
    @classmethod
    def _visible_news_copy(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("news id, headline, and description must not be empty")
        return value


class CrossTownPair(BaseModel):
    model_config = ConfigDict(extra="forbid")

    agents: list[str]  # exactly two agent display names
    connection: str

    @field_validator("agents")
    @classmethod
    def _two_agents(cls, v: list[str]) -> list[str]:
        if len(v) != 2:
            raise ValueError(f"a cross-town pair needs exactly 2 agents, got {len(v)}")
        cleaned = [name.strip() for name in v]
        if any(not name for name in cleaned):
            raise ValueError("cross-town pair agent names must not be blank")
        if cleaned[0].casefold() == cleaned[1].casefold():
            raise ValueError("a cross-town pair must name two different residents")
        return cleaned

    @field_validator("connection")
    @classmethod
    def _visible_connection(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("cross-town pair connection must not be empty")
        return value


class LandmarkSpec(BaseModel):
    """Validated 1200×800 world-space landmark consumed by engine and UI."""

    model_config = ConfigDict(extra="allow")

    name: str
    x: float = Field(ge=0, le=1200, allow_inf_nan=False)
    y: float = Field(ge=0, le=800, allow_inf_nan=False)
    width: float = Field(gt=0, le=1200, allow_inf_nan=False)
    height: float = Field(gt=0, le=800, allow_inf_nan=False)
    type: str
    color: str
    description: str | None = None

    @field_validator("name", "type")
    @classmethod
    def _visible_landmark_copy(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("landmark name and type must not be empty")
        return value

    @field_validator("color")
    @classmethod
    def _landmark_color(cls, value: str) -> str:
        value = value.strip()
        if not _HEX_COLOR_RE.fullmatch(value):
            raise ValueError("landmark color must be a six-digit hex color")
        return value

    @field_validator("x", "y", "width", "height", mode="before")
    @classmethod
    def _numeric_geometry(cls, value):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError("landmark geometry must be numeric")
        return value

    @model_validator(mode="after")
    def _inside_world(self) -> Self:
        if self.x + self.width > 1200 or self.y + self.height > 800:
            raise ValueError("landmark rectangle must stay inside the 1200x800 world")
        return self


class DemographicsSpec(BaseModel):
    model_config = ConfigDict(extra="allow")

    population: int = Field(ge=1)

    @field_validator("population", mode="before")
    @classmethod
    def _integer_population(cls, value):
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError("demographics.population must be a positive integer")
        return value


class TownMapSpec(BaseModel):
    """Scenario-owned pointer to a namespaced authored Tiled map."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["tiled"]
    path: str
    preview_path: str

    @field_validator("path", "preview_path")
    @classmethod
    def _safe_asset_path(cls, value: str) -> str:
        value = value.strip()
        parsed = PurePosixPath(value)
        if (
            parsed.is_absolute()
            or ".." in parsed.parts
            or not value.startswith("assets/maps/")
            or parsed.suffix not in {".tmj", ".png"}
        ):
            raise ValueError("town map paths must be relative assets/maps/ files")
        return value


class TownSpec(BaseModel):
    """Minimum safe town payload; additional authored fields pass through."""

    model_config = ConfigDict(extra="allow")

    name: str
    accent_color: str
    demographics: DemographicsSpec
    landmarks: list[LandmarkSpec] = Field(min_length=1)
    map: TownMapSpec | None = None

    @field_validator("name")
    @classmethod
    def _visible_town_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("town name must not be empty")
        return value

    @field_validator("accent_color")
    @classmethod
    def _town_color(cls, value: str) -> str:
        value = value.strip()
        if not _HEX_COLOR_RE.fullmatch(value):
            raise ValueError("town accent_color must be a six-digit hex color")
        return value

    @model_validator(mode="after")
    def _unique_landmark_names(self) -> Self:
        names = [landmark.name.casefold() for landmark in self.landmarks]
        if len(set(names)) != len(names):
            raise ValueError("landmark names must be unique within a town")
        return self


class OptionPositionSpec(BaseModel):
    model_config = ConfigDict(extra="allow")

    issue: str
    stance: str

    @field_validator("issue", "stance")
    @classmethod
    def _visible_position_copy(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("option position issue and stance must not be empty")
        return value


class OptionNarrativeNoteSpec(BaseModel):
    model_config = ConfigDict(extra="allow")

    description: str

    @field_validator("description")
    @classmethod
    def _visible_description(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("option narrative description must not be empty")
        return value


class OptionDataSpec(BaseModel):
    """Known rich-option fields used by ``build_full_context``."""

    model_config = ConfigDict(extra="allow")

    name: str | None = None
    background: str | None = None
    summary: str | None = None
    party: str | None = None
    positions: list[OptionPositionSpec] = Field(default_factory=list)
    endorsements: list[str] = Field(default_factory=list)
    fraud_conviction: OptionNarrativeNoteSpec | None = None

    @field_validator("name", "background", "summary", "party")
    @classmethod
    def _nonblank_optional_copy(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("rich option text fields must not be blank")
        return value

    @field_validator("endorsements")
    @classmethod
    def _visible_endorsements(cls, values: list[str]) -> list[str]:
        cleaned = [value.strip() for value in values]
        if any(not value for value in cleaned):
            raise ValueError("endorsements must be non-empty strings")
        return cleaned


class DebateExchangeSpec(BaseModel):
    model_config = ConfigDict(extra="allow")

    topic: str
    tension_level: int | float | None = None
    summary: str | None = None
    key_quote: str | None = None

    @field_validator("topic")
    @classmethod
    def _visible_topic(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("debate exchange topic must not be empty")
        return value

    @field_validator("summary", "key_quote")
    @classmethod
    def _visible_optional_summary(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("debate summaries must not be blank")
        return value

    @field_validator("tension_level", mode="before")
    @classmethod
    def _numeric_tension(cls, value):
        if value is None:
            return None
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError("debate tension_level must be numeric")
        if not 0 <= value <= 5:
            raise ValueError("debate tension_level must be between 0 and 5")
        return value

    @model_validator(mode="after")
    def _position_extras_are_text(self) -> Self:
        for key, value in (self.__pydantic_extra__ or {}).items():
            if key.endswith("_position") and (not isinstance(value, str) or not value.strip()):
                raise ValueError(f"debate {key} must be a non-empty string")
        return self


class DebateContextSpec(BaseModel):
    model_config = ConfigDict(extra="allow")

    debate: dict = Field(default_factory=dict)
    exchanges: list[DebateExchangeSpec] = Field(default_factory=list)


class LogisticsContextSpec(BaseModel):
    model_config = ConfigDict(extra="allow")

    race: str | None = None
    election_day: dict = Field(default_factory=dict)
    early_voting: dict = Field(default_factory=dict)


class GodScenarioSpec(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    name: str
    description: str
    category: str
    expected_impact: str
    affected_towns: list[str] = Field(default_factory=list)

    @field_validator("id")
    @classmethod
    def _safe_god_scenario_id(cls, value: str) -> str:
        value = value.strip()
        if not _PACKAGE_ID_RE.fullmatch(value):
            raise ValueError("God's View scenario id must use lowercase letters and hyphens")
        return value

    @field_validator("name", "description", "category", "expected_impact")
    @classmethod
    def _visible_god_scenario_copy(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("God's View scenario text fields must not be empty")
        return value

    @field_validator("affected_towns")
    @classmethod
    def _clean_affected_towns(cls, values: list[str]) -> list[str]:
        cleaned = [value.strip() for value in values]
        if any(not value for value in cleaned):
            raise ValueError("God's View affected_towns must not contain blanks")
        if len(set(cleaned)) != len(cleaned):
            raise ValueError("God's View affected_towns must not contain duplicates")
        return cleaned


class ScenarioConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    title: str
    question: str
    kind: Literal["election", "vote"] = "vote"
    options: list[ScenarioOption]
    undecided: UndecidedSpec = Field(default_factory=UndecidedSpec)
    dates: DatesSpec
    responsible_use: ResponsibleUseSpec
    context_md: str
    context_short_md: str
    round_plan: list[RoundSpec]
    news: list[NewsItem] = Field(default_factory=list)
    cross_town_pairs: list[CrossTownPair] = Field(default_factory=list)
    cross_town_meeting_place: str = "Community Event"
    weather_schedule: list[Literal["clear", "cloudy", "rain", "snow", "fog"]] = Field(
        default_factory=list
    )
    gossip_rounds: list[int] = Field(default_factory=list)
    town_order: list[str] | None = None

    @field_validator("id")
    @classmethod
    def _safe_package_id(cls, value: str) -> str:
        value = value.strip()
        if not _PACKAGE_ID_RE.fullmatch(value):
            raise ValueError("scenario id must use lowercase letters, numbers, and single hyphens")
        return value

    @field_validator("title", "question", "context_md", "context_short_md")
    @classmethod
    def _visible_scenario_copy(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("scenario title, question, and context must not be empty")
        return value

    @field_validator("cross_town_meeting_place")
    @classmethod
    def _visible_meeting_place(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("cross_town_meeting_place must not be empty")
        return value

    @field_validator("options")
    @classmethod
    def _at_least_one_option(cls, v: list[ScenarioOption]) -> list[ScenarioOption]:
        if not v:
            raise ValueError("a scenario needs at least one option")
        ids = [o.id for o in v]
        if len(set(ids)) != len(ids):
            raise ValueError(f"duplicate option ids: {ids}")
        return v

    @field_validator("news")
    @classmethod
    def _unique_news_ids(cls, values: list[NewsItem]) -> list[NewsItem]:
        ids = [item.id for item in values]
        if len(set(ids)) != len(ids):
            raise ValueError(f"duplicate news ids: {ids}")
        return values

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

    @model_validator(mode="after")
    def _coherent_rosters_and_schedules(self) -> Self:
        stance_ids = [option.id for option in self.options] + [self.undecided.id]
        folded = [stance.casefold() for stance in stance_ids]
        if len(set(folded)) != len(folded):
            raise ValueError(f"option and undecided ids must be unique ignoring case: {stance_ids}")

        rounds = {spec.round for spec in self.round_plan}
        if len(set(self.gossip_rounds)) != len(self.gossip_rounds):
            raise ValueError("gossip_rounds must not contain duplicates")
        unknown_gossip = [value for value in self.gossip_rounds if value not in rounds]
        if unknown_gossip:
            raise ValueError(f"gossip_rounds reference unknown rounds: {unknown_gossip}")
        if self.weather_schedule and len(self.weather_schedule) != len(self.round_plan):
            raise ValueError(
                "weather_schedule must be empty or contain exactly one entry per round"
            )
        return self


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
        god_scenarios: list[dict] | None = None,
        god_scenarios_path: Path | None = None,
        demo_cache_path: Path | None = None,
    ):
        self.config = config
        self.scenario_dir = scenario_dir
        self.towns = towns
        self.options_data = options_data
        self.agents = agents
        self.extras = extras  # context/*.json keyed by file stem
        self.god_scenarios = god_scenarios or []
        # Curated God's View injections. The legacy data/ layout shipped this
        # under a different filename, so the loader owns the path — not the
        # route (backend/routes/gods_view.py just reads whatever this points at).
        self.god_scenarios_path = god_scenarios_path or scenario_dir / "god-scenarios.json"
        self.demo_cache_path = demo_cache_path or scenario_dir / "demo" / "simulation_cache.json"

    # ── Identity / options ─────────────────────────────────────

    @property
    def id(self) -> str:
        return self.config.id

    @property
    def title(self) -> str:
        return self.config.title

    @property
    def responsible_use(self) -> ResponsibleUseSpec:
        """The validated disclosure block owned by this scenario package."""
        return self.config.responsible_use

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
                # Context authors may summarize reporting rather than preserve
                # an exact transcript. Never add quotation marks the source
                # data did not claim; keep legacy key_quote packages readable
                # while rendering both forms honestly as summaries.
                summary = ex.get("summary") or ex.get("key_quote")
                if summary:
                    parts.append(f"  Reported debate summary: {summary}")
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
        value,
        scenario.undecided_id,
        valid,
    )
    return scenario.undecided_id


def _validate_agent_leans(config: ScenarioConfig, agents: dict[str, list[AgentDefinition]]) -> None:
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


def _validate_scenario_references(
    config: ScenarioConfig,
    scenario_dir: Path,
    towns: dict[str, dict],
    agents: dict[str, list[AgentDefinition]],
) -> None:
    """Validate package references that require towns and personas to be loaded."""
    if config.id != scenario_dir.name:
        raise ValueError(
            f"scenario id {config.id!r} must match its directory name {scenario_dir.name!r}"
        )

    for town_id, town in towns.items():
        if not _PACKAGE_ID_RE.fullmatch(town_id):
            raise ValueError(
                f"town filename stem {town_id!r} must use lowercase letters, numbers, "
                "and single hyphens"
            )
        if not isinstance(town.get("name"), str) or not town["name"].strip():
            raise ValueError(f"town {town_id!r} must declare a non-empty name")

    if config.town_order is not None:
        if len(set(config.town_order)) != len(config.town_order):
            raise ValueError("town_order must not contain duplicates")
        unknown_towns = [town for town in config.town_order if town not in towns]
        if unknown_towns:
            raise ValueError(f"town_order references unknown towns: {unknown_towns}")

    for directory_town, definitions in agents.items():
        if directory_town not in towns:
            raise ValueError(
                f"agent directory {directory_town!r} has no matching towns/*.json file"
            )
        mismatched = [agent.name for agent in definitions if agent.town != directory_town]
        if mismatched:
            raise ValueError(f"agents in {directory_town!r} declare a different town: {mismatched}")

    by_name: dict[str, tuple[str, str]] = {}
    known_relationship_targets: set[str] = set()
    for town, definitions in agents.items():
        for definition in definitions:
            key = definition.name.casefold()
            if key in by_name:
                prior_town, prior_name = by_name[key]
                raise ValueError(
                    f"duplicate resident display name {definition.name!r}: "
                    f"{prior_town}/{prior_name!r} and {town}/{definition.name!r}"
                )
            by_name[key] = (town, definition.name)
            known_relationship_targets.add(key)
            known_relationship_targets.add(agent_id_from_name(definition.name).casefold())

            unknown_goal_rounds = [
                goal
                for goal in definition.goals
                if int(goal.removeprefix("round_")) >= len(config.round_plan)
            ]
            if unknown_goal_rounds:
                raise ValueError(
                    f"resident {definition.name!r} has goals for unknown rounds: "
                    f"{unknown_goal_rounds}"
                )

    for definitions in agents.values():
        for definition in definitions:
            unresolved = [
                relation["agent"]
                for relation in definition.relationships
                if relation["agent"].casefold() not in known_relationship_targets
            ]
            if unresolved:
                raise ValueError(
                    f"resident {definition.name!r} has relationships to unknown agents: "
                    f"{unresolved}"
                )

    used_in_pairs: set[str] = set()
    for pair in config.cross_town_pairs:
        resolved: list[tuple[str, str]] = []
        for name in pair.agents:
            key = name.casefold()
            match = by_name.get(key)
            if match is None:
                raise ValueError(f"cross_town_pairs references unknown resident {name!r}")
            if key in used_in_pairs:
                raise ValueError(f"cross_town_pairs uses resident {name!r} more than once")
            used_in_pairs.add(key)
            resolved.append(match)
        if resolved[0][0] == resolved[1][0]:
            raise ValueError(
                f"cross_town_pairs must cross towns, but {pair.agents!r} are both "
                f"in {resolved[0][0]!r}"
            )


# ─── Loading ───────────────────────────────────────────────────────────────


def find_scenario_dir(scenario_id: str) -> Path:
    """Resolve a scenario from the operator root, working tree, or wheel bundle."""
    if not _PACKAGE_ID_RE.fullmatch(scenario_id):
        raise ValueError("scenario id must use lowercase letters, numbers, and single hyphens")
    roots = scenario_search_roots()
    for root in roots:
        candidate = _scenario_descendant(root, scenario_id, label="scenario package")
        if (candidate / "scenario.json").is_file():
            return candidate
    return roots[0] / scenario_id


def scenario_search_roots(project_root: Path | None = None) -> tuple[Path, ...]:
    """Return scenario roots in runtime precedence order.

    A caller-supplied project root is exclusive (used by tests/embedders).
    Otherwise an explicit ``TOWNSHIP_SCENARIOS_DIR`` wins, then
    ``./scenarios`` in the launch directory, then the packages bundled in the
    source checkout or installed wheel. This lets a wheel run scenarios its
    user authored without ever writing into ``site-packages``.
    """
    if project_root is not None:
        return ((Path(project_root).resolve() / "scenarios"),)

    candidates: list[Path] = []
    override = os.environ.get("TOWNSHIP_SCENARIOS_DIR")
    if override:
        path = Path(override).expanduser()
        candidates.append(path if path.is_absolute() else Path.cwd() / path)
    candidates.extend((Path.cwd() / "scenarios", SCENARIOS_DIR))

    roots: list[Path] = []
    seen: set[Path] = set()
    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved not in seen:
            seen.add(resolved)
            roots.append(resolved)
    return tuple(roots)


def _load_json(path: Path) -> Any:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _scenario_descendant(scenario_dir: Path, relative_path: str, *, label: str) -> Path:
    """Resolve a scenario-owned path and reject traversal or symlink escapes."""
    root = scenario_dir.resolve()
    candidate = root / relative_path
    if candidate.is_symlink():
        raise ValueError(f"{label} must not be a symbolic link")
    path = candidate.resolve()
    if not path.is_relative_to(root):
        raise ValueError(f"{label} must stay within scenario directory {root}")
    return path


def load_scenario(scenario_dir: Path | str) -> Scenario:
    """Load and validate a scenario directory into a runtime Scenario."""
    scenario_candidate = Path(scenario_dir)
    if scenario_candidate.is_symlink():
        raise ValueError("scenario package must not be a symbolic link")
    scenario_dir = scenario_candidate.resolve()
    manifest = _scenario_descendant(scenario_dir, "scenario.json", label="scenario manifest")
    if not manifest.is_file():
        raise FileNotFoundError(f"scenario.json not found in {scenario_dir}")

    config = ScenarioConfig.model_validate(_load_json(manifest))

    # Towns
    towns: dict[str, dict] = {}
    towns_dir = _scenario_descendant(scenario_dir, "towns", label="towns directory")
    if towns_dir.is_dir():
        for f in sorted(towns_dir.glob("*.json")):
            safe_file = _scenario_descendant(
                scenario_dir,
                str(f.relative_to(scenario_dir)),
                label=f"town file {f.name!r}",
            )
            raw_town = _load_json(safe_file)
            towns[f.stem] = TownSpec.model_validate(raw_town).model_dump()
    if not towns:
        raise ValueError(f"scenario {config.id!r} has no towns/*.json files")
    for town_id, town in towns.items():
        map_spec = town.get("map")
        if map_spec is None:
            continue
        expected = {
            "kind": "tiled",
            "path": f"assets/maps/{config.id}/{town_id}.tmj",
            "preview_path": f"assets/maps/{config.id}/{town_id}-preview.png",
        }
        if map_spec != expected:
            raise ValueError(
                f"town {town_id!r} map paths must use its scenario-qualified asset namespace"
            )

    # Options data — data_file wins, then options/<id>.json, else empty dict.
    options_data: dict[str, dict] = {}
    for option in config.options:
        data: dict = {}
        if option.data_file:
            path = _scenario_descendant(
                scenario_dir,
                option.data_file,
                label=f"option {option.id!r} data_file",
            )
            if path.is_file():
                data = _load_json(path)
            else:
                raise FileNotFoundError(
                    f"option {option.id!r} declares a missing data_file: {path}"
                )
        else:
            default_path = _scenario_descendant(
                scenario_dir,
                f"options/{option.id}.json",
                label=f"option {option.id!r} default data file",
            )
            if default_path.is_file():
                data = _load_json(default_path)
        options_data[option.id] = OptionDataSpec.model_validate(data).model_dump()

    # Agents (optional at load time — a scenario being authored may not have
    # its roster yet; the orchestrator will simply have zero agents).
    agents: dict[str, list[AgentDefinition]] = {}
    agents_dir = _scenario_descendant(scenario_dir, "agents", label="agents directory")
    if agents_dir.is_dir():
        for town_dir in sorted(path for path in agents_dir.iterdir() if path.is_dir()):
            _scenario_descendant(
                scenario_dir,
                str(town_dir.relative_to(scenario_dir)),
                label=f"agent town directory {town_dir.name!r}",
            )
            for persona_file in sorted(town_dir.glob("*.md")):
                _scenario_descendant(
                    scenario_dir,
                    str(persona_file.relative_to(scenario_dir)),
                    label=f"persona file {persona_file.name!r}",
                )
        agents = load_all_agents(str(agents_dir))
    validate_agent_ids(agents)
    _validate_scenario_references(config, scenario_dir, towns, agents)
    _validate_agent_leans(config, agents)

    # Optional context extras (debate excerpts, logistics, ...).
    extras: dict[str, dict] = {}
    context_dir = _scenario_descendant(scenario_dir, "context", label="context directory")
    if context_dir.is_dir():
        for f in sorted(context_dir.glob("*.json")):
            safe_file = _scenario_descendant(
                scenario_dir,
                str(f.relative_to(scenario_dir)),
                label=f"context file {f.name!r}",
            )
            data = _load_json(safe_file)
            if not isinstance(data, dict):
                raise ValueError(f"context file {f.name!r} must contain a JSON object")
            if f.stem == "debate-excerpts":
                data = DebateContextSpec.model_validate(data).model_dump()
            elif f.stem == "logistics":
                data = LogisticsContextSpec.model_validate(data).model_dump()
            extras[f.stem] = data

    god_scenarios_path = _scenario_descendant(
        scenario_dir,
        "god-scenarios.json",
        label="God's View scenarios file",
    )
    god_scenarios: list[dict] = []
    if god_scenarios_path.is_file():
        raw_god_scenarios = _load_json(god_scenarios_path)
        if not isinstance(raw_god_scenarios, list):
            raise ValueError("god-scenarios.json must contain a JSON array")
        validated = [GodScenarioSpec.model_validate(item) for item in raw_god_scenarios]
        ids = [item.id for item in validated]
        if len(set(ids)) != len(ids):
            raise ValueError(f"duplicate God's View scenario ids: {ids}")
        for item in validated:
            unknown = [town for town in item.affected_towns if town not in towns]
            if unknown:
                raise ValueError(
                    f"God's View scenario {item.id!r} references unknown towns: {unknown}"
                )
        god_scenarios = [item.model_dump() for item in validated]

    demo_cache_path = _scenario_descendant(
        scenario_dir,
        "demo/simulation_cache.json",
        label="demo replay cache",
    )

    # News-id sanity: every round_plan news_id must exist.
    news_ids = {n.id for n in config.news}
    for spec in config.round_plan:
        missing = [i for i in spec.news_ids if i not in news_ids]
        if missing:
            raise ValueError(f"round {spec.round} references unknown news ids {missing}")

    logger.info(
        "Loaded scenario %r: %d towns, %d options, %d agents, %d rounds",
        config.id,
        len(towns),
        len(config.options),
        sum(len(v) for v in agents.values()),
        len(config.round_plan),
    )
    return Scenario(
        config=config,
        scenario_dir=scenario_dir,
        towns=towns,
        options_data=options_data,
        agents=agents,
        extras=extras,
        god_scenarios=god_scenarios,
        god_scenarios_path=god_scenarios_path,
        demo_cache_path=demo_cache_path,
    )


def load_scenario_with_fallback(scenario_id: str, project_root: Path | None = None) -> Scenario:
    """Load a named scenario package from ``scenarios/<id>``.

    The function name is retained as a compatibility import, but Township no
    longer synthesizes election data from a legacy root layout. Every civic
    fact must live in a scenario package so custom deployments cannot inherit
    unrelated candidates, towns, or news by accident.
    """
    if not _PACKAGE_ID_RE.fullmatch(scenario_id):
        raise ValueError("scenario id must use lowercase letters, numbers, and single hyphens")
    roots = scenario_search_roots(project_root)
    candidates = [
        _scenario_descendant(root, scenario_id, label="scenario package") for root in roots
    ]
    scenario_dir = next(
        (candidate for candidate in candidates if (candidate / "scenario.json").is_file()),
        candidates[0],
    )
    if (scenario_dir / "scenario.json").is_file():
        return load_scenario(scenario_dir)
    searched = ", ".join(str(root / scenario_id) for root in roots)
    raise FileNotFoundError(f"No scenario package found; searched: {searched}")
