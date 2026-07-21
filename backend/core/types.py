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


class AgentState(BaseModel):
    agent_id: str  # slug from filename
    definition: AgentDefinition
    current_location: str
    memories: list[str] = Field(default_factory=list)
    opinions: list[Opinion] = Field(default_factory=list)
    conversations: list[ConversationRecord] = Field(default_factory=list)
    state: CivicAgentState = CivicAgentState.IDLE

    @property
    def current_opinion(self) -> Opinion | None:
        return self.opinions[-1] if self.opinions else None

    def add_memory(self, memory: str):
        self.memories.append(memory)

    def get_recent_memories(self, n: int = 10) -> list[str]:
        return self.memories[-n:]


# ─── Simulation events (discriminated union, past-tense to match frontend) ───


class RoundStartedEvent(BaseModel):
    type: Literal["round_started"] = "round_started"
    round: int
    town: str | None = None
    total_rounds: int


class RoundEndedEvent(BaseModel):
    type: Literal["round_ended"] = "round_ended"
    round: int
    town: str | None = None
    # Wire-format TownSummary dicts (see backend/core/wire.py::town_summary_to_wire)
    summary: list[dict] = Field(default_factory=list)


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


class OpinionChangedEvent(BaseModel):
    type: Literal["opinion_changed"] = "opinion_changed"
    agent_id: str
    agent_name: str
    town: str
    old_opinion: Opinion | None = None
    new_opinion: Opinion


class NewsInjectedEvent(BaseModel):
    type: Literal["news_injected"] = "news_injected"
    headline: str
    description: str
    round: int = 0


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


class DistrictSummary(BaseModel):
    by_town: dict[str, TownSummary]
    consensus_zones: list[str]  # Issues where 70%+ agents agree
    fault_lines: list[str]  # Highest inter-town disagreement
    prediction: dict[str, float]  # candidate -> percentage
    total_agents: int
    total_conversations: int
    total_cost: float
    failed_agents: int = 0  # sum of failed agents across all towns
