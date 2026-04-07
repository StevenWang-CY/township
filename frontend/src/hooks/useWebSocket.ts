import { useReducer, useEffect, useRef, useCallback } from "react";
import type {
  SimulationEvent,
  AgentState,
  Conversation,
  TownSummary,
  TownId,
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
        case "simulation_started":
          const agentsMap: Record<string, AgentState> = {};
          for (const a of evt.agents) agentsMap[a.id] = a;
          return {
            ...state,
            events: newEvents,
            agents: agentsMap,
            simulationRunning: true,
          };

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

        case "conversation_started":
          return {
            ...state,
            events: newEvents,
            conversations: [...state.conversations, evt.conversation],
          };

        case "conversation_ended": {
          const convs = state.conversations.map((c) =>
            c.id === evt.conversation_id ? { ...c, summary: evt.summary } : c
          );
          return { ...state, events: newEvents, conversations: convs };
        }

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
      console.log("[Township] WebSocket connected");
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
      console.log("[Township] WebSocket disconnected, reconnecting in 3s...");
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
