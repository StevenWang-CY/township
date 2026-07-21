/* ── DemoPlayerContext ───────────────────────────────────────
 * Exposes the demo replay player controls (play/pause/seek/speed) to the UI.
 * Filled by the demo-mode WebSocketProvider branch; null in live builds, so
 * consumers (DemoTimeline) can simply render nothing outside demo mode.
 * ─────────────────────────────────────────────────────────── */

import { createContext, useContext } from "react";
import type { DemoPlayer } from "../hooks/useDemoFeed";

export const DemoPlayerContext = createContext<DemoPlayer | null>(null);

export function useDemoPlayer(): DemoPlayer | null {
  return useContext(DemoPlayerContext);
}
