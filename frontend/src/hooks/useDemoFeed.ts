/* ── useDemoFeed ─────────────────────────────────────────────
 *
 * The zero-backend replay engine behind the GitHub Pages demo.
 *
 * Fetches a staged event feed (/demo/<scenarioId>.json — a recorded
 * simulation cache) and replays it through the SAME pure reducer the live
 * WebSocket uses, so every consumer of the WS context works untouched.
 *
 * Playback model (mirrors backend/simulation/replay.py):
 *   emit events[i]  →  sleep EVENT_DELAYS[type] / speed  →  emit events[i+1]
 * via a setTimeout chain (see src/demo/pacing.ts, the client mirror of
 * EVENT_DELAYS).
 *
 * Seeking is instant: the reducer is pure, so position i is simply
 * reduce(initialState, events[0..i)) computed synchronously.
 * ─────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SimulationEvent } from "../types/messages";
import { replayReducer, initialState } from "./useWebSocket";
import type { WsState } from "./useWebSocket";
import { DEFAULT_EVENT_DELAY, EVENT_DELAYS, eventDelayMs } from "../demo/pacing";
import type { DemoSpeed } from "../demo/pacing";
import { demoUrl } from "../demo/demoMode";

/* ── Cold-open curation ──────────────────────────────────────
 * A raw feed opens on round-0 arrivals: 30-60s of walking with no dialogue.
 * Instead, playback begins a few seconds BEFORE the first agent_speech (so
 * visitors still see the town assemble) and runs slightly fast until that
 * first line lands, then settles to 1×. Any user interaction (seek, speed,
 * pause) cancels the boost — it is an opening flourish, not a mode. */

/** Seconds (at 1×) of arrivals kept ahead of the first spoken line. */
const COLD_OPEN_LEAD_SECONDS = 4;
/** Speed multiplier applied until the first agent_speech has been emitted. */
const COLD_OPEN_BOOST = 1.5;

/** Index to start playback from: ~COLD_OPEN_LEAD_SECONDS before the first
 *  agent_speech (0 when the feed has no speech at all). */
function curatedStartIndex(events: SimulationEvent[], talkIndex: number): number {
  if (talkIndex <= 0) return 0;
  let lead = 0;
  let k = talkIndex;
  while (k > 0 && lead < COLD_OPEN_LEAD_SECONDS) {
    k -= 1;
    lead += EVENT_DELAYS[events[k].type] ?? DEFAULT_EVENT_DELAY;
  }
  return k;
}

/* ── Types ──────────────────────────────────────────────────── */

/** A round boundary in the feed — one tick on the timeline scrubber. */
export interface DemoChapter {
  round: number;
  /** Index of the round_started event in the feed. */
  index: number;
  /** In-world clock at that round (from the first world_clock_tick after it). */
  hour: number | null;
  minute: number | null;
}

export interface DemoPlayer {
  /** Feed fetched and parsed; playback is possible. */
  ready: boolean;
  /** Non-null when the feed could not be loaded. */
  error: string | null;
  playing: boolean;
  /** True once the playhead has reached the end of the feed (replay-again affordance). */
  ended: boolean;
  speed: DemoSpeed;
  /** Number of events applied so far (0..duration). */
  position: number;
  /** Total number of events in the feed. */
  duration: number;
  chapters: DemoChapter[];
  scenarioId: string;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  setSpeed: (s: DemoSpeed) => void;
  /** Jump so that events[0..i) are applied. Instant (pure reduction). */
  seekTo: (i: number) => void;
  /** Relative seek by a number of events. */
  seekBy: (delta: number) => void;
  /** Jump to the start of round n (lands just after its round_started). */
  skipToRound: (round: number) => void;
  /** Feed index of the first agent_speech event (-1 when the feed has none). */
  talkIndex: number;
  /** Jump to the curated opening (a breath of arrivals, then the first
   *  conversation) and play. The "Skip to the talk" affordance. */
  skipToTalk: () => void;
}

export interface DemoFeed {
  /** Same surface the live useWebSocket hook exposes — consumers swap transparently. */
  state: WsState;
  player: DemoPlayer;
}

/* ── Helpers ────────────────────────────────────────────────── */

function buildChapters(events: SimulationEvent[]): DemoChapter[] {
  const out: DemoChapter[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < events.length; i++) {
    const evt = events[i];
    if (evt.type !== "round_started") continue;
    // Multi-town runs emit round_started once per town — chapter = the FIRST
    // occurrence of each round number.
    if (seen.has(evt.round)) continue;
    seen.add(evt.round);
    // Find the in-world clock for this round: first tick before the next round.
    let hour: number | null = null;
    let minute: number | null = null;
    for (let j = i + 1; j < events.length; j++) {
      const e = events[j];
      if (e.type === "round_started") break;
      if (e.type === "world_clock_tick") {
        hour = e.hour;
        minute = e.minute;
        break;
      }
    }
    out.push({ round: evt.round, index: i, hour, minute });
  }
  return out;
}

/* ── Hook ───────────────────────────────────────────────────── */

/**
 * @param scenarioId id of the staged demo scenario (drives the feed URL)
 * @param enabled    hold off fetching until the scenario bootstrap resolved
 */
export function useDemoFeed(scenarioId: string, enabled: boolean): DemoFeed {
  // Mutable engine state — the setTimeout chain reads these, never React state.
  const eventsRef = useRef<SimulationEvent[]>([]);
  const stateRef = useRef<WsState>(initialState);
  const posRef = useRef(0);
  const speedRef = useRef<DemoSpeed>(1);
  const playingRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);
  // Cold-open curation (see module header): where the first line of dialogue
  // lives, where the curated opening starts, and whether the opening boost
  // is still active.
  const talkIndexRef = useRef(-1);
  const startIndexRef = useRef(0);
  const boostRef = useRef(false);

  // React-visible mirrors.
  const [view, setView] = useState<WsState>(initialState);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [speed, setSpeedState] = useState<DemoSpeed>(1);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [chapters, setChapters] = useState<DemoChapter[]>([]);
  const [talkIndex, setTalkIndex] = useState(-1);
  const [agentRoster, setAgentRoster] = useState<WsState["agentRoster"]>({});

  const stopPlayback = useCallback(() => {
    window.clearTimeout(timerRef.current);
    playingRef.current = false;
    setPlaying(false);
  }, []);

  /** Apply the next event, then schedule the one after (paced × speed). */
  const tick = useCallback(() => {
    const events = eventsRef.current;
    const i = posRef.current;
    if (!playingRef.current) return;
    if (i >= events.length) {
      stopPlayback();
      setEnded(true);
      return;
    }
    const evt = events[i];
    stateRef.current = replayReducer(stateRef.current, { type: "EVENT", payload: evt });
    posRef.current = i + 1;
    setView(stateRef.current);
    setPosition(posRef.current);
    if (posRef.current >= events.length) {
      stopPlayback();
      setEnded(true);
      return;
    }
    // The cold-open boost ends the moment the first line of dialogue lands,
    // so that line paces (and reads) at the user's chosen speed.
    if (evt.type === "agent_speech") boostRef.current = false;
    const paceSpeed = boostRef.current
      ? speedRef.current * COLD_OPEN_BOOST
      : speedRef.current;
    timerRef.current = window.setTimeout(tick, eventDelayMs(evt.type, paceSpeed));
  }, [stopPlayback]);

  const seekTo = useCallback(
    (i: number) => {
      const events = eventsRef.current;
      const target = Math.max(0, Math.min(events.length, Math.floor(i)));
      window.clearTimeout(timerRef.current);
      boostRef.current = false; // seeking is user intent — drop the opening boost
      // Pure reducer ⇒ position = synchronous prefix reduction. Instant.
      let s = initialState;
      for (let k = 0; k < target; k++) {
        s = replayReducer(s, { type: "EVENT", payload: events[k] });
      }
      stateRef.current = s;
      posRef.current = target;
      setView(s);
      setPosition(target);
      const atEnd = events.length > 0 && target >= events.length;
      setEnded(atEnd);
      if (playingRef.current) {
        if (atEnd) {
          stopPlayback();
        } else {
          // Resume the chain after a short beat so rapid scrubs stay smooth.
          timerRef.current = window.setTimeout(tick, 150);
        }
      }
    },
    [tick, stopPlayback],
  );

  const seekBy = useCallback((delta: number) => seekTo(posRef.current + delta), [seekTo]);

  const play = useCallback(() => {
    if (eventsRef.current.length === 0) return;
    if (posRef.current >= eventsRef.current.length) {
      // "Replay again" — restart from the top.
      seekTo(0);
    }
    setEnded(false);
    playingRef.current = true;
    setPlaying(true);
    window.clearTimeout(timerRef.current);
    tick();
  }, [seekTo, tick]);

  const pause = useCallback(() => {
    boostRef.current = false;
    stopPlayback();
  }, [stopPlayback]);

  const toggle = useCallback(() => {
    if (playingRef.current) pause();
    else play();
  }, [play, pause]);

  const setSpeed = useCallback((s: DemoSpeed) => {
    boostRef.current = false; // an explicit speed choice overrides the boost
    speedRef.current = s;
    setSpeedState(s);
    if (playingRef.current) {
      // Re-arm the chain so the new pace applies immediately.
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(tick, 80);
    }
  }, [tick]);

  const skipToRound = useCallback(
    (round: number) => {
      const ch = chapters.find((c) => c.round === round);
      if (ch) seekTo(ch.index + 1); // land just past round_started
    },
    [chapters, seekTo],
  );

  const skipToTalk = useCallback(() => {
    if (talkIndexRef.current < 0) return;
    seekTo(startIndexRef.current);
    // Re-arm the opening flourish and play: brisk arrivals, then the line.
    boostRef.current = talkIndexRef.current > startIndexRef.current;
    setEnded(false);
    playingRef.current = true;
    setPlaying(true);
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(tick, 120);
  }, [seekTo, tick]);

  /* ── Feed loading ─────────────────────────────────────────── */

  useEffect(() => {
    if (!enabled || !scenarioId) return;
    let cancelled = false;
    const ctrl = new AbortController();

    stopPlayback();
    setReady(false);
    setError(null);
    setAgentRoster({});
    talkIndexRef.current = -1;
    startIndexRef.current = 0;
    boostRef.current = false;
    setTalkIndex(-1);

    fetch(demoUrl(`${scenarioId}.json`), { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        if (cancelled) return;
        const events: SimulationEvent[] = Array.isArray(d?.events) ? d.events : [];
        if (events.length === 0) throw new Error("feed has no events");
        const started = events.find((event) => event.type === "simulation_started");
        const roster: WsState["agentRoster"] = {};
        if (started?.type === "simulation_started") {
          for (const agent of started.agents) roster[agent.id] = agent;
        }
        eventsRef.current = events;
        // Curated cold open: start a breath before the first conversation
        // instead of at raw round-0 walking, and pace slightly fast until
        // the first line lands. Visitors see dialogue within seconds.
        const talkIdx = events.findIndex((event) => event.type === "agent_speech");
        const startIdx = curatedStartIndex(events, talkIdx);
        let startState = initialState;
        for (let k = 0; k < startIdx; k++) {
          startState = replayReducer(startState, { type: "EVENT", payload: events[k] });
        }
        talkIndexRef.current = talkIdx;
        startIndexRef.current = startIdx;
        setTalkIndex(talkIdx);
        stateRef.current = startState;
        posRef.current = startIdx;
        setView(startState);
        setPosition(startIdx);
        setDuration(events.length);
        setChapters(buildChapters(events));
        setAgentRoster(roster);
        setEnded(false);
        setReady(true);
        // Auto-play: the demo should feel alive the moment it loads.
        boostRef.current = talkIdx > startIdx;
        playingRef.current = true;
        setPlaying(true);
        window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(tick, 400);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("abort")) return;
        setError(msg);
        setReady(false);
      });

    return () => {
      cancelled = true;
      ctrl.abort();
      window.clearTimeout(timerRef.current);
      playingRef.current = false;
    };
  }, [scenarioId, enabled, tick, stopPlayback]);

  // Safety net: never leak the timer on unmount.
  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  /* ── Assemble ─────────────────────────────────────────────── */

  const state = useMemo<WsState>(
    // The feed IS the connection: report connected once the replay is ready.
    // The roster is transport metadata, not applied state: publishing it now
    // keeps every scenario's map and town sidebar authoritative at position 0
    // without pretending simulation_started has crossed the playhead.
    () => ({ ...view, connected: ready, agentRoster }),
    [view, ready, agentRoster],
  );

  const player = useMemo<DemoPlayer>(
    () => ({
      ready,
      error,
      playing,
      ended,
      speed,
      position,
      duration,
      chapters,
      scenarioId,
      play,
      pause,
      toggle,
      setSpeed,
      seekTo,
      seekBy,
      skipToRound,
      talkIndex,
      skipToTalk,
    }),
    [ready, error, playing, ended, speed, position, duration, chapters, scenarioId,
     play, pause, toggle, setSpeed, seekTo, seekBy, skipToRound, talkIndex, skipToTalk],
  );

  return { state, player };
}
