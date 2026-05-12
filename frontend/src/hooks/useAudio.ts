import { useCallback, useEffect, useState } from "react";

/* ── Types ─────────────────────────────────────────────────── */

export type AudioKey =
  | "speech_pop"
  | "chat_open"
  | "chat_send"
  | "opinion_change"
  | "news_breaking"
  | "footstep"
  | "church_bell";

const AUDIO_URLS: Record<AudioKey, string> = {
  speech_pop: "/assets/audio/sfx/speech_pop.ogg",
  chat_open: "/assets/audio/sfx/chat_open.ogg",
  chat_send: "/assets/audio/sfx/chat_send.ogg",
  opinion_change: "/assets/audio/sfx/opinion_change.ogg",
  news_breaking: "/assets/audio/sfx/news_breaking.ogg",
  footstep: "/assets/audio/sfx/footstep.ogg",
  church_bell: "/assets/audio/sfx/church_bell.ogg",
};

/* ── Singleton state ───────────────────────────────────────── */

interface AudioState {
  enabled: boolean;
  volume: number;
  cache: Map<AudioKey, HTMLAudioElement>;
  // Track keys we've already failed to load so we don't spam the network.
  failed: Set<AudioKey>;
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
  cache: new Map(),
  failed: new Set(),
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

function ensureLoaded(key: AudioKey): HTMLAudioElement | null {
  if (STATE.failed.has(key)) return null;
  let el = STATE.cache.get(key);
  if (!el) {
    try {
      el = new Audio(AUDIO_URLS[key]);
      el.preload = "auto";
      el.addEventListener("error", () => {
        STATE.failed.add(key);
        STATE.cache.delete(key);
      });
      STATE.cache.set(key, el);
    } catch {
      STATE.failed.add(key);
      return null;
    }
  }
  return el;
}

function playInternal(key: AudioKey) {
  if (!STATE.enabled) return;
  const base = ensureLoaded(key);
  if (!base) return;
  try {
    // Clone so overlapping plays don't restart each other.
    const clone = base.cloneNode(true) as HTMLAudioElement;
    clone.volume = Math.max(0, Math.min(1, STATE.volume));
    const p = clone.play();
    if (p && typeof p.catch === "function") {
      p.catch(() => {
        /* autoplay blocked / file 404 — fail silently */
      });
    }
  } catch {
    /* ignore */
  }
}

function setEnabledInternal(b: boolean) {
  STATE.enabled = b;
  notify();
}

function setVolumeInternal(v: number) {
  STATE.volume = Math.max(0, Math.min(1, v));
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

  return { play, setEnabled, setVolume, enabled: STATE.enabled };
}
