import { useReducer, useEffect, useRef, useCallback } from "react";
import type {
  SimulationEvent,
  AgentState,
  Conversation,
  TownSummary,
  WeatherKind,
  Relationship,
  NewsReaction,
} from "../types/messages";

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
  agentPositions: Record<string, { location: string; x?: number; y?: number }>;
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
  townSummaries: {},
  currentRound: 0,
  totalRounds: 0,
  simulationRunning: false,
  worldClock: { hour: 8, minute: 0 },
  weather: "clear",
  relationships: {},
  newsReactions: [],
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
          return {
            ...base,
            agents: agentsMap,
            agentRoster: agentsMap,
            conversations: [],
            events: [evt],
            eventHistoryStart: eventCursor - 1,
            agentPositions: {},
            townSummaries: {},
            currentRound: 0,
            totalRounds: 0,
            simulationRunning: true,
            worldClock: initialState.worldClock,
            weather: initialState.weather,
            newsReactions: [],
          };
        }

        case "simulation_ended":
          return { ...base, simulationRunning: false };

        case "round_started":
          return {
            ...base,
            currentRound: evt.round,
            totalRounds: evt.total_rounds,
          };

        case "round_ended": {
          const summaries = { ...state.townSummaries };
          for (const s of evt.summary) summaries[s.town] = s;
          return { ...base, townSummaries: summaries };
        }

        case "agent_moved":
          if (state.agents[evt.agent_id]) {
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
              agentPositions: {
                ...state.agentPositions,
                [evt.agent_id]: {
                  location: evt.to_location,
                  ...(Number.isFinite(evt.x) && Number.isFinite(evt.y)
                    ? { x: evt.x as number, y: evt.y as number }
                    : {}),
                },
              },
            };
          }
          return base;

        case "opinion_changed":
          if (state.agents[evt.agent_id]) {
            return {
              ...base,
              agents: {
                ...state.agents,
                [evt.agent_id]: {
                  ...state.agents[evt.agent_id],
                  opinion: evt.new_opinion,
                },
              },
            };
          }
          return base;

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
          return {
            ...base,
            conversations: Number.isFinite(eventHistoryLimit)
              ? [...state.conversations, conv].slice(-LIVE_CONVERSATION_HISTORY_LIMIT)
              : [...state.conversations, conv],
            agents,
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

        case "world_clock_tick":
          return {
            ...base,
            worldClock: { hour: evt.hour, minute: evt.minute },
          };

        case "weather_changed":
          return { ...base, weather: evt.weather };

        case "relationship_update": {
          // Legacy recordings may contain this event. Never merge it into
          // viewer state: relationship data is now capability-protected and
          // updated only from the initiating browser's HTTP response.
          return base;
        }

        case "news_reaction":
          return {
            ...base,
            newsReactions: [...state.newsReactions, evt.reaction].slice(-50),
          };

        case "cross_town_gossip":
          // Just record into the events stream — consumers handle UI side-effects.
          return base;

        case "god_view_injection":
          return base;

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
