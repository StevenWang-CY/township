/* ── Demo replay pacing table ────────────────────────────────
 *
 * MIRROR of backend/simulation/replay.py EVENT_DELAYS — keep the two tables
 * in lockstep. The backend replays a cached run over the WebSocket with these
 * per-event-type delays; the zero-backend demo player (useDemoFeed) replays
 * the same cache client-side and must feel identical at 1× speed.
 *
 * Values are SECONDS at 1× speed, keyed by event `type`.
 * ─────────────────────────────────────────────────────────── */

export const EVENT_DELAYS: Record<string, number> = {
  round_started: 1.0,
  round_ended: 0.4,
  agent_moved: 0.3,
  agent_speech: 1.5,
  conversation_started: 0.5,
  conversation_ended: 0.3,
  opinion_changed: 0.8,
  news_injected: 2.0,
  news_reaction: 0.4,
  cross_town_gossip: 1.0,
  god_view_injection: 2.0,
  gods_view_result: 0.5,
  simulation_started: 0.5,
  simulation_ended: 0.0,
  world_clock_tick: 0.1,
  weather_changed: 0.5,
  relationship_update: 0.2,
};

/** Unknown event types pace at this (mirrors replay.py's `.get(type, 0.5)`). */
export const DEFAULT_EVENT_DELAY = 0.5;

export type DemoSpeed = 0.5 | 1 | 2 | 4;

/** Playback speeds offered by the timeline, in toggle-cycle order. */
export const DEMO_SPEEDS: DemoSpeed[] = [0.5, 1, 2, 4];

/** Milliseconds to wait AFTER emitting an event of `type` (backend semantics:
 *  publish, then sleep base_delay / speed). */
export function eventDelayMs(type: string, speed: number): number {
  const base = EVENT_DELAYS[type] ?? DEFAULT_EVENT_DELAY;
  return (base / Math.max(0.1, speed)) * 1000;
}
