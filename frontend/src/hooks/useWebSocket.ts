import { useReducer, useEffect, useRef, useCallback } from "react";
import type {
  SimulationEvent,
  AgentState,
  Conversation,
  TownSummary,
  DistrictSummary,
  WeatherKind,
  Relationship,
  NewsReaction,
  ElectionResultEvent,
  ElectionTally,
  RunPlanEntry,
} from "../types/messages";
import {
  attributeOpinion,
  PENDING_LIMIT,
  type InfluenceEdge,
  type OpinionPoint,
  type PendingCauses,
} from "../lib/attribution";
import { dayOrdinal, normalizeWeekday, totalDaysOf, type CalendarState } from "../lib/calendar";

/** Raw per-town phase signals for the current round. The scene decides what
 *  they mean against the scenario's round plan (see TownView.resolvePhase);
 *  the reducer only records which triggers fired. */
export interface RoundSignals {
  round: number;
  /** A resident spoke this round (converse phase under way). */
  converse: boolean;
  /** The round's news landed (news_injected for the round, or a reaction). */
  news: boolean;
  /** An opinion event landed this round. */
  opinion: boolean;
  /** round_ended arrived. */
  ended: boolean;
}

export interface Headline {
  round: number;
  headline: string;
  description: string;
}

function signalRound(
  state: WsState,
  town: string | undefined,
  key: "converse" | "news" | "opinion" | "ended",
): Record<string, RoundSignals> {
  if (!town) return state.roundSignals;
  const sig = state.roundSignals[town] ?? { round: state.currentRound, converse: false, news: false, opinion: false, ended: false };
  if (sig[key]) return state.roundSignals;
  return { ...state.roundSignals, [town]: { ...sig, [key]: true } };
}

/* ── State ──────────────────────────────────────────────────── */
//
// The reducer, initial state, and their types are exported so the zero-backend
// demo player (src/hooks/useDemoFeed.ts) can replay a recorded event stream
// through EXACTLY the same state machine the live WebSocket uses. Keep the
// reducer pure: seeking in the demo player re-reduces an event prefix from
// initialState synchronously.

export interface WsState {
  connected: boolean;
  agents: Record<string, AgentState>;
  /** Scenario roster known to the transport even before its first event is
   *  applied. Live mode fills this from simulation_started; replay mode primes
   *  it from the finite feed without advancing the playhead. */
  agentRoster: Record<string, AgentState>;
  conversations: Conversation[];
  /** Bounded live event window, or the complete applied prefix in replay mode. */
  events: SimulationEvent[];
  /** Absolute number of transport events applied to this state. Unlike
   *  `events.length`, this remains meaningful after the live window trims and
   *  may move backward when a replay seeks. */
  eventCursor: number;
  /** Absolute cursor represented by `events[0]`. Consumers can translate an
   *  absolute cursor into the bounded array without guessing about trims. */
  eventHistoryStart: number;
  /** Last precise coordinates supplied for each resident by agent_moved.
   *  This is reducer-owned playback state, not an addition to the wire DTO. */
  agentPositions: Record<string, { location: string; x?: number; y?: number; town?: string }>;
  /** Additive (Community II): the town each resident is in right now — home
   *  until an agent_moved says otherwise (commuters, event visitors). */
  agentTowns: Record<string, string>;
  /** Keyed lazily by town id as round_ended events stream in — no scenario
   *  town roster is assumed here. */
  townSummaries: Record<string, TownSummary>;
  currentRound: number;
  totalRounds: number;
  simulationRunning: boolean;
  worldClock: { hour: number; minute: number };
  weather: WeatherKind;
  relationships: Record<string, Relationship>;
  newsReactions: NewsReaction[];
  /** Per-town phase triggers for the town's current round. */
  roundSignals: Record<string, RoundSignals>;
  /** Every headline injected so far, in order, deduped by round + text. */
  headlines: Headline[];
  /** The district summary once the run has ended. */
  finalSummary: DistrictSummary | null;
  /** Ballots cast this run, by resident (option null = abstained). */
  ballots: Record<string, { option: string | null; confidence: number; reason: string; round: number }>;
  /** Where the campaign calendar stands (null for the quick plan and for
   *  recordings made before the calendar existed). */
  calendar: CalendarState | null;
  /** The run's own plan from simulation_started (empty for old recordings). */
  runPlan: RunPlanEntry[];
  /** The district roll-up once the count is in (election night). */
  electionResult: ElectionResultEvent | null;
  /** Each town's count as it reports, keyed by town id. */
  townResults: Record<string, ElectionTally>;
  /** Additive (Evolution): each resident's opinion trajectory, oldest first,
   *  every point carrying its cause (engine citations or derived here). */
  opinionHistory: Record<string, OpinionPoint[]>;
  /** Who moved whom: one edge per cited influence with a source (live cap). */
  influenceEdges: InfluenceEdge[];
  /** What each resident heard since their last opinion — attribution fodder,
   *  flushed on their next opinion_changed. */
  pendingCauses: Record<string, PendingCauses>;
}

export const initialState: WsState = {
  connected: false,
  agents: {},
  agentRoster: {},
  conversations: [],
  events: [],
  eventCursor: 0,
  eventHistoryStart: 0,
  agentPositions: {},
  agentTowns: {},
  townSummaries: {},
  currentRound: 0,
  totalRounds: 0,
  simulationRunning: false,
  worldClock: { hour: 8, minute: 0 },
  weather: "clear",
  relationships: {},
  newsReactions: [],
  roundSignals: {},
  headlines: [],
  finalSummary: null,
  ballots: {},
  calendar: null,
  runPlan: [],
  electionResult: null,
  townResults: {},
  opinionHistory: {},
  influenceEdges: [],
  pendingCauses: {},
};

/* ── Reducer ────────────────────────────────────────────────── */

export type WsAction =
  | { type: "CONNECTED" }
  | { type: "DISCONNECTED" }
  | { type: "EVENT"; payload: SimulationEvent };

/** A live socket can run indefinitely, so history-bearing collections must
 *  have hard ceilings. A staged replay is already a finite, loaded artifact
 *  and uses the same reducer with complete event retention. */
export const LIVE_EVENT_HISTORY_LIMIT = 500;
const LIVE_CONVERSATION_HISTORY_LIMIT = 200;
export const LIVE_INFLUENCE_EDGE_LIMIT = 400;

function withPending(
  pending: Record<string, PendingCauses>,
  agentId: string,
  patch: (p: PendingCauses) => PendingCauses,
): Record<string, PendingCauses> {
  const cur = pending[agentId] ?? { conversations: [], news: [], gossip: [] };
  return { ...pending, [agentId]: patch(cur) };
}

function tail<T>(xs: T[], x: T): T[] {
  return [...xs, x].slice(-PENDING_LIMIT);
}

function reduceWithEventLimit(
  state: WsState,
  action: WsAction,
  eventHistoryLimit: number,
): WsState {
  switch (action.type) {
    case "CONNECTED":
      return { ...state, connected: true };
    case "DISCONNECTED":
      return { ...state, connected: false };
    case "EVENT": {
      const evt = action.payload;
      const eventCursor = state.eventCursor + 1;
      const appendedEvents = [...state.events, evt];
      const newEvents = Number.isFinite(eventHistoryLimit)
        ? appendedEvents.slice(-eventHistoryLimit)
        : appendedEvents;
      const base: WsState = {
        ...state,
        events: newEvents,
        eventCursor,
        eventHistoryStart: eventCursor - newEvents.length,
      };

      switch (evt.type) {
        case "simulation_started": {
          const agentsMap: Record<string, AgentState> = {};
          for (const a of evt.agents) agentsMap[a.id] = a;
          const agentTowns: Record<string, string> = {};
          for (const a of evt.agents) agentTowns[a.id] = a.town;
          return {
            ...base,
            agents: agentsMap,
            agentRoster: agentsMap,
            conversations: [],
            events: [evt],
            eventHistoryStart: eventCursor - 1,
            agentPositions: {},
            agentTowns,
            opinionHistory: {},
            influenceEdges: [],
            pendingCauses: {},
            townSummaries: {},
            currentRound: 0,
            totalRounds: 0,
            simulationRunning: true,
            worldClock: initialState.worldClock,
            weather: initialState.weather,
            newsReactions: [],
            roundSignals: {},
            headlines: [],
            finalSummary: null,
            ballots: {},
            // The calendar starts blank; the first round_started fills it.
            // A run that carries no plan (older recordings) keeps none.
            calendar: null,
            runPlan: Array.isArray(evt.plan) ? evt.plan : [],
            electionResult: null,
            townResults: {},
          };
        }

        case "simulation_ended": {
          // The decide phase emits no event of its own in older recordings:
          // by the end of the run every resident has cast their ballot.
          const agents: Record<string, AgentState> = {};
          for (const [id, a] of Object.entries(state.agents)) agents[id] = { ...a, decided: true };
          return { ...base, agents, simulationRunning: false, finalSummary: evt.summary ?? null };
        }

        case "round_started": {
          // The campaign calendar rides on round_started; a round without a
          // day (the quick plan, every older recording) leaves it untouched.
          const calendar: CalendarState | null = typeof evt.day === "number"
            ? {
              day: evt.day,
              dayIndex: dayOrdinal(state.runPlan, evt.day),
              date: evt.date ?? state.calendar?.date ?? null,
              weekday: normalizeWeekday(evt.weekday) ?? state.calendar?.weekday ?? null,
              beat: evt.beat ?? null,
              label: evt.label ?? null,
              totalDays: totalDaysOf(state.runPlan) ?? state.calendar?.totalDays ?? null,
              preset: evt.preset ?? state.calendar?.preset ?? null,
            }
            : state.calendar;
          return {
            ...base,
            currentRound: evt.round,
            totalRounds: evt.total_rounds,
            calendar,
            roundSignals: evt.town
              ? {
                ...state.roundSignals,
                [evt.town]: { round: evt.round, converse: false, news: false, opinion: false, ended: false },
              }
              : state.roundSignals,
          };
        }

        case "round_ended": {
          const summaries = { ...state.townSummaries };
          for (const s of evt.summary) summaries[s.town] = s;
          let agents = state.agents;
          if (evt.decided_agent_ids && evt.decided_agent_ids.length > 0) {
            agents = { ...state.agents };
            for (const id of evt.decided_agent_ids) {
              if (agents[id]) agents[id] = { ...agents[id], decided: true };
            }
          }
          return { ...base, townSummaries: summaries, agents, roundSignals: signalRound(state, evt.town, "ended") };
        }

        case "agent_moved": {
          // `town` is where the move happens — a commuter's host town for the
          // beat — so the presence table follows it; positions remember it
          // too, so a scene never seats someone on another town's coordinates.
          const position = {
            location: evt.to_location,
            x: evt.x ?? undefined,
            y: evt.y ?? undefined,
            town: evt.town,
          };
          const agentTowns = { ...state.agentTowns, [evt.agent_id]: evt.town };
          const agentPositions = { ...state.agentPositions, [evt.agent_id]: position };
          if (!state.agents[evt.agent_id]) return { ...base, agentPositions, agentTowns };
          return {
            ...base,
            agents: {
              ...state.agents,
              [evt.agent_id]: {
                ...state.agents[evt.agent_id],
                location: evt.to_location,
                activity: "walking",
              },
            },
            agentPositions,
            agentTowns,
          };
        }
        case "opinion_changed": {
          const known = state.agents[evt.agent_id];
          // Engine citations pass through; the flagship replay's changes are
          // attributed from what the resident heard since their last opinion.
          const attribution = attributeOpinion(
            evt,
            state.pendingCauses[evt.agent_id],
            (id) => state.agents[id]?.opinion?.candidate,
          );
          const point: OpinionPoint = {
            round: evt.round ?? evt.new_opinion?.round_number ?? state.currentRound,
            day: state.calendar?.day ?? null,
            candidate: evt.new_opinion.candidate,
            confidence: evt.new_opinion.confidence,
            trigger: attribution.trigger,
            influences: attribution.influences,
            reason: attribution.reason,
            eventCursor,
            derived: attribution.derived,
          };
          const opinionHistory = {
            ...state.opinionHistory,
            [evt.agent_id]: [...(state.opinionHistory[evt.agent_id] ?? []), point],
          };
          const newEdges: InfluenceEdge[] = attribution.influences
            .filter((inf) => inf.kind !== "seed" && inf.kind !== "persona")
            .map((inf) => ({
              ref: inf.ref,
              kind: inf.kind,
              from: inf.agent_id ?? null,
              to: evt.agent_id,
              direction: inf.direction,
              weight: inf.weight,
              round: point.round,
              day: point.day,
              note: inf.note,
            }));
          const edgeLimit = Number.isFinite(eventHistoryLimit)
            ? LIVE_INFLUENCE_EDGE_LIMIT
            : Number.POSITIVE_INFINITY;
          const influenceEdges = newEdges.length > 0
            ? [...state.influenceEdges, ...newEdges].slice(-edgeLimit)
            : state.influenceEdges;
          let pendingCauses = state.pendingCauses;
          if (pendingCauses[evt.agent_id]) {
            pendingCauses = { ...pendingCauses };
            delete pendingCauses[evt.agent_id];
          }
          if (!known) return { ...base, opinionHistory, influenceEdges, pendingCauses };
          return {
            ...base,
            agents: {
              ...state.agents,
              [evt.agent_id]: { ...known, opinion: evt.new_opinion },
            },
            roundSignals: signalRound(state, evt.town, "opinion"),
            opinionHistory,
            influenceEdges,
            pendingCauses,
          };
        }

        case "agent_speech": {
          // Reducers stay side-effect free. The app-level incremental event
          // consumer mirrors newly-arrived speech into the aria-live region.
          if (!state.agents[evt.agent_id]) return base;
          const prev = state.agents[evt.agent_id];
          const next: AgentState = {
            ...prev,
            gesture: evt.gesture ?? prev.gesture,
            gesture_at: evt.gesture ? new Date().toISOString() : prev.gesture_at,
          };
          return {
            ...base,
            agents: { ...state.agents, [evt.agent_id]: next },
            roundSignals: signalRound(state, evt.town, "converse"),
          };
        }

        case "conversation_started": {
          const conv = evt.conversation;
          const agents = { ...state.agents };
          for (const pid of conv.participants) {
            if (agents[pid]) {
              agents[pid] = { ...agents[pid], activity: "talking" };
            }
          }
          // Each side heard the other: attribution fodder for their next opinion.
          let pendingCauses = state.pendingCauses;
          const [a, b] = conv.participants;
          const [an, bn] = conv.participant_names;
          if (a && b) {
            pendingCauses = withPending(pendingCauses, a, (p) => ({
              ...p,
              conversations: tail(p.conversations, {
                id: conv.id, partnerId: b, partnerName: bn ?? b, topic: conv.topic, round: conv.round ?? null,
              }),
            }));
            pendingCauses = withPending(pendingCauses, b, (p) => ({
              ...p,
              conversations: tail(p.conversations, {
                id: conv.id, partnerId: a, partnerName: an ?? a, topic: conv.topic, round: conv.round ?? null,
              }),
            }));
          }
          return {
            ...base,
            conversations: Number.isFinite(eventHistoryLimit)
              ? [...state.conversations, conv].slice(-LIVE_CONVERSATION_HISTORY_LIMIT)
              : [...state.conversations, conv],
            agents,
            pendingCauses,
          };
        }

        case "conversation_ended": {
          const conv = state.conversations.find((c) => c.id === evt.conversation_id);
          const convs = state.conversations.map((c) =>
            c.id === evt.conversation_id ? { ...c, summary: evt.summary } : c
          );
          const agents = { ...state.agents };
          if (conv) {
            for (const pid of conv.participants) {
              if (agents[pid] && agents[pid].activity === "talking") {
                agents[pid] = { ...agents[pid], activity: "idle" };
              }
            }
          }
          return { ...base, conversations: convs, agents };
        }

        case "world_clock_tick": {
          // A tick may carry the day it belongs to; it never creates a
          // calendar on its own (round_started owns that).
          const calendar = state.calendar && (typeof evt.day === "number" || typeof evt.date === "string")
            ? {
              ...state.calendar,
              day: typeof evt.day === "number" ? evt.day : state.calendar.day,
              dayIndex: typeof evt.day === "number" ? dayOrdinal(state.runPlan, evt.day) : state.calendar.dayIndex,
              date: typeof evt.date === "string" ? evt.date : state.calendar.date,
            }
            : state.calendar;
          return {
            ...base,
            worldClock: { hour: evt.hour, minute: evt.minute },
            calendar,
          };
        }

        case "weather_changed":
          return { ...base, weather: evt.weather };

        case "relationship_update": {
          // Legacy recordings may contain this event. Never merge it into
          // viewer state: relationship data is now capability-protected and
          // updated only from the initiating browser's HTTP response.
          return base;
        }

        case "news_reaction": {
          const r = evt.reaction;
          const mood: AgentState["mood"] = r.emotional_response === "hopeful"
            ? "positive"
            : r.emotional_response === "angry" || r.emotional_response === "anxious"
              ? "negative"
              : "neutral";
          const agents = state.agents[r.agent_id]
            ? { ...state.agents, [r.agent_id]: { ...state.agents[r.agent_id], mood } }
            : state.agents;
          return {
            ...base,
            agents,
            newsReactions: [...state.newsReactions, evt.reaction].slice(-50),
            roundSignals: signalRound(state, r.town, "news"),
          };
        }

        case "ballot_cast": {
          return {
            ...base,
            ballots: {
              ...state.ballots,
              [evt.agent_id]: { option: evt.option, confidence: evt.confidence, reason: evt.reason, round: evt.round },
            },
          };
        }

        case "election_result": {
          // Each town reports its count on the results beat; the district
          // roll-up (town null) arrives once, after them all. Both carry
          // per_town, so the map is complete whichever lands first.
          const townResults = { ...state.townResults };
          for (const [town, tally] of Object.entries(evt.per_town ?? {})) {
            if (tally && typeof tally === "object") townResults[town] = tally;
          }
          return {
            ...base,
            townResults,
            electionResult: evt.town == null ? evt : state.electionResult,
          };
        }

        case "cross_town_gossip": {
          // The receiver heard it: attribution fodder for their next opinion.
          const pendingCauses = withPending(state.pendingCauses, evt.to_agent, (p) => ({
            ...p,
            gossip: tail(p.gossip, {
              id: `${evt.from_agent}-${eventCursor}`,
              fromId: evt.from_agent,
              fromName: state.agents[evt.from_agent]?.name,
              fromTown: evt.from_town,
              message: evt.message,
            }),
          }));
          return { ...base, pendingCauses };
        }

        case "god_view_injection":
          return base;

        case "news_injected": {
          const key = `${evt.round}:${evt.headline}`;
          const seen = state.headlines.some((h) => `${h.round}:${h.headline}` === key);
          const headlines = seen
            ? state.headlines
            : [...state.headlines, { round: evt.round, headline: evt.headline, description: evt.description }];
          // District-level news lands in every town currently on that round.
          const roundSignals = { ...state.roundSignals };
          for (const [town, sig] of Object.entries(roundSignals)) {
            if (sig.round === evt.round && !sig.news) roundSignals[town] = { ...sig, news: true };
          }
          // Everyone present in a listed town (or everyone, district-wide) heard it.
          let pendingCauses = state.pendingCauses;
          const towns = evt.towns ?? [];
          for (const [id, a] of Object.entries(state.agents)) {
            const here = state.agentTowns[id] ?? a.town;
            if (towns.length > 0 && !towns.includes(here)) continue;
            pendingCauses = withPending(pendingCauses, id, (p) => ({
              ...p,
              news: tail(p.news, { id: evt.news_id ?? "", headline: evt.headline, round: evt.round }),
            }));
          }
          return { ...base, headlines, roundSignals, pendingCauses };
        }

        default:
          return base;
      }
    }
    default:
      return state;
  }
}

/** Reducer for the unbounded-duration live socket. */
export function reducer(state: WsState, action: WsAction): WsState {
  return reduceWithEventLimit(state, action, LIVE_EVENT_HISTORY_LIMIT);
}

/** Reducer for a finite staged replay. Keeping its complete applied prefix is
 *  intentional: activity panels and dashboards must describe the selected
 *  playhead, even beyond the live transport's 500-event memory ceiling. */
export function replayReducer(state: WsState, action: WsAction): WsState {
  return reduceWithEventLimit(state, action, Number.POSITIVE_INFINITY);
}

export interface EventDelta {
  direction: "forward" | "backward" | "same";
  /** Applied events available since `previousCursor`; empty for backward. */
  events: SimulationEvent[];
  /** True when live-history trimming removed part of the requested interval. */
  historyGap: boolean;
}

/** Translate an absolute consumer cursor into the state's current event
 *  window. This is the only safe way to consume incremental events: array
 *  lengths stop being cursors as soon as a live window trims or replay seeks. */
export function eventsSince(state: WsState, previousCursor: number): EventDelta {
  if (state.eventCursor < previousCursor) {
    return { direction: "backward", events: [], historyGap: false };
  }
  if (state.eventCursor === previousCursor) {
    return { direction: "same", events: [], historyGap: false };
  }
  const historyGap = previousCursor < state.eventHistoryStart;
  const start = Math.max(previousCursor, state.eventHistoryStart) - state.eventHistoryStart;
  return {
    direction: "forward",
    events: state.events.slice(start),
    historyGap,
  };
}

/* ── Hook ───────────────────────────────────────────────────── */

export function useWebSocket() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const activeRef = useRef(false);

  const connect = useCallback(() => {
    if (!activeRef.current) return;
    if (
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING
    ) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const ws = new WebSocket(`${protocol}//${host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!activeRef.current || wsRef.current !== ws) return;
      dispatch({ type: "CONNECTED" });
      if (import.meta.env.DEV) console.log("[Township] WebSocket connected");
    };

    ws.onmessage = (e) => {
      if (!activeRef.current || wsRef.current !== ws) return;
      try {
        const event: SimulationEvent = JSON.parse(e.data);
        dispatch({ type: "EVENT", payload: event });
      } catch (err) {
        console.warn("[Township] Failed to parse WS message:", err);
      }
    };

    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      if (!activeRef.current) return;
      dispatch({ type: "DISCONNECTED" });
      if (import.meta.env.DEV) console.log("[Township] WebSocket disconnected, reconnecting in 3s...");
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = (err) => {
      console.error("[Township] WebSocket error:", err);
      ws.close();
    };
  }, []);

  useEffect(() => {
    activeRef.current = true;
    connect();
    return () => {
      activeRef.current = false;
      clearTimeout(reconnectTimer.current);
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
      }
    };
  }, [connect]);

  return state;
}
