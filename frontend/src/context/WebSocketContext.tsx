import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useWebSocket as useWebSocketRaw } from "../hooks/useWebSocket";
import type { WsState } from "../hooks/useWebSocket";
import { useDemoFeed, type DemoPlayer } from "../hooks/useDemoFeed";
import { DemoPlayerContext } from "../demo/DemoPlayerContext";
import { DEMO_MODE } from "../demo/demoMode";
import { useScenarioContext } from "./ScenarioContext";
import { registerRosterArt } from "../game/spriteCustomization";

/**
 * Give every resident of a non-NJ scenario a distinct body before anything
 * draws them: the canvas and the sidebar portraits both resolve art through
 * the same registry, so registering here (above both) keeps them in step.
 */
function useRosterArt(scenarioId: string, state: WsState) {
  const rosterKey = Object.keys(state.agentRoster).sort().join("|");
  useMemo(() => {
    if (rosterKey) registerRosterArt(scenarioId, rosterKey.split("|"));
  }, [scenarioId, rosterKey]);
}

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
  const scen = useScenarioContext();
  useRosterArt(scen.scenario.id, ws);
  return <WebSocketContext.Provider value={ws}>{children}</WebSocketContext.Provider>;
}

function DemoFeedProvider({ children }: { children: ReactNode }) {
  const scen = useScenarioContext();
  // Wait for the scenario bootstrap so the feed matches the active scenario id.
  const { state, player } = useDemoFeed(scen.scenario.id, !scen.loading, scen.demoFeed?.file ?? null);
  useRosterArt(scen.scenario.id, state);
  // Debug/capture handle: scripts (scripts/capture) seek the replay precisely
  // through the player instead of the 15-event keyboard steps.
  useEffect(() => {
    (window as typeof window & { __demoPlayer?: DemoPlayer }).__demoPlayer = player;
  }, [player]);
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
