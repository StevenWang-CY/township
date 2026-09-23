/* ── Checkpointed seeks ──────────────────────────────────────
 * A seek is a prefix reduction of the feed. A 21-day campaign is ~11k
 * events, so the player keeps a reducer snapshot every CHECKPOINT_EVERY
 * events (filled lazily as playback or earlier seeks pass them) and a seek
 * reduces only the remainder. The reducer is pure and its states are
 * immutable, so a snapshot can be reused as a starting point forever.
 * ─────────────────────────────────────────────────────────── */

import { initialState, replayReducer, type WsState } from "../hooks/useWebSocket";
import type { SimulationEvent } from "../types/messages";

export const CHECKPOINT_EVERY = 500;

/** Remember the state at `position` when it sits on a checkpoint boundary. */
export function noteCheckpoint(checkpoints: Map<number, WsState>, position: number, state: WsState): void {
  if (position > 0 && position % CHECKPOINT_EVERY === 0 && !checkpoints.has(position)) {
    checkpoints.set(position, state);
  }
}

/** The state after `target` events, from the nearest checkpoint at or before it. */
export function seekState(
  events: SimulationEvent[],
  target: number,
  checkpoints: Map<number, WsState>,
): WsState {
  const end = Math.max(0, Math.min(events.length, Math.floor(target)));
  let start = 0;
  let state = initialState;
  for (const [at, snapshot] of checkpoints) {
    if (at <= end && at > start) {
      start = at;
      state = snapshot;
    }
  }
  for (let i = start; i < end; i++) {
    state = replayReducer(state, { type: "EVENT", payload: events[i] });
    noteCheckpoint(checkpoints, i + 1, state);
  }
  return state;
}
