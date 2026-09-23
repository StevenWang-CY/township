/* ── MediaBar ────────────────────────────────────────────────
 * The dock under the town canvas. In the hosted replay it carries the
 * replay transport; in a live town it carries the campaign transport while
 * a campaign runs (pause, pace, skip a day, the calendar read-out) and the
 * key legend otherwise, when a player can walk here. Renders nothing when
 * there is nothing to hold.
 * ─────────────────────────────────────────────────────────── */

import { DEMO_MODE } from "../demo/demoMode";
import DemoTimeline from "./DemoTimeline";
import LiveTransport, { transportVisible } from "./LiveTransport";
import { useSimulation } from "../hooks/useSimulation";
import { useWebSocketContext } from "../context/WebSocketContext";
import { useScenario } from "../hooks/useScenario";

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
  if (DEMO_MODE) return null;
  return <LiveDock playerInTown={playerInTown} />;
}

/** The live town's dock: the campaign transport when one is under way,
 *  else the keyboard legend for a walking player. */
function LiveDock({ playerInTown }: { playerInTown: boolean }) {
  const ws = useWebSocketContext();
  const scen = useScenario();
  // Poll while the socket says a run is on (a paused campaign still is);
  // the flag flipping off fetches the final status once.
  const sim = useSimulation({ poll: ws.simulationRunning });

  if (transportVisible(sim.status)) {
    return (
      <LiveTransport
        status={sim.status}
        calendar={ws.calendar}
        electionDate={scen.scenario.campaign?.election_date ?? scen.scenario.dates?.decision_day ?? null}
        busy={sim.transportBusy}
        error={sim.transportError}
        onPause={sim.pause}
        onResume={sim.resume}
        onSpeed={sim.setSpeed}
        onSkipDay={sim.skipDay}
      />
    );
  }

  if (!playerInTown || coarsePointer()) return null;
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
