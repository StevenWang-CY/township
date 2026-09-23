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
  /** Additive (Community I): voices speak through the model, neighbors are
   *  generated background residents run by the influence ledger. */
  tier?: "voice" | "neighbor";
  /** Additive: the town a resident belongs to (agent_moved.town may differ once they commute). */
  home_town?: string;
  /** Frontend-only: the resident has cast their ballot (decide phase). */
  decided?: boolean;
}

/** How a resident took a news item (backend NewsReaction vocabulary). */
export type EmotionalResponse = "angry" | "hopeful" | "anxious" | "indifferent" | "confused";
export type VoteImpact = "strengthens_current" | "weakens_current" | "changes_mind" | "no_effect";

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

export interface ElectionTally {
  mode: "ballots" | "straw_poll";
  tally: Record<string, number>;
  winner: string | null;
  margin: number;
  margin_pct: number;
  turnout: number;
  undecided?: number;
  abstained: number;
  eligible: number;
}

export interface TownSummary {
  town: TownId;
  round: number;
  opinions: Record<LeanId, number>;
  top_issues: string[];
  consensus_points: string[];
  fault_lines: string[];
  notable_conversations: string[];
  /** Additive: the town's ballot tally (or straw poll) when the engine computed one. */
  election?: ElectionTally | null;
  /** Additive: stance counts per tier ("voice" / "neighbor") so voices stay separable. */
  by_tier?: Record<string, Record<string, number>>;
}

export interface SwingResidentWire {
  agent_id: string;
  name: string;
  town: TownId;
  from: string;
  to: string;
  round: number;
  kind: "switched" | "decided";
}

export interface DistrictSummary {
  round: number;
  town_summaries: TownSummary[];
  overall_opinions: Record<LeanId, number>;
  cross_town_themes: string[];
  consensus_zones: string[];
  fault_lines: string[];
  /** Additive: district and per-town election tallies plus who moved. */
  election?: {
    mode: "ballots" | "straw_poll";
    per_town: Record<string, ElectionTally>;
    district: Omit<ElectionTally, "mode" | "undecided">;
    swing_residents: SwingResidentWire[];
  } | null;
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
  /** Additive (Community II): where the resident lives when `town` is the host town they commute to. */
  home_town?: string;
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

/** One cited cause of an opinion change (validated against the engine's ledger). */
export interface InfluenceRef {
  kind: "conversation" | "news" | "gossip" | "persona" | "seed" | "god_view" | "event";
  /** "conv:<id>" | "news:<id>" | "gossip:<id>" | "persona:<issue>" | "god:<n>" */
  ref: string;
  agent_id?: string | null;
  direction: "toward" | "away";
  weight: number;
  note?: string;
}

export interface OpinionTrigger {
  kind: "seed" | "conversation" | "news" | "reflection" | "decision" | "god_view" | "gossip";
  conversation_id?: string | null;
  partner_ids?: string[];
  news_id?: string | null;
  headline?: string | null;
}

export interface OpinionChangedEvent {
  type: "opinion_changed";
  agent_id: string;
  agent_name: string;
  town: TownId;
  old_opinion?: Opinion | null;
  new_opinion: Opinion;
  confidence_delta?: number; // optional; frontend will compute if missing
  /** Causal fields (additive; recordings before them omit these). */
  round?: number | null;
  trigger?: OpinionTrigger | null;
  influences?: InfluenceRef[];
  reason?: string | null;
  delta_confidence?: number | null;
}

/** A resident's ballot on decision day (option null = abstained). */
export interface BallotCastEvent {
  type: "ballot_cast";
  agent_id: string;
  agent_name: string;
  town: TownId;
  option: string | null;
  confidence: number;
  reason: string;
  round: number;
}

export interface NewsInjectedEvent {
  type: "news_injected";
  headline: string;
  description: string;
  round: number;
  /** Additive (campaign runs): the scenario news id and the towns whose
   *  residents reacted (empty = district-wide). */
  news_id?: string | null;
  towns?: TownId[];
}

export interface NewsReactionEvent {
  type: "news_reaction";
  reaction: NewsReaction;
}

/** Days of the campaign week as the backend calendar names them. */
export type Weekday = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

/** A campaign beat of the day ("early"/"night" appear on election day). */
export type CampaignBeat = "morning" | "midday" | "afternoon" | "evening" | "early" | "night" | (string & {});

export type RunPreset = "quick" | "campaign" | (string & {});

export interface RoundStartedEvent {
  type: "round_started";
  round: number;
  /** The town this round belongs to (towns run their rounds independently). */
  town?: TownId;
  total_rounds: number;
  /** Campaign calendar (additive; the quick plan and older recordings omit
   *  every one of these). `day` is 1-based, `date` is "YYYY-MM-DD". */
  day?: number | null;
  date?: string | null;
  weekday?: Weekday | null;
  beat?: CampaignBeat | null;
  /** A named beat, e.g. "Debate night in Montclair" or "Election day". */
  label?: string | null;
  preset?: RunPreset | null;
}

export interface RoundEndedEvent {
  type: "round_ended";
  round: number;
  town?: TownId;
  summary: TownSummary[];
  /** Residents who cast their ballot in this round's decide phase
   *  (additive; recordings made before it exist omit the field). */
  decided_agent_ids?: string[];
}

/** One round of the run's own plan (the campaign calendar expanded, or the
 *  quick plan) as `simulation_started.plan` carries it. */
export interface RunPlanEntry extends ScenarioRoundPlanEntry {
  day?: number | null;
  date?: string | null;
  weekday?: Weekday | null;
  beat?: CampaignBeat | null;
  label?: string | null;
}

export interface SimulationStartedEvent {
  type: "simulation_started";
  agents: AgentState[];
  towns: TownId[];
  /** Additive (campaign runs). */
  preset?: RunPreset | null;
  plan?: RunPlanEntry[];
  /** Set when the run resumed from a day checkpoint. */
  resumed_from_day?: number | null;
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
  /** Tone of the line as the backend classified it (always on the wire). */
  sentiment?: "positive" | "negative" | "neutral";
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
  /** Campaign calendar (additive). */
  day?: number | null;
  date?: string | null;
}

export type WeatherKind = "clear" | "cloudy" | "rain" | "snow" | "fog";

export interface WeatherChangedEvent {
  type: "weather_changed";
  weather: WeatherKind;
  town?: TownId;
}

export interface RelationshipUpdateEvent {
  /** @deprecated Private relationship changes are no longer broadcast. */
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

/** The district roll-up's tally: turnout and margins, no straw-poll fields. */
export type DistrictTally = Omit<ElectionTally, "mode" | "undecided">;

/** The count: one event per town on the results beat, then the district
 *  roll-up (`town` null) once every town has reported. */
export interface ElectionResultEvent {
  type: "election_result";
  /** The town that just counted, or null for the district roll-up. */
  town: TownId | null;
  per_town: Record<TownId, ElectionTally>;
  district: DistrictTally | null;
  round: number;
  day?: number | null;
  date?: string | null;
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
  | GodViewInjectionEvent
  | BallotCastEvent
  | ElectionResultEvent
;

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
  t < -30 ? "hostile" : t < 0 ? "guarded" : t <= 50 ? "warming" : "friend";

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
  map?: TownMapInfo | null;
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
    /** The provider serving this run ("mock", "claude-cli", "anthropic", …). */
    provider?: string;
    total_cost?: number;
  };
  /** Campaign calendar + transport (additive; merged from the orchestrator). */
  preset?: RunPreset | null;
  run_id?: string | null;
  day?: number | null;
  date?: string | null;
  weekday?: Weekday | null;
  beat?: CampaignBeat | null;
  label?: string | null;
  total_days?: number | null;
  /** 0..1 of the run's rounds. */
  progress?: number | null;
  paused?: boolean;
  /** "paused" for a user pause; a provider's own words when it paused the run. */
  paused_reason?: string | null;
  speed?: number;
  budget?: SimulationBudget | null;
  /** Why the run ended early ("budget", …), or null. */
  stopped_reason?: string | null;
  stopped_at?: string | null;
}

export interface SimulationBudget {
  spent: number;
  limit: number | null;
  estimate_per_beat: number;
  calls: number;
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
  /** Private to the initiating browser; never sent over the simulation WS. */
  relationship: Relationship | null;
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
  opinion_distribution_before: Record<LeanId, number>;
  opinion_distribution_after: Record<LeanId, number>;
}

/* ── Scenario bootstrap (GET /api/scenario) ────────────────── */

export interface ScenarioOption {
  id: string;
  /** Full display name, e.g. a candidate name or policy title. */
  name: string;
  /** Short chip/legend label. */
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
  map?: TownMapInfo | null;
}

export interface TownMapInfo {
  kind: "tiled";
  path: string;
  preview_path: string;
}

export interface ScenarioResponsibleUse {
  core_notice: string;
  residents_notice: string;
  subjects_notice: string;
  outputs_notice: string;
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
  /** Round-by-round phases + in-world clock (optional: older staged
   *  payloads and minimal test bootstraps omit it). */
  round_plan?: ScenarioRoundPlanEntry[];
  dates: { decision_day: string; prose: string };
  responsible_use: ScenarioResponsibleUse;
  /** The campaign calendar's facts when the package declares one. */
  campaign?: ScenarioCampaign | null;
  /** Start presets the backend accepts ("quick", and "campaign" when declared). */
  presets?: string[];
}

export interface ScenarioRoundPlanEntry {
  round: number;
  phases: string[];
  clock?: string;
}

export interface ScenarioCampaign {
  start_date: string;
  election_date: string;
  /** Calendar days in the full campaign, the morning after included. */
  days: number;
  total_rounds: number;
  beats_per_day: number;
}
