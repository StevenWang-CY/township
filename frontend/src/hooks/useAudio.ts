import { useCallback, useEffect, useMemo, useState } from "react";

/* ── Types ─────────────────────────────────────────────────── */

export type AudioKey =
  | "speech_pop"
  | "chat_open"
  | "chat_send"
  | "opinion_change"
  | "news_breaking"
  | "footstep"
  | "church_bell";

/* ── Singleton state ───────────────────────────────────────── */
/*
 * The previous implementation streamed /assets/audio/sfx/*.ogg files that do
 * not exist in the repo. This version SYNTHESIZES every cue with the Web Audio
 * API — no external files, crisp and deterministic. The exported hook API
 * (play / setEnabled / setVolume / enabled) and the AudioKey union are
 * unchanged so App.tsx / ChatPanel consume it without modification.
 */

interface AudioState {
  enabled: boolean;
  volume: number;
  ctx: AudioContext | null;
  listeners: Set<() => void>;
}

const PROFILE_STORAGE_KEY = "township-user-profile";

function readInitialEnabled(): boolean {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return true;
    const parsed = JSON.parse(raw);
    return parsed?.audioEnabled !== false; // default true
  } catch {
    return true;
  }
}

const STATE: AudioState = {
  enabled: readInitialEnabled(),
  volume: 0.6,
  ctx: null,
  listeners: new Set(),
};

function notify() {
  STATE.listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* ignore */
    }
  });
}

/* ── AudioContext (lazily created/resumed on first gesture) ── */

type AnyWindow = typeof window & { webkitAudioContext?: typeof AudioContext };

function ensureContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!STATE.ctx) {
    const Ctor = window.AudioContext || (window as AnyWindow).webkitAudioContext;
    if (!Ctor) return null;
    try {
      STATE.ctx = new Ctor();
    } catch {
      return null;
    }
  }
  // Browsers start the context suspended until a user gesture; resume on demand.
  if (STATE.ctx.state === "suspended") {
    void STATE.ctx.resume().catch(() => {/* ignore */});
  }
  return STATE.ctx;
}

/* ── Synthesis primitives ──────────────────────────────────── */

/** A short tone with an attack/decay envelope. */
function tone(
  ctx: AudioContext,
  out: AudioNode,
  opts: {
    type: OscillatorType;
    freq: number;
    freqEnd?: number;
    start: number;
    dur: number;
    peak: number;
    attack?: number;
  },
) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = opts.type;
  const t0 = ctx.currentTime + opts.start;
  osc.frequency.setValueAtTime(opts.freq, t0);
  if (opts.freqEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.freqEnd), t0 + opts.dur);
  }
  const peak = opts.peak * Math.max(0, Math.min(1, STATE.volume));
  const attack = opts.attack ?? 0.004;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
  osc.connect(g);
  g.connect(out);
  osc.start(t0);
  osc.stop(t0 + opts.dur + 0.02);
}

/** A burst of filtered white noise (footsteps, stings). */
function noiseBurst(
  ctx: AudioContext,
  out: AudioNode,
  opts: { start: number; dur: number; peak: number; cutoff: number; type?: BiquadFilterType; q?: number },
) {
  const frames = Math.max(1, Math.floor(ctx.sampleRate * opts.dur));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = opts.type ?? "lowpass";
  filter.frequency.value = opts.cutoff;
  if (opts.q !== undefined) filter.Q.value = opts.q;

  const g = ctx.createGain();
  const t0 = ctx.currentTime + opts.start;
  const peak = opts.peak * Math.max(0, Math.min(1, STATE.volume));
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);

  src.connect(filter);
  filter.connect(g);
  g.connect(out);
  src.start(t0);
  src.stop(t0 + opts.dur + 0.02);
}

/* ── Per-cue voices ────────────────────────────────────────── */

function renderCue(ctx: AudioContext, key: AudioKey) {
  const out = ctx.destination;
  switch (key) {
    case "speech_pop":
      // Short soft blip.
      tone(ctx, out, { type: "sine", freq: 660, freqEnd: 880, start: 0, dur: 0.09, peak: 0.18 });
      break;

    case "chat_open": {
      // Gentle rising woosh — filtered noise sweep + a soft tone.
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(300, ctx.currentTime);
      filter.frequency.exponentialRampToValueAtTime(1800, ctx.currentTime + 0.28);
      filter.Q.value = 0.8;
      filter.connect(out);
      noiseBurst(ctx, filter, { start: 0, dur: 0.3, peak: 0.14, cutoff: 2000, type: "bandpass", q: 0.8 });
      tone(ctx, out, { type: "sine", freq: 440, freqEnd: 660, start: 0.02, dur: 0.26, peak: 0.1, attack: 0.06 });
      break;
    }

    case "chat_send":
      // Crisp tap.
      tone(ctx, out, { type: "triangle", freq: 520, freqEnd: 760, start: 0, dur: 0.07, peak: 0.16 });
      break;

    case "opinion_change":
      // Two-note bell (rising fourth).
      tone(ctx, out, { type: "sine", freq: 784, start: 0, dur: 0.5, peak: 0.16, attack: 0.006 });
      tone(ctx, out, { type: "sine", freq: 1046, start: 0.12, dur: 0.5, peak: 0.14, attack: 0.006 });
      // Subtle shimmer partial
      tone(ctx, out, { type: "sine", freq: 1568, start: 0.12, dur: 0.4, peak: 0.05 });
      break;

    case "news_breaking":
      // Low dramatic sting — descending saw + a noise swell.
      tone(ctx, out, { type: "sawtooth", freq: 220, freqEnd: 90, start: 0, dur: 0.7, peak: 0.18, attack: 0.01 });
      tone(ctx, out, { type: "sine", freq: 110, freqEnd: 70, start: 0, dur: 0.8, peak: 0.12, attack: 0.02 });
      noiseBurst(ctx, out, { start: 0, dur: 0.5, peak: 0.06, cutoff: 600, type: "lowpass" });
      break;

    case "footstep":
      // Short filtered noise thud.
      noiseBurst(ctx, out, { start: 0, dur: 0.06, peak: 0.12, cutoff: 420, type: "lowpass" });
      break;

    case "church_bell": {
      // Decaying bell — fundamental + inharmonic partials.
      const partials: Array<[number, number, number]> = [
        // [freqMultiplier, peak, dur]
        [1, 0.16, 1.6],
        [2.0, 0.08, 1.3],
        [2.76, 0.06, 1.1],
        [5.4, 0.03, 0.9],
      ];
      const base = 392; // ~G4
      for (const [mult, peak, dur] of partials) {
        tone(ctx, out, { type: "sine", freq: base * mult, start: 0, dur, peak, attack: 0.005 });
      }
      break;
    }
  }
}

function playInternal(key: AudioKey) {
  if (!STATE.enabled) return;
  const ctx = ensureContext();
  if (!ctx) return;
  try {
    renderCue(ctx, key);
  } catch {
    /* synthesis failure — fail silently */
  }
}

function setEnabledInternal(b: boolean) {
  if (STATE.enabled === b) return; // no-op — prevents re-render loops
  STATE.enabled = b;
  notify();
}

function setVolumeInternal(v: number) {
  const clamped = Math.max(0, Math.min(1, v));
  if (STATE.volume === clamped) return;
  STATE.volume = clamped;
  notify();
}

/* ── Hook ──────────────────────────────────────────────────── */

export function useAudio() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    STATE.listeners.add(fn);
    return () => {
      STATE.listeners.delete(fn);
    };
  }, []);

  const play = useCallback((key: AudioKey) => playInternal(key), []);
  const setEnabled = useCallback((b: boolean) => setEnabledInternal(b), []);
  const setVolume = useCallback((v: number) => setVolumeInternal(v), []);

  // Stable object — only the `enabled` field can change, and only after a
  // notify() tick. Without useMemo this object literal would be a brand-new
  // reference every render, which trips any consumer's useEffect dep array
  // (App.tsx) into an infinite re-render loop. Bug reproduced 2026-05-12.
  return useMemo(
    () => ({ play, setEnabled, setVolume, enabled: STATE.enabled }),
    [play, setEnabled, setVolume, STATE.enabled],
  );
}
