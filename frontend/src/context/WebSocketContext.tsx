import { createContext, useContext, type ReactNode } from "react";
import { useWebSocket as useWebSocketRaw } from "../hooks/useWebSocket";

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
 */

type WsState = ReturnType<typeof useWebSocketRaw>;

const WebSocketContext = createContext<WsState | null>(null);

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const ws = useWebSocketRaw();
  return <WebSocketContext.Provider value={ws}>{children}</WebSocketContext.Provider>;
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
