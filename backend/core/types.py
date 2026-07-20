from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field


class AgentDefinition(BaseModel):
    """Parsed from .md frontmatter + body"""
    name: str
    town: str
    description: str
    age: int
    occupation: str
    household: str
    income_bracket: str
    language: str
    political_registration: Literal["democrat", "republican", "unaffiliated"]
    initial_lean: Literal["mejia", "hathaway", "bond", "undecided"]
    top_concerns: list[str]
    tools: list[str]
    model: str
    system_prompt: str  # The markdown body

    # ── Phase 3 extensions (all OPTIONAL, preserve backward compat) ──
    routine: list[dict] = Field(default_factory=list)
    # Each entry: {time: "08:00", location: "La Finca", activity: "Opens restaurant"}

    relationships: list[dict] = Field(default_factory=list)
    # Each entry: {agent: "tom-kowalski", type: "friend", strength: 0.7, context: "..."}

    idle_thoughts: list[str] = Field(default_factory=list)

    goals: dict[str, str] = Field(default_factory=dict)
    # e.g. {"round_0": "Learn what each candidate stands for.", ...}


class CivicAgentState(StrEnum):
    IDLE = "idle"
    OBSERVING = "observing"
    DISCUSSING = "discussing"
    REFLECTING = "reflecting"
    DECIDED = "decided"
    ERROR = "error"


class Opinion(BaseModel):
    candidate: Literal["mejia", "hathaway", "bond", "undecided"]
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
    participants: list[str]            # agent ids
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
    type: Literal["relationship_update"] = "relationship_update"
    agent_id: str
    player_id: str
    trust: int
    delta: int
    classification: str


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
