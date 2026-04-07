from pydantic import BaseModel, Field
from typing import Literal, Optional
from enum import Enum


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


class CivicAgentState(str, Enum):
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
    dealbreaker: Optional[str] = None
    round_number: int


class Conversation(BaseModel):
    agents: list[str]
    location: str
    topic: str
    dialogue: str
    key_takeaways: dict[str, str]  # agent_name -> takeaway
    round_number: int


class NewsReaction(BaseModel):
    agent_name: str
    event: str
    emotional_response: Literal["angry", "hopeful", "anxious", "indifferent", "confused"]
    impact_on_vote: Literal["strengthens_current", "weakens_current", "changes_mind", "no_effect"]
    reasoning: str


class AgentState(BaseModel):
    agent_id: str  # slug from filename
    definition: AgentDefinition
    current_location: str
    memories: list[str] = Field(default_factory=list)
    opinions: list[Opinion] = Field(default_factory=list)
    conversations: list[Conversation] = Field(default_factory=list)
    state: CivicAgentState = CivicAgentState.IDLE

    @property
    def current_opinion(self) -> Optional[Opinion]:
        return self.opinions[-1] if self.opinions else None

    def add_memory(self, memory: str):
        self.memories.append(memory)

    def get_recent_memories(self, n: int = 10) -> list[str]:
        return self.memories[-n:]


# Simulation events - discriminated union
class RoundAdvanceEvent(BaseModel):
    type: Literal["round_advance"] = "round_advance"
    round_number: int
    town: str


class AgentMoveEvent(BaseModel):
    type: Literal["agent_move"] = "agent_move"
    agent_id: str
    town: str
    location: str
    x: float
    y: float


class ConversationStartEvent(BaseModel):
    type: Literal["conversation_start"] = "conversation_start"
    agents: list[str]
    topic: str
    location: str
    town: str


class SpeechBubbleEvent(BaseModel):
    type: Literal["speech_bubble"] = "speech_bubble"
    agent_id: str
    text: str
    sentiment: Literal["positive", "negative", "neutral"]
    town: str


class OpinionChangeEvent(BaseModel):
    type: Literal["opinion_change"] = "opinion_change"
    agent_id: str
    town: str
    before: Optional[Opinion] = None
    after: Opinion


class NewsInjectionEvent(BaseModel):
    type: Literal["news_injection"] = "news_injection"
    headline: str
    description: str


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


class SimulationCompleteEvent(BaseModel):
    type: Literal["simulation_complete"] = "simulation_complete"
    district_summary: "DistrictSummary"


SimulationEvent = (
    RoundAdvanceEvent | AgentMoveEvent | ConversationStartEvent |
    SpeechBubbleEvent | OpinionChangeEvent | NewsInjectionEvent |
    CrossTownGossipEvent | GodViewInjectionEvent | SimulationCompleteEvent
)


class TownSummary(BaseModel):
    town: str
    opinion_distribution: dict[str, int]  # candidate -> count
    top_issues: list[dict[str, float]]  # [{issue, importance}]
    agent_summaries: list[dict]  # per-agent summary cards
    total_conversations: int
    rounds_completed: int


class DistrictSummary(BaseModel):
    by_town: dict[str, TownSummary]
    consensus_zones: list[str]  # Issues where 70%+ agents agree
    fault_lines: list[str]  # Highest inter-town disagreement
    prediction: dict[str, float]  # candidate -> percentage
    total_agents: int
    total_conversations: int
    total_cost: float


# Fix forward reference
SimulationCompleteEvent.model_rebuild()
