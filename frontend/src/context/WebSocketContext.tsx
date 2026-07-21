import { createContext, useContext, type ReactNode } from "react";
import { useWebSocket as useWebSocketRaw } from "../hooks/useWebSocket";
import type { WsState } from "../hooks/useWebSocket";
import { useDemoFeed } from "../hooks/useDemoFeed";
import { DemoPlayerContext } from "../demo/DemoPlayerContext";
import { DEMO_MODE } from "../demo/demoMode";
import { useScenarioContext } from "./ScenarioContext";

/**
 * Provider for a single, app-wide WebSocket connection.
 *
 * `useWebSocket` opens its own WebSocket each time it's called. Calling it
 * from `App`, `DistrictMap`, and `ChatPanel` therefore creates three parallel
 * connections with three independent state stores — fragmented agent state,
 * triple the bandwidth, and the appearance of out-of-order events.
 *
 * Lift the hook once into a Provider; everywhere else consumes via
 * `useWebSocketContext()`. This guarantees exactly one WebSocket per session.
 *
 * DEMO MODE (VITE_DEMO_MODE=1): the same context is filled by the recorded
 * demo feed instead — a paced client-side replay through the identical
 * reducer — so every consumer works untouched with zero backend. The replay
 * transport controls are published separately via DemoPlayerContext.
 */

const WebSocketContext = createContext<WsState | null>(null);

function LiveWebSocketProvider({ children }: { children: ReactNode }) {
  const ws = useWebSocketRaw();
  return <WebSocketContext.Provider value={ws}>{children}</WebSocketContext.Provider>;
}

function DemoFeedProvider({ children }: { children: ReactNode }) {
  const scen = useScenarioContext();
  // Wait for the scenario bootstrap so the feed matches the active scenario id.
  const { state, player } = useDemoFeed(scen.scenario.id, !scen.loading);
  return (
    <WebSocketContext.Provider value={state}>
      <DemoPlayerContext.Provider value={player}>{children}</DemoPlayerContext.Provider>
    </WebSocketContext.Provider>
  );
}

export function WebSocketProvider({ children }: { children: ReactNode }) {
  if (DEMO_MODE) return <DemoFeedProvider>{children}</DemoFeedProvider>;
  return <LiveWebSocketProvider>{children}</LiveWebSocketProvider>;
}

export function useWebSocketContext(): WsState {
  const ctx = useContext(WebSocketContext);
  if (!ctx) {
    throw new Error(
      "useWebSocketContext must be used inside <WebSocketProvider>. " +
        "Wrap your tree in WebSocketProvider (typically inside UserProfileProvider).",
    );
  }
  return ctx;
}
