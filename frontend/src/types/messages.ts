/* ── Township Type Definitions ─────────────────────────────── */

// Scenario-generic identifier aliases. Township is a scenario engine: the
// concrete option/town/registration vocabularies come from GET /api/scenario
// at runtime (see src/context/ScenarioContext.tsx). These aliases keep the
// wire types readable without baking any one scenario into the type system.
export type CandidateId = string;
export type TownId = string;
export type PoliticalRegistration = string;
export type LeanId = string;

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
  top_issues: string[];
  dealbreaker?: string | null;
  round_number?: number;
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
  // Frontend-only cosmetic fields (do not exist on the backend)
  activity?:
    | "walking"
    | "idle"
    | "working"
    | "talking"
    | "eating"
    | "praying"
    | "sleeping"
    | "thinking"
    | "celebrating"
    | "voting";
  sprite_key?: string;
  outfit_key?: string;
  accessory_key?: string;
  gesture?: "nod" | "shake_head" | "shrug" | "laugh" | "point" | "none";
  gesture_at?: string; // ISO timestamp — consumers can compare for decay
  mood?: "positive" | "negative" | "neutral";
  /** Per-agent idle-thought bank (sourced from agent .md frontmatter). */
  idle_thoughts?: string[];
  /** Optional routine — list of {time, location, activity}. */
  routine?: Array<{ time: string; location: string; activity: string }>;
  /** Optional relationship & goal metadata from agent .md. */
  relationships?: Record<string, string>;
  goals?: string[];
  /** Per-agent top concerns (sourced from agent .md frontmatter). */
  top_concerns?: string[];
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
  from_location?: string | null;
  to_location: string;
  /** Optional precise destination pixel coords; preferred over landmark lookup. */
  x?: number | null;
  y?: number | null;
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
  old_opinion?: Opinion | null;
  new_opinion: Opinion;
  confidence_delta?: number; // optional; frontend will compute if missing
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
  gesture?: "nod" | "shake_head" | "shrug" | "laugh" | "point" | "none";
}

export interface GodsViewResultEvent {
  type: "gods_view_result";
  prompt: string;
  reactions: NewsReaction[];
}

/* ── Ambient / atmospheric events ──────────────────────────── */

export interface WorldClockTickEvent {
  type: "world_clock_tick";
  hour: number;
  minute: number;
  town?: TownId;
}

export type WeatherKind = "clear" | "cloudy" | "rain" | "snow" | "fog";

export interface WeatherChangedEvent {
  type: "weather_changed";
  weather: WeatherKind;
  town?: TownId;
}

export interface RelationshipUpdateEvent {
  type: "relationship_update";
  agent_id: string;
  player_id: string;
  trust: number;
  delta: number;
  classification: "agreeable" | "challenging" | "curious" | "hostile";
}

export interface CrossTownGossipEvent {
  type: "cross_town_gossip";
  from_town: TownId;
  to_town: TownId;
  from_agent: string;
  to_agent: string;
  message: string;
}

export interface GodViewInjectionEvent {
  type: "god_view_injection";
  variable: string;
  description: string;
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
  | GodsViewResultEvent
  | WorldClockTickEvent
  | WeatherChangedEvent
  | RelationshipUpdateEvent
  | CrossTownGossipEvent
  | GodViewInjectionEvent;

/* ── Relationships (player ↔ agent) ────────────────────────── */

export interface Relationship {
  trust: number; // -100..100
  encounters: number;
  last_chat_at: string | null;
  topics_discussed: string[];
  last_classification?: "agreeable" | "challenging" | "curious" | "hostile";
  player_revealed_to_them?: {
    name: string;
    town: TownId;
    leaning: string;
    concerns: string[];
  };
}

export const TRUST_BAND = (
  t: number
): "hostile" | "guarded" | "warming" | "friend" =>
  t < -30 ? "hostile" : t < 0 ? "guarded" : t < 50 ? "warming" : "friend";

/* ── Town data (fetched from /api/towns) ───────────────────── */

export interface LandmarkData {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  type: string;
  color?: string;
  description?: string;
}

export interface TownData {
  name: string;
  tagline?: string;
  character?: string;
  accent_color?: string;
  weather_schedule?: WeatherKind[];
  ambient_sound?: string;
  landmarks: LandmarkData[];
  demographics?: Record<string, unknown>;
}

export interface TownDataResponse {
  towns: Record<TownId, TownData>;
}

/* ── Journal entries (player conversation history) ─────────── */

export interface JournalEntry {
  /** Backend wire shape — most fields are optional / best-effort. */
  agent_id: string;
  agent_name?: string;
  town?: TownId;
  created_at: string;
  transcript: { role: string; content: string; ts?: string }[];
  opinion_before?: { candidate?: string; confidence?: number } | null;
  opinion_after?: { candidate?: string; confidence?: number } | null;
  trust_before?: number;
  trust_after?: number;
}

/* ── Simulation Status ─────────────────────────────────────── */

export interface SimulationStatus {
  status: "idle" | "running" | "completed" | "error";
  current_round: number;
  total_rounds: number;
  agents_loaded: number;
  error?: string;
  /** Additive backend telemetry — present once a run has started. */
  towns?: TownId[];
  started_at?: string | null;
  completed_at?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_tokens?: number;
    cache_write_tokens?: number;
    cost_usd?: number;
    cache_hit_rate?: number;
  };
}

/* ── Chat response (POST /api/chat/{id}) ───────────────────── */

export type TrustBand = "hostile" | "guarded" | "warming" | "friend";

export interface ChatResponse {
  response: string;
  agent_id: string;
  agent_name: string;
  opinion: Opinion | null;
  trust: number;
  trust_band: TrustBand;
  opinion_changed: boolean;
}

/* ── God's View response (POST /api/gods-view) ─────────────── */

export interface OpinionShift {
  agent: string;
  town: TownId;
  before: LeanId;
  after: LeanId;
  confidence_change: number;
}

export interface GodsViewResponse {
  reactions: NewsReaction[];
  opinion_shifts: OpinionShift[];
}

/* ── NJ-11 fallback metadata ───────────────────────────────── */
//
// These tables describe the flagship NJ-11 scenario ONLY. They exist so the
// app renders fully offline (no backend) and are the seed for the synthetic
// fallback scenario in ScenarioContext. Components must NOT import these
// directly — use the useScenario() helpers (optionColor/optionLabel/townMeta)
// which resolve against the ACTIVE scenario and fall back to these values.

export const TOWN_META: Record<TownId, { name: string; tagline: string; population: string; color: string; county: string }> = {
  dover: {
    name: "Dover",
    tagline: "The Working-Class Heart",
    population: "18,435",
    color: "#C0792A",
    county: "Morris",
  },
  montclair: {
    name: "Montclair",
    tagline: "The Progressive Hub",
    population: "40,341",
    color: "#4A8FBF",
    county: "Essex",
  },
  parsippany: {
    name: "Parsippany",
    tagline: "The Suburban Melting Pot",
    population: "56,397",
    color: "#5D9E4F",
    county: "Morris",
  },
  randolph: {
    name: "Randolph",
    tagline: "The Republican Suburb",
    population: "26,604",
    color: "#8B7D6B",
    county: "Morris",
  },
};

export const CANDIDATE_COLORS: Record<LeanId, string> = {
  mejia: "#4A8FBF",
  hathaway: "#C0792A",
  bond: "#9A8E80",
  undecided: "#D1D5DB",
};

export const CANDIDATE_NAMES: Record<LeanId, string> = {
  mejia: "Mejia",
  hathaway: "Hathaway",
  bond: "Bond",
  undecided: "Undecided",
};

/* ── Scenario bootstrap (GET /api/scenario) ────────────────── */

export interface ScenarioOption {
  id: string;
  /** Full display name, e.g. "Analilia Mejia" / "The Riverwalk Greenway". */
  name: string;
  /** Short chip/legend label, e.g. "Mejia" / "Greenway". */
  label: string;
  color: string;
  group?: string | null;
}

export interface ScenarioTownInfo {
  id: string;
  name: string;
  tagline: string;
  color: string;
  county?: string;
  population?: number | string;
}

export interface ScenarioData {
  id: string;
  title: string;
  question: string;
  decision_kind: "election" | "vote";
  options: ScenarioOption[];
  undecided: { id: string; label: string; color: string };
  towns: ScenarioTownInfo[];
  total_rounds: number;
  dates: { decision_day: string; prose: string };
}
