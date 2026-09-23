/* ── MediaBar ────────────────────────────────────────────────
 * The dock under the town canvas. In the hosted replay it carries the
 * replay transport; in a live town with a player it carries the key
 * legend; a live run gets its transport here in a later phase. Renders
 * nothing when there is nothing to hold.
 * ─────────────────────────────────────────────────────────── */

import { DEMO_MODE } from "../demo/demoMode";
import DemoTimeline from "./DemoTimeline";

interface MediaBarProps {
  /** transport: the replay dock (app shell); legend: the live key legend (town view). */
  variant: "transport" | "legend";
  /** A player sprite can move in this town (live only). */
  playerInTown?: boolean;
}

function coarsePointer(): boolean {
  try { return window.matchMedia("(pointer: coarse)").matches; } catch { return false; }
}

export default function MediaBar({ variant, playerInTown = false }: MediaBarProps) {
  if (variant === "transport") return DEMO_MODE ? <DemoTimeline /> : null;
  if (DEMO_MODE || !playerInTown || coarsePointer()) return null;
  return (
    <div className="media-bar media-bar--legend keyboard-hint" role="note" aria-label="Keyboard controls">
      <span className="media-legend-group"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span>or arrows to walk</span></span>
      <span className="media-legend-sep" aria-hidden="true" />
      <span className="media-legend-group"><kbd>E</kbd><span>talk or visit</span></span>
      <span className="media-legend-sep" aria-hidden="true" />
      <span className="media-legend-group"><span>Click anywhere to walk there</span></span>
    </div>
  );
}
