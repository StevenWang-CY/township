/* ── Township Type Definitions ─────────────────────────────── */

export type CandidateId = "mejia" | "hathaway" | "bond";
export type TownId = "dover" | "montclair" | "parsippany" | "randolph";
export type PoliticalRegistration = "democrat" | "republican" | "unaffiliated";
export type LeanId = CandidateId | "undecided";

/* ── Agent ──────────────────────────────────────────────────── */

export interface AgentDefinition {
  id: string;
  name: string;
  town: TownId;
  description: string;
  age: number;
  occupation: string;
  household: string;
  income_bracket: string;
  language: string;
  political_registration: PoliticalRegistration;
  initial_lean: LeanId;
  top_concerns: string[];
}

export interface Opinion {
  candidate: LeanId;
  confidence: number; // 0-100
  reasoning: string;
  top_issue: string;
}

export interface AgentState {
  id: string;
  name: string;
  town: TownId;
  occupation: string;
  opinion: Opinion;
  location: string; // landmark name
  current_activity: string;
  initials: string;
  color: string;
}

/* ── Conversations ─────────────────────────────────────────── */

export interface Conversation {
  id: string;
  participants: string[]; // agent ids
  participant_names: string[];
  town: TownId;
  location: string;
  topic: string;
  summary: string;
  round: number;
  timestamp: string;
}

/* ── News ───────────────────────────────────────────────────── */

export interface NewsReaction {
  agent_id: string;
  agent_name: string;
  town: TownId;
  headline: string;
  emotional_response: string;
  impact_on_vote: string;
  reasoning: string;
}

/* ── Summaries ─────────────────────────────────────────────── */

export interface TownSummary {
  town: TownId;
  round: number;
  opinions: Record<LeanId, number>;
  top_issues: string[];
  consensus_points: string[];
  fault_lines: string[];
  notable_conversations: string[];
}

export interface DistrictSummary {
  round: number;
  town_summaries: TownSummary[];
  overall_opinions: Record<LeanId, number>;
  cross_town_themes: string[];
  consensus_zones: string[];
  fault_lines: string[];
}

/* ── Chat ───────────────────────────────────────────────────── */

export interface ChatMessage {
  id: string;
  role: "user" | "agent" | "system";
  content: string;
  timestamp: string;
  agent_id?: string;
}

/* ── Simulation Events (discriminated union) ───────────────── */

export interface AgentMovedEvent {
  type: "agent_moved";
  agent_id: string;
  agent_name: string;
  town: TownId;
  from_location: string;
  to_location: string;
}

export interface ConversationStartedEvent {
  type: "conversation_started";
  conversation: Conversation;
}

export interface ConversationEndedEvent {
  type: "conversation_ended";
  conversation_id: string;
  summary: string;
}

export interface OpinionChangedEvent {
  type: "opinion_changed";
  agent_id: string;
  agent_name: string;
  town: TownId;
  old_opinion: Opinion;
  new_opinion: Opinion;
}

export interface NewsInjectedEvent {
  type: "news_injected";
  headline: string;
  description: string;
  round: number;
}

export interface NewsReactionEvent {
  type: "news_reaction";
  reaction: NewsReaction;
}

export interface RoundStartedEvent {
  type: "round_started";
  round: number;
  total_rounds: number;
}

export interface RoundEndedEvent {
  type: "round_ended";
  round: number;
  summary: TownSummary[];
}

export interface SimulationStartedEvent {
  type: "simulation_started";
  agents: AgentState[];
  towns: TownId[];
}

export interface SimulationEndedEvent {
  type: "simulation_ended";
  summary: DistrictSummary;
}

export interface AgentSpeechEvent {
  type: "agent_speech";
  agent_id: string;
  agent_name: string;
  town: TownId;
  text: string;
  location: string;
}

export interface GodsViewResultEvent {
  type: "gods_view_result";
  prompt: string;
  reactions: NewsReaction[];
}

export type SimulationEvent =
  | AgentMovedEvent
  | ConversationStartedEvent
  | ConversationEndedEvent
  | OpinionChangedEvent
  | NewsInjectedEvent
  | NewsReactionEvent
  | RoundStartedEvent
  | RoundEndedEvent
  | SimulationStartedEvent
  | SimulationEndedEvent
  | AgentSpeechEvent
  | GodsViewResultEvent;

/* ── Simulation Status ─────────────────────────────────────── */

export interface SimulationStatus {
  status: "idle" | "running" | "completed" | "error";
  current_round: number;
  total_rounds: number;
  agents_loaded: number;
  error?: string;
}

/* ── Town metadata ─────────────────────────────────────────── */

export const TOWN_META: Record<TownId, { name: string; tagline: string; population: string; color: string; county: string }> = {
  dover: {
    name: "Dover",
    tagline: "The Working-Class Heart",
    population: "18,435",
    color: "#E8763B",
    county: "Morris",
  },
  montclair: {
    name: "Montclair",
    tagline: "The Progressive Hub",
    population: "40,341",
    color: "#6B5CE7",
    county: "Essex",
  },
  parsippany: {
    name: "Parsippany",
    tagline: "The Suburban Melting Pot",
    population: "56,397",
    color: "#2DA8A8",
    county: "Morris",
  },
  randolph: {
    name: "Randolph",
    tagline: "The Republican Suburb",
    population: "26,604",
    color: "#4A9B5C",
    county: "Morris",
  },
};

export const CANDIDATE_COLORS: Record<LeanId, string> = {
  mejia: "#3B82F6",
  hathaway: "#EF4444",
  bond: "#9CA3AF",
  undecided: "#D1D5DB",
};

export const CANDIDATE_NAMES: Record<LeanId, string> = {
  mejia: "Mejia",
  hathaway: "Hathaway",
  bond: "Bond",
  undecided: "Undecided",
};
