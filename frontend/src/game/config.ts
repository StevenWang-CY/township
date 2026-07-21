import Phaser from "phaser";
import type { TownId } from "../types/messages";

export const GAME_CONFIG: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 1200,
  height: 800,
  backgroundColor: "#e8dcc8",
  pixelArt: true,
  antialias: false,
  roundPixels: true,
  physics: {
    default: "arcade",
    arcade: { gravity: { x: 0, y: 0 } },
  },
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};

/* ── Landmark Definitions ──────────────────────────────────── */

// Landmark data has moved to `useTownData()` (which fetches the active
// scenario package and uses a neutral village only while it resolves). This
// interface remains here for any legacy import sites.
export interface Landmark {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  type: string;
}

/* ── Per-town tilemap keys ─────────────────────────────────── */

/** Tilemap cache key for a town — works for any scenario's town ids. */
export function townMapKey(townId: TownId): string {
  return `${townId}-map`;
}

/* ── Optional TTS voice palette ────────────────────────────── */

// Stable variety without inferring a voice from a resident's name,
// background, age, gender, or scenario. Deployments may still override voice
// behavior server-side through their TTS provider configuration.
const CONVERSATION_VOICES = [
  "21m00Tcm4TlvDq8ikWAM",
  "29vD33N1CtxCmqQRPOHJ",
  "EXAVITQu4vr4xnSDxMaL",
  "MF3mGyEYCl7XYWbV9V6O",
  "TxGEqnHWrfWFTfGW9XjX",
  "pNInz6obpgDQGcFmaJgB",
] as const;

/** Pick a consistent, scenario-neutral voice for a resident id. */
export function voiceIdForAgent(agentId: string): string {
  return CONVERSATION_VOICES[stableHash(agentId) % CONVERSATION_VOICES.length];
}

/* ── Town Background / Accent Colors ───────────────────────── */
//
// Runtime scenario payloads own the primary UI colors. These deterministic
// fallbacks give procedural/loading art a deliberate palette for any town id.

/** Warm, parchment-compatible accent palette for unknown towns. */
const GENERIC_ACCENTS = [
  "#C08A4E", // amber oak
  "#7A9E7E", // river sage
  "#B0713A", // terracotta
  "#5A6FA8", // dusk slate-blue
  "#3E8E5A", // meadow green
  "#A8687E", // rosewood
];

/** Matching soft ground washes (same order as GENERIC_ACCENTS). */
const GENERIC_BGS = [
  "#EDE6D6", "#E4EBE0", "#EDE2D2", "#E4E6EE", "#E2ECDF", "#ECE3E2",
];

function stableHash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Seeded-but-stable accent used before scenario metadata resolves. */
export function townAccent(townId: TownId): string {
  return GENERIC_ACCENTS[stableHash(townId) % GENERIC_ACCENTS.length];
}

/** Canvas background wash for a town. */
export function townBgColor(townId: TownId): string {
  return GENERIC_BGS[stableHash(townId) % GENERIC_BGS.length];
}
