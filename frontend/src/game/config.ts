import Phaser from "phaser";

export const GAME_CONFIG: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 1200,
  height: 800,
  backgroundColor: "#e8dcc8",
  pixelArt: false,
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

export interface Landmark {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  type: string;
}

export const TOWN_LANDMARKS: Record<string, Landmark[]> = {
  dover: [
    { name: "Blackwell Street", x: 200, y: 380, width: 800, height: 30, color: "#D4A574", type: "road" },
    { name: "Dover Station", x: 100, y: 550, width: 140, height: 90, color: "#8B7355", type: "transport" },
    { name: "St. Mary's Church", x: 750, y: 180, width: 110, height: 120, color: "#C9B896", type: "church" },
    { name: "La Finca Restaurant", x: 350, y: 280, width: 100, height: 70, color: "#E8763B", type: "building" },
    { name: "Public Library", x: 550, y: 500, width: 120, height: 80, color: "#A0C4E8", type: "building" },
    { name: "Factory", x: 950, y: 300, width: 160, height: 120, color: "#7A7A7A", type: "building" },
    { name: "Public Housing", x: 150, y: 150, width: 140, height: 90, color: "#C4B5A0", type: "housing" },
    { name: "Bodega Row", x: 500, y: 280, width: 120, height: 60, color: "#E8A060", type: "building" },
    { name: "Town Park", x: 400, y: 600, width: 180, height: 140, color: "#7CB87C", type: "park" },
  ],
  montclair: [
    { name: "Bloomfield Ave", x: 100, y: 380, width: 1000, height: 30, color: "#D4A574", type: "road" },
    { name: "Bay Street Station", x: 900, y: 550, width: 140, height: 90, color: "#8B7355", type: "transport" },
    { name: "Art Museum", x: 200, y: 180, width: 150, height: 120, color: "#6B5CE7", type: "building" },
    { name: "Town Hall", x: 550, y: 200, width: 130, height: 100, color: "#C9B896", type: "building" },
    { name: "Public Library", x: 350, y: 500, width: 120, height: 80, color: "#A0C4E8", type: "building" },
    { name: "Anderson Park", x: 750, y: 150, width: 200, height: 160, color: "#7CB87C", type: "park" },
    { name: "St. Paul Baptist", x: 150, y: 550, width: 110, height: 90, color: "#C9B896", type: "church" },
    { name: "Watchung Plaza", x: 500, y: 500, width: 140, height: 70, color: "#D4A574", type: "building" },
    { name: "Boutique Row", x: 300, y: 280, width: 160, height: 60, color: "#B8A0D4", type: "building" },
  ],
  parsippany: [
    { name: "Route 46", x: 100, y: 350, width: 1000, height: 35, color: "#B0A090", type: "road" },
    { name: "Corporate Park", x: 800, y: 150, width: 200, height: 150, color: "#607090", type: "building" },
    { name: "Lake Parsippany", x: 200, y: 150, width: 180, height: 140, color: "#70B8D0", type: "park" },
    { name: "Hindu Temple", x: 600, y: 200, width: 100, height: 100, color: "#D4A060", type: "church" },
    { name: "Indian Grocery", x: 450, y: 250, width: 120, height: 60, color: "#2DA8A8", type: "building" },
    { name: "Public Library", x: 350, y: 500, width: 120, height: 80, color: "#A0C4E8", type: "building" },
    { name: "Residential Area", x: 150, y: 500, width: 160, height: 120, color: "#C4B5A0", type: "housing" },
    { name: "NJ Transit Stop", x: 700, y: 500, width: 100, height: 60, color: "#8B7355", type: "transport" },
    { name: "Community Center", x: 900, y: 450, width: 130, height: 90, color: "#A0C4B0", type: "building" },
  ],
  randolph: [
    { name: "Main Road", x: 100, y: 400, width: 1000, height: 30, color: "#D4A574", type: "road" },
    { name: "Town Hall", x: 500, y: 200, width: 140, height: 110, color: "#C9B896", type: "building" },
    { name: "High School", x: 800, y: 180, width: 180, height: 130, color: "#A0B8C8", type: "building" },
    { name: "Commercial Strip", x: 300, y: 280, width: 200, height: 60, color: "#D4B896", type: "building" },
    { name: "Sports Fields", x: 200, y: 550, width: 200, height: 140, color: "#90C890", type: "park" },
    { name: "Hedden Park", x: 750, y: 530, width: 180, height: 160, color: "#7CB87C", type: "park" },
    { name: "Church", x: 950, y: 300, width: 100, height: 90, color: "#C9B896", type: "church" },
    { name: "Randolph Diner", x: 150, y: 300, width: 100, height: 60, color: "#E8C080", type: "building" },
    { name: "Residential Cul-de-sacs", x: 600, y: 550, width: 140, height: 100, color: "#C4B5A0", type: "housing" },
  ],
};

/* ── ElevenLabs Voice Mapping ─────────────────────────────── */

export const AGENT_VOICES: Record<string, { voiceId: string; label: string }> = {
  default: { voiceId: "21m00Tcm4TlvDq8ikWAM", label: "Default" },
  // Map agents by demographic type
  "latino-male": { voiceId: "29vD33N1CtxCmqQRPOHJ", label: "Warm Male" },
  "latina-female": { voiceId: "EXAVITQu4vr4xnSDxMaL", label: "Energetic Female" },
  "elderly-female": { voiceId: "MF3mGyEYCl7XYWbV9V6O", label: "Gentle Female" },
  "indian-male": { voiceId: "TxGEqnHWrfWFTfGW9XjX", label: "Professional Male" },
  "american-male": { voiceId: "VR6AewLTigWG4xSOukaG", label: "Authoritative Male" },
  "asian-female": { voiceId: "pNInz6obpgDQGcFmaJgB", label: "Soft Female" },
  "young-female": { voiceId: "jBpfuIE2acCO8z3wKNLl", label: "Young Female" },
  "young-male": { voiceId: "yoZ06aMxZJJ28mfd3POQ", label: "Young Male" },
};

// Map each agent to a voice type
export const AGENT_VOICE_MAP: Record<string, string> = {
  "carlos-restrepo": "latino-male",
  "miguel-hernandez": "latino-male",
  "maria-santos": "latina-female",
  "esperanza-guzman": "elderly-female",
  "sofia-ramirez": "young-female",
  "tom-kowalski": "american-male",
  "rosa-chen": "asian-female",
  "jordan-williams": "young-male",
  "rabbi-daniel-goldstein": "american-male",
  "raj-&-sunita-krishnamurthy": "indian-male",
  "pawan-sharma": "indian-male",
  "brian-mccarthy": "american-male",
  "grace-reyes": "latina-female",
  "michael-\"mike\"-brennan": "american-male",
  "frank-deluca": "american-male",
  "vikram-iyer": "indian-male",
  "tony-mancini": "american-male",
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
