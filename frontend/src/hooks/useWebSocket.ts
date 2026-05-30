import { useReducer, useEffect, useRef, useCallback } from "react";
import type {
  SimulationEvent,
  AgentState,
  Conversation,
  TownSummary,
  TownId,
  WeatherKind,
  Relationship,
  NewsReaction,
} from "../types/messages";

/* ── State ──────────────────────────────────────────────────── */

interface WsState {
  connected: boolean;
  agents: Record<string, AgentState>;
  conversations: Conversation[];
  events: SimulationEvent[];
  townSummaries: Record<TownId, TownSummary | null>;
  currentRound: number;
  totalRounds: number;
  simulationRunning: boolean;
  worldClock: { hour: number; minute: number };
  weather: WeatherKind;
  relationships: Record<string, Relationship>;
  newsReactions: NewsReaction[];
}

const initialState: WsState = {
  connected: false,
  agents: {},
  conversations: [],
  events: [],
  townSummaries: { dover: null, montclair: null, parsippany: null, randolph: null },
  currentRound: 0,
  totalRounds: 0,
  simulationRunning: false,
  worldClock: { hour: 8, minute: 0 },
  weather: "clear",
  relationships: {},
  newsReactions: [],
};

/* ── Reducer ────────────────────────────────────────────────── */

type WsAction =
  | { type: "CONNECTED" }
  | { type: "DISCONNECTED" }
  | { type: "EVENT"; payload: SimulationEvent };

function reducer(state: WsState, action: WsAction): WsState {
  switch (action.type) {
    case "CONNECTED":
      return { ...state, connected: true };
    case "DISCONNECTED":
      return { ...state, connected: false };
    case "EVENT": {
      const evt = action.payload;
      const newEvents = [...state.events, evt].slice(-500); // keep last 500

      switch (evt.type) {
        case "simulation_started": {
          const agentsMap: Record<string, AgentState> = {};
          for (const a of evt.agents) agentsMap[a.id] = a;
          return {
            ...state,
            events: newEvents,
            agents: agentsMap,
            simulationRunning: true,
          };
        }

        case "simulation_ended":
          return { ...state, events: newEvents, simulationRunning: false };

        case "round_started":
          return {
            ...state,
            events: newEvents,
            currentRound: evt.round,
            totalRounds: evt.total_rounds,
          };

        case "round_ended": {
          const summaries = { ...state.townSummaries };
          for (const s of evt.summary) summaries[s.town] = s;
          return { ...state, events: newEvents, townSummaries: summaries };
        }

        case "agent_moved":
          if (state.agents[evt.agent_id]) {
            return {
              ...state,
              events: newEvents,
              agents: {
                ...state.agents,
                [evt.agent_id]: {
                  ...state.agents[evt.agent_id],
                  location: evt.to_location,
                  activity: "walking",
                },
              },
            };
          }
          return { ...state, events: newEvents };

        case "opinion_changed":
          if (state.agents[evt.agent_id]) {
            return {
              ...state,
              events: newEvents,
              agents: {
                ...state.agents,
                [evt.agent_id]: {
                  ...state.agents[evt.agent_id],
                  opinion: evt.new_opinion,
                },
              },
            };
          }
          return { ...state, events: newEvents };

        case "agent_speech": {
          // Mirror to the aria-live region for screen readers (FIX 14).
          if (typeof document !== "undefined") {
            const node = document.getElementById("aria-live-speech");
            if (node) node.textContent = `Agent ${evt.agent_name}: ${evt.text}`;
          }
          if (!state.agents[evt.agent_id]) return { ...state, events: newEvents };
          const prev = state.agents[evt.agent_id];
          const next: AgentState = {
            ...prev,
            gesture: evt.gesture ?? prev.gesture,
            gesture_at: evt.gesture ? new Date().toISOString() : prev.gesture_at,
          };
          return {
            ...state,
            events: newEvents,
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
            ...state,
            events: newEvents,
            conversations: [...state.conversations, conv],
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
          return { ...state, events: newEvents, conversations: convs, agents };
        }

        case "world_clock_tick":
          return {
            ...state,
            events: newEvents,
            worldClock: { hour: evt.hour, minute: evt.minute },
          };

        case "weather_changed":
          return { ...state, events: newEvents, weather: evt.weather };

        case "relationship_update": {
          const prev = state.relationships[evt.agent_id];
          const encounters = (prev?.encounters ?? 0) + 1;
          const topics = prev?.topics_discussed ?? [];
          const next: Relationship = {
            trust: evt.trust,
            encounters,
            last_chat_at: new Date().toISOString(),
            topics_discussed: topics,
            last_classification: evt.classification,
            player_revealed_to_them: prev?.player_revealed_to_them,
          };
          return {
            ...state,
            events: newEvents,
            relationships: { ...state.relationships, [evt.agent_id]: next },
          };
        }

        case "news_reaction":
          return {
            ...state,
            events: newEvents,
            newsReactions: [...state.newsReactions, evt.reaction].slice(-50),
          };

        case "cross_town_gossip":
          // Just record into the events stream — consumers handle UI side-effects.
          return { ...state, events: newEvents };

        case "god_view_injection":
          return { ...state, events: newEvents };

        default:
          return { ...state, events: newEvents };
      }
    }
    default:
      return state;
  }
}

/* ── Hook ───────────────────────────────────────────────────── */

export function useWebSocket() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const ws = new WebSocket(`${protocol}//${host}/ws`);

    ws.onopen = () => {
      dispatch({ type: "CONNECTED" });
      if (import.meta.env.DEV) console.log("[Township] WebSocket connected");
    };

    ws.onmessage = (e) => {
      try {
        const event: SimulationEvent = JSON.parse(e.data);
        dispatch({ type: "EVENT", payload: event });
      } catch (err) {
        console.warn("[Township] Failed to parse WS message:", err);
      }
    };

    ws.onclose = () => {
      dispatch({ type: "DISCONNECTED" });
      if (import.meta.env.DEV) console.log("[Township] WebSocket disconnected, reconnecting in 3s...");
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = (err) => {
      console.error("[Township] WebSocket error:", err);
      ws.close();
    };

    wsRef.current = ws;
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return state;
}
