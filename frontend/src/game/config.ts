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
    mode: Phaser.Scale.FIT,
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

export const TOWN_MAP_KEY: Record<TownId, string> = {
  dover: "dover-map",
  montclair: "montclair-map",
  parsippany: "parsippany-map",
  randolph: "randolph-map",
};

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

/* ── Town Background Colors ────────────────────────────────── */

export const TOWN_BG_COLORS: Record<string, string> = {
  dover: "#EDE4D6",
  montclair: "#E8E4F0",
  parsippany: "#E0ECE8",
  randolph: "#E4ECE0",
};

/* ── Town Accent Colors ────────────────────────────────────── */

export const TOWN_ACCENT: Record<string, string> = {
  dover: "#E8763B",
  montclair: "#6B5CE7",
  parsippany: "#2DA8A8",
  randolph: "#4A9B5C",
};
