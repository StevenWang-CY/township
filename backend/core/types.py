import re
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

_CLOCK_RE = re.compile(r"^([01]?\d|2[0-3]):[0-5]\d$")


class AgentDefinition(BaseModel):
    """Parsed from .md frontmatter + body"""

    model_config = ConfigDict(extra="forbid")

    name: str
    town: str
    description: str
    age: int = Field(ge=0, le=125)
    occupation: str
    household: str
    income_bracket: str
    language: str
    # Free-form so any scenario can define its own registrations / stances.
    # Scenario-level validation happens in backend/core/scenario.py and the
    # persona lint tests — not here.
    political_registration: str
    initial_lean: str
    top_concerns: list[str] = Field(min_length=1, max_length=20)
    tools: list[Literal["Discuss", "FormOpinion", "ReactToNews", "ClassifyInteraction"]] = Field(
        min_length=1
    )
    # Optional per-resident pin. When omitted, the active provider's configured
    # default wins (for example OPENAI_MODEL or BEDROCK_MODEL_ID).
    model: str | None = None
    system_prompt: str  # The markdown body

    # ── Phase 3 extensions (all OPTIONAL, preserve backward compat) ──
    routine: list[dict] = Field(default_factory=list)
    # Each entry: {time: "08:00", location: "La Finca", activity: "Opens restaurant"}

    relationships: list[dict] = Field(default_factory=list)
    # Each entry: {agent: "tom-kowalski", type: "friend", strength: 0.7, context: "..."}

    idle_thoughts: list[str] = Field(default_factory=list)

    goals: dict[str, str] = Field(default_factory=dict)
    # e.g. {"round_0": "Learn what each candidate stands for.", ...}

    # ── Influence-model traits (all OPTIONAL; the engine derives defaults
    #    from registration and lean when a persona leaves them out) ──
    # How readily the resident moves toward an argument (0 = immovable).
    persuadability: float | None = Field(default=None, ge=0.0, le=1.0)
    # Pull toward the option that shares their political group.
    party_loyalty: float | None = Field(default=None, ge=0.0, le=1.0)
    # How much headlines land relative to conversations.
    media_diet: float | None = Field(default=None, ge=0.0, le=1.0)
    # Explicit issue weights (issue id → weight) override the top_concerns rank.
    issue_weights: dict[str, float] = Field(default_factory=dict)
    # Probability of turning out on decision day.
    turnout: float | None = Field(default=None, ge=0.0, le=1.0)
    # "voice" personas speak through the LLM; "neighbor" residents (generated
    # background population) live entirely in the influence model.
    tier: Literal["voice", "neighbor"] = "voice"

    @field_validator(
        "name",
        "town",
        "description",
        "occupation",
        "household",
        "income_bracket",
        "language",
        "political_registration",
        "initial_lean",
        "system_prompt",
    )
    @classmethod
    def _required_persona_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("persona text fields must not be empty")
        return value

    @field_validator("model")
    @classmethod
    def _optional_model_is_visible(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("persona model must not be blank")
        return value

    @field_validator("top_concerns", "idle_thoughts")
    @classmethod
    def _nonblank_string_lists(cls, values: list[str]) -> list[str]:
        cleaned = [value.strip() for value in values]
        if any(not value for value in cleaned):
            raise ValueError("persona concern/thought lists must contain non-empty strings")
        if len({value.casefold() for value in cleaned}) != len(cleaned):
            raise ValueError("persona concern/thought lists must not contain duplicates")
        return cleaned

    @field_validator("routine")
    @classmethod
    def _valid_routine(cls, values: list[dict]) -> list[dict]:
        if len(values) > 48:
            raise ValueError("persona routine may contain at most 48 entries")
        cleaned: list[dict] = []
        seen_times: set[str] = set()
        for entry in values:
            if not isinstance(entry, dict):
                raise ValueError("routine entries must be objects")
            time = entry.get("time")
            location = entry.get("location")
            activity = entry.get("activity")
            if not isinstance(time, str) or not _CLOCK_RE.fullmatch(time.strip()):
                raise ValueError("routine time must be HH:MM in 24-hour form")
            if not isinstance(location, str) or not location.strip():
                raise ValueError("routine location must be a non-empty string")
            if not isinstance(activity, str) or not activity.strip():
                raise ValueError("routine activity must be a non-empty string")
            time = time.strip()
            if time in seen_times:
                raise ValueError("routine entries must not repeat a time")
            seen_times.add(time)
            cleaned.append(
                {
                    **entry,
                    "time": time,
                    "location": location.strip(),
                    "activity": activity.strip(),
                }
            )
        return cleaned

    @field_validator("relationships")
    @classmethod
    def _valid_relationships(cls, values: list[dict]) -> list[dict]:
        if len(values) > 50:
            raise ValueError("persona relationships may contain at most 50 entries")
        cleaned: list[dict] = []
        targets: set[str] = set()
        for entry in values:
            if not isinstance(entry, dict):
                raise ValueError("relationship entries must be objects")
            target = entry.get("agent")
            relation_type = entry.get("type")
            context = entry.get("context")
            strength = entry.get("strength")
            if not isinstance(target, str) or not target.strip():
                raise ValueError("relationship agent must be a non-empty string")
            if not isinstance(relation_type, str) or not relation_type.strip():
                raise ValueError("relationship type must be a non-empty string")
            if not isinstance(context, str) or not context.strip():
                raise ValueError("relationship context must be a non-empty string")
            if (
                isinstance(strength, bool)
                or not isinstance(strength, (int, float))
                or not 0 <= strength <= 1
            ):
                raise ValueError("relationship strength must be numeric from 0 to 1")
            key = target.strip().casefold()
            if key in targets:
                raise ValueError("persona relationships must not repeat an agent")
            targets.add(key)
            cleaned.append(
                {
                    **entry,
                    "agent": target.strip(),
                    "type": relation_type.strip(),
                    "context": context.strip(),
                }
            )
        return cleaned

    @field_validator("goals")
    @classmethod
    def _valid_goals(cls, values: dict[str, str]) -> dict[str, str]:
        cleaned: dict[str, str] = {}
        for key, value in values.items():
            if not re.fullmatch(r"round_[0-9]+", key):
                raise ValueError("persona goal keys must use round_<number>")
            if not isinstance(value, str) or not value.strip():
                raise ValueError("persona goals must be non-empty strings")
            cleaned[key] = value.strip()
        return cleaned


class CivicAgentState(StrEnum):
    IDLE = "idle"
    OBSERVING = "observing"
    DISCUSSING = "discussing"
    REFLECTING = "reflecting"
    DECIDED = "decided"
    ERROR = "error"


class Opinion(BaseModel):
    # `candidate` is the wire-stable field name for "current stance" — its
    # value is one of the active scenario's stance ids (options + undecided),
    # enforced via scenario.validate_stance() wherever Opinions are minted.
    candidate: str
    confidence: int = Field(ge=0, le=100)
    reasoning: str
    top_issues: list[str]
    dealbreaker: str | None = None
    round_number: int


class Conversation(BaseModel):
    """
    Wire-level conversation payload (matches the frontend Conversation interface
    exactly — see frontend/src/types/messages.ts).
    """

    id: str
    participants: list[str]  # agent ids
    participant_names: list[str]
    town: str
    location: str
    topic: str
    summary: str = ""
    round: int
    timestamp: str


# Legacy internal conversation record (used by AgentState memory storage).
# Kept under a distinct name so the wire-level `Conversation` model can match
# the frontend exactly without breaking persisted state.
class ConversationRecord(BaseModel):
    agents: list[str]
    location: str
    topic: str
    dialogue: str
    key_takeaways: dict[str, str]
    round_number: int
    # ── Model II additions (optional for persisted states) ──
    id: str | None = None
    # agent id → stance held when they spoke
    partner_stances: dict[str, str] = Field(default_factory=dict)
    # agent id → sentiment of their lines
    sentiments: dict[str, str] = Field(default_factory=dict)


class NewsReaction(BaseModel):
    # Optional extensions so the wire payload can carry agent_id / town / headline
    # exactly as the frontend NewsReaction expects (frontend/src/types/messages.ts).
    agent_id: str | None = None
    agent_name: str
    town: str | None = None
    headline: str | None = None
    # Kept for backwards-compat with older callers that set `event` instead of
    # `headline`. The wire DTO prefers `headline`.
    event: str | None = None
    emotional_response: Literal["angry", "hopeful", "anxious", "indifferent", "confused"]
    impact_on_vote: Literal["strengthens_current", "weakens_current", "changes_mind", "no_effect"]
    reasoning: str


class LedgerEntry(BaseModel):
    """One recorded push on a resident's beliefs (the source of every cause)."""

    round: int
    kind: Literal["seed", "conversation", "news", "gossip", "god_view", "event", "reflection"]
    # "conv:<id>" | "news:<id>" | "gossip:<id>" | "persona:<concern>" | "god:<id>"
    ref: str
    agent_id: str | None = None  # the other party, when there is one
    option: str
    delta: float
    note: str = ""


class Beliefs(BaseModel):
    """The influence model's per-resident state (see simulation/influence.py)."""

    # option id → utility (higher = preferred); the read-out stance is the argmax
    utilities: dict[str, float] = Field(default_factory=dict)
    # issue id → normalised weight
    weights: dict[str, float] = Field(default_factory=dict)
    # persuadability, party_loyalty, media_diet
    traits: dict[str, float] = Field(default_factory=dict)
    ledger: list[LedgerEntry] = Field(default_factory=list)
    # count of distinct pushes since the seed (feeds confidence)
    evidence: int = 0
    # the round of the resident's last opinion read-out
    last_reflection_round: int = 0
    # ── long-run dynamics ──
    # the persona's own utilities; pushes decay back toward them beat by beat
    anchor: dict[str, float] = Field(default_factory=dict)
    # "speaker:option" → how often that argument has landed (0.6^n gain)
    habituation: dict[str, int] = Field(default_factory=dict)
    # consecutive read-outs with the same favourite (firms confidence)
    streak: int = 0
    last_top: str | None = None


class MemoryRecord(BaseModel):
    """Typed memory with the refs the resident may cite when they change their mind."""

    kind: Literal[
        "seed", "conversation", "news", "gossip", "reflection", "ballot", "god_view", "event"
    ]
    round: int
    text: str
    refs: list[str] = Field(default_factory=list)
    salience: float = 0.5


class Ballot(BaseModel):
    option: str | None  # None = abstained
    confidence: int = Field(ge=0, le=100)
    reason: str = ""
    round: int


class AgentState(BaseModel):
    agent_id: str  # slug from filename
    definition: AgentDefinition
    current_location: str
    memories: list[str] = Field(default_factory=list)
    opinions: list[Opinion] = Field(default_factory=list)
    conversations: list[ConversationRecord] = Field(default_factory=list)
    state: CivicAgentState = CivicAgentState.IDLE
    # ── Model II (all optional so persisted states before it still load) ──
    beliefs: Beliefs | None = None
    memory_records: list[MemoryRecord] = Field(default_factory=list)
    ballot: Ballot | None = None
    # The town the resident is in right now (commuting, events); None = home.
    current_town: str | None = None
    # Gossip waiting to be retold: (topic, ref)
    pending_topics: list[list[str]] = Field(default_factory=list)
    # Relationships that grew during the run: agent id → trust 0..1
    relationships_dyn: dict[str, float] = Field(default_factory=dict)

    @property
    def current_opinion(self) -> Opinion | None:
        return self.opinions[-1] if self.opinions else None

    def add_memory(self, memory: str):
        self.memories.append(memory)

    def remember(
        self,
        kind: str,
        round_num: int,
        text: str,
        refs: list[str] | None = None,
        salience: float = 0.5,
    ) -> None:
        """Record a memory both as the legacy string and as a typed record."""
        self.memories.append(text)
        self.memory_records.append(
            MemoryRecord(
                kind=kind,  # type: ignore[arg-type]
                round=round_num,
                text=text,
                refs=list(refs or []),
                salience=salience,
            )
        )

    def get_recent_memories(self, n: int = 10) -> list[str]:
        return self.memories[-n:]


# ─── Simulation events (discriminated union, past-tense to match frontend) ───


class RoundStartedEvent(BaseModel):
    type: Literal["round_started"] = "round_started"
    round: int
    town: str | None = None
    total_rounds: int
    # ── Campaign calendar (additive; the quick plan leaves these None) ──
    day: int | None = None
    date: str | None = None
    weekday: str | None = None
    beat: str | None = None
    label: str | None = None
    preset: str | None = None


class RoundEndedEvent(BaseModel):
    type: Literal["round_ended"] = "round_ended"
    round: int
    town: str | None = None
    # Wire-format TownSummary dicts (see backend/core/wire.py::town_summary_to_wire)
    summary: list[dict] = Field(default_factory=list)
    # Residents who cast their ballot in this round's ``decide`` phase. Additive:
    # the frontend also derives decisions from the final summary, so recordings
    # made before this field existed still replay the election.
    decided_agent_ids: list[str] = Field(default_factory=list)


class AgentMovedEvent(BaseModel):
    type: Literal["agent_moved"] = "agent_moved"
    agent_id: str
    agent_name: str
    town: str
    from_location: str | None = None
    to_location: str
    # Coordinates (used by the Phaser scene when available)
    x: float | None = None
    y: float | None = None

    # Backwards-compatible alias getters
    @property
    def location(self) -> str:
        return self.to_location


class ConversationStartedEvent(BaseModel):
    type: Literal["conversation_started"] = "conversation_started"
    conversation: Conversation


class ConversationEndedEvent(BaseModel):
    type: Literal["conversation_ended"] = "conversation_ended"
    conversation_id: str
    summary: str = ""


class AgentSpeechEvent(BaseModel):
    type: Literal["agent_speech"] = "agent_speech"
    agent_id: str
    agent_name: str
    town: str
    text: str
    location: str = ""
    sentiment: Literal["positive", "negative", "neutral"] = "neutral"
    gesture: str | None = None  # nod | shake_head | shrug | laugh | point | none


class InfluenceRef(BaseModel):
    """One cited cause of an opinion change (validated against the ledger)."""

    kind: Literal["conversation", "news", "gossip", "persona", "seed", "god_view", "event"]
    ref: str  # "conv:<id>" | "news:<id>" | "gossip:<id>" | "persona:<concern>" | "god:<id>"
    agent_id: str | None = None
    direction: Literal["toward", "away"] = "toward"
    weight: float = Field(default=0.5, ge=0.0, le=1.0)
    note: str = Field(default="", max_length=160)


class OpinionTrigger(BaseModel):
    """What prompted the read-out that changed (or restated) the opinion."""

    kind: Literal["seed", "conversation", "news", "reflection", "decision", "god_view", "gossip"]
    conversation_id: str | None = None
    partner_ids: list[str] = Field(default_factory=list)
    news_id: str | None = None
    headline: str | None = None


class OpinionChangedEvent(BaseModel):
    type: Literal["opinion_changed"] = "opinion_changed"
    agent_id: str
    agent_name: str
    town: str
    old_opinion: Opinion | None = None
    new_opinion: Opinion
    # ── Causal fields (additive; recordings before them omit these) ──
    round: int | None = None
    trigger: OpinionTrigger | None = None
    influences: list[InfluenceRef] = Field(default_factory=list)
    reason: str | None = Field(default=None, max_length=200)
    delta_confidence: int | None = None


class BallotCastEvent(BaseModel):
    """A resident's ballot on decision day (option None = abstained)."""

    type: Literal["ballot_cast"] = "ballot_cast"
    agent_id: str
    agent_name: str
    town: str
    option: str | None
    confidence: int = Field(ge=0, le=100)
    reason: str = ""
    round: int


class NewsInjectedEvent(BaseModel):
    type: Literal["news_injected"] = "news_injected"
    headline: str
    description: str
    round: int = 0
    # ── additive: the scenario's news id and the towns it reached (empty = all) ──
    news_id: str | None = None
    towns: list[str] = Field(default_factory=list)


class ElectionResultEvent(BaseModel):
    """The tally published on the results beat (per town, then the district)."""

    type: Literal["election_result"] = "election_result"
    town: str | None = None  # None = the district roll-up
    per_town: dict[str, dict] = Field(default_factory=dict)
    district: dict | None = None
    round: int = 0
    day: int | None = None
    date: str | None = None


class NewsReactionEvent(BaseModel):
    type: Literal["news_reaction"] = "news_reaction"
    reaction: NewsReaction


class CrossTownGossipEvent(BaseModel):
    type: Literal["cross_town_gossip"] = "cross_town_gossip"
    from_town: str
    to_town: str
    from_agent: str
    to_agent: str
    message: str


class GodViewInjectionEvent(BaseModel):
    type: Literal["god_view_injection"] = "god_view_injection"
    variable: str
    description: str


class GodsViewResultEvent(BaseModel):
    type: Literal["gods_view_result"] = "gods_view_result"
    prompt: str
    # Wire-format reaction dicts (see backend/core/wire.py::news_reaction_to_wire).
    # We intentionally keep this loose — the route serializes Pydantic models
    # into the exact frontend `NewsReaction` shape before publishing.
    reactions: list[dict] = Field(default_factory=list)


class SimulationStartedEvent(BaseModel):
    type: Literal["simulation_started"] = "simulation_started"
    agents: list[dict] = Field(default_factory=list)
    towns: list[str] = Field(default_factory=list)
    # ── Campaign calendar (additive) ──
    preset: str | None = None
    # [{round, phases, clock, day, date, beat, label}] — the run's own plan
    plan: list[dict] = Field(default_factory=list)
    resumed_from_day: int | None = None


class SimulationEndedEvent(BaseModel):
    type: Literal["simulation_ended"] = "simulation_ended"
    # Wire-format DistrictSummary dict (see backend/core/wire.py::district_summary_to_wire)
    summary: dict = Field(default_factory=dict)


# ── New ambient / atmospheric events (§3.2, §5.2, §7) ──


class WorldClockTickEvent(BaseModel):
    type: Literal["world_clock_tick"] = "world_clock_tick"
    hour: int
    minute: int
    town: str | None = None
    day: int | None = None
    date: str | None = None


class WeatherChangedEvent(BaseModel):
    type: Literal["weather_changed"] = "weather_changed"
    weather: Literal["clear", "cloudy", "rain", "snow", "fog"]
    town: str | None = None


class RelationshipUpdateEvent(BaseModel):
    """Deprecated legacy wire shape; private relationship state is HTTP-only."""

    type: Literal["relationship_update"] = "relationship_update"
    agent_id: str
    player_id: str
    trust: int
    delta: int
    classification: str


# Browser-private state must never enter the shared EventBus, persisted run
# artifacts, exports, or replay stream. Keep the legacy model deserializable so
# old caches remain readable, but centralize the deny-list used at every egress.
PRIVATE_EVENT_TYPES = frozenset({"relationship_update"})


def is_private_event(event: Any) -> bool:
    event_type = event.get("type") if isinstance(event, dict) else getattr(event, "type", None)
    return event_type in PRIVATE_EVENT_TYPES


SimulationEvent = (
    RoundStartedEvent
    | RoundEndedEvent
    | AgentMovedEvent
    | ConversationStartedEvent
    | ConversationEndedEvent
    | AgentSpeechEvent
    | OpinionChangedEvent
    | NewsInjectedEvent
    | NewsReactionEvent
    | CrossTownGossipEvent
    | GodViewInjectionEvent
    | GodsViewResultEvent
    | SimulationStartedEvent
    | SimulationEndedEvent
    | WorldClockTickEvent
    | WeatherChangedEvent
    | RelationshipUpdateEvent
)


class TownSummary(BaseModel):
    town: str
    opinion_distribution: dict[str, int]  # candidate -> count
    top_issues: list[dict] = Field(default_factory=list)  # [{"issue": str, "importance": float}]
    agent_summaries: list[dict]  # per-agent summary cards
    total_conversations: int
    rounds_completed: int
    failed_agents: int = 0  # agents whose LLM calls errored out
    # ── Model II (additive) ──
    # {"mode": "ballots"|"straw_poll", "tally": {...}, "winner": id|None, "margin": int,
    #  "margin_pct": float, "turnout": float, "undecided": int, "abstained": int, "eligible": int}
    election: dict | None = None
    # "Carlos & Tom at Bodega Row (r2): rent" — the conversations that moved people most
    notable_conversations: list[str] = Field(default_factory=list)
    # issues most residents rank at the top
    consensus_points: list[str] = Field(default_factory=list)


class DistrictSummary(BaseModel):
    by_town: dict[str, TownSummary]
    consensus_zones: list[str]  # Issues where 70%+ agents agree
    fault_lines: list[str]  # Highest inter-town disagreement
    prediction: dict[str, float]  # candidate -> percentage
    total_agents: int
    total_conversations: int
    total_cost: float
    failed_agents: int = 0  # sum of failed agents across all towns
    # ── Model II (additive) ──
    # {"mode", "per_town": {town: TownSummary.election}, "district": {...},
    #  "swing_residents": [{agent_id, name, town, from, to, round, trigger}]}
    election: dict | None = None
    # top gossip topics that crossed town lines
    cross_town_themes: list[str] = Field(default_factory=list)
