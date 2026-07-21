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

// Landmark data has moved to `useTownData()` (which fetches from /api/towns,
// with a hard-coded fallback identical to the prior `TOWN_LANDMARKS` table).
// This interface remains here for any legacy import sites.
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

/* ── ElevenLabs Voice Mapping ─────────────────────────────── */

export const AGENT_VOICES: Record<string, { voiceId: string; label: string }> = {
  default: { voiceId: "21m00Tcm4TlvDq8ikWAM", label: "Default" },
  // Map agents by demographic type
  "latino-male": { voiceId: "29vD33N1CtxCmqQRPOHJ", label: "Warm Male" },
  "latina-female": { voiceId: "EXAVITQu4vr4xnSDxMaL", label: "Energetic Female" },
  "elderly-female": { voiceId: "MF3mGyEYCl7XYWbV9V6O", label: "Gentle Female" },
  "elderly-male": { voiceId: "VR6AewLTigWG4xSOukaG", label: "Authoritative Male" },
  "indian-male": { voiceId: "TxGEqnHWrfWFTfGW9XjX", label: "Professional Male" },
  "indian-female": { voiceId: "pNInz6obpgDQGcFmaJgB", label: "Soft Female" },
  "american-male": { voiceId: "VR6AewLTigWG4xSOukaG", label: "Authoritative Male" },
  "asian-female": { voiceId: "pNInz6obpgDQGcFmaJgB", label: "Soft Female" },
  "young-female": { voiceId: "jBpfuIE2acCO8z3wKNLl", label: "Young Female" },
  "young-male": { voiceId: "yoZ06aMxZJJ28mfd3POQ", label: "Young Male" },
  "middle-aged-male": { voiceId: "VR6AewLTigWG4xSOukaG", label: "Mature Male" },
  "middle-aged-female": { voiceId: "EXAVITQu4vr4xnSDxMaL", label: "Mature Female" },
};

// Map each of the 26 agents to a voice type.
export const AGENT_VOICE_MAP: Record<string, string> = {
  // ── Dover ─────────────────────────────────────────────────
  "carlos-restrepo": "latino-male",
  "miguel-hernandez": "latino-male",
  "maria-santos": "latina-female",
  "esperanza-guzman": "elderly-female",
  "sofia-ramirez": "young-female",
  "tom-kowalski": "elderly-male",
  // ── Montclair ─────────────────────────────────────────────
  "sarah-&-david-chen": "asian-female",
  "rosa-chen": "elderly-female",
  "jordan-williams": "young-male",
  "carmen-&-alejandro-vargas": "latina-female",
  "rabbi-daniel-goldstein": "middle-aged-male",
  "priya-patel": "indian-female",
  "margaret-\"peggy\"-o'brien": "elderly-female",
  // ── Parsippany ────────────────────────────────────────────
  "raj-&-sunita-krishnamurthy": "indian-male",
  "kantibhai-\"kanti\"-desai": "indian-male",
  "brian-mccarthy": "middle-aged-male",
  "aisha-&-omar-khan": "indian-female",
  "pawan-sharma": "indian-male",
  "linda-morrison": "elderly-female",
  "grace-reyes": "middle-aged-female",
  // ── Randolph ──────────────────────────────────────────────
  "michael-\"mike\"-brennan": "middle-aged-male",
  "jennifer-\"jen\"-russo": "middle-aged-female",
  "frank-deluca": "elderly-male",
  "tyler-&-megan-hart": "young-male",
  "vikram-iyer": "indian-male",
  "tony-mancini": "middle-aged-male",
};

/* ── Town Background / Accent Colors ───────────────────────── */
//
// The NJ-11 towns keep their hand-curated palettes; towns from other
// scenarios get a deterministic pick from a small curated palette (seeded by
// town id) so every town still feels intentionally colored — never grey.

const NJ11_BG_COLORS: Record<string, string> = {
  dover: "#EDE4D6",
  montclair: "#E8E4F0",
  parsippany: "#E0ECE8",
  randolph: "#E4ECE0",
};

const NJ11_ACCENT: Record<string, string> = {
  dover: "#E8763B",
  montclair: "#6B5CE7",
  parsippany: "#2DA8A8",
  randolph: "#4A9B5C",
};

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

function townHash(townId: string): number {
  let h = 2166136261;
  for (let i = 0; i < townId.length; i++) {
    h ^= townId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Accent color for a town — NJ-11 curated, otherwise seeded-but-stable. */
export function townAccent(townId: TownId): string {
  return NJ11_ACCENT[townId] ?? GENERIC_ACCENTS[townHash(townId) % GENERIC_ACCENTS.length];
}

/** Canvas background wash for a town. */
export function townBgColor(townId: TownId): string {
  return NJ11_BG_COLORS[townId] ?? GENERIC_BGS[townHash(townId) % GENERIC_BGS.length];
}
