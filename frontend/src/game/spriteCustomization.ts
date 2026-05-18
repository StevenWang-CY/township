/**
 * Per-agent sprite customization map.
 *
 * Maps each of the 26 Township agents to a Smallville body sprite + optional
 * color tint + optional accessory overlay key + optional couple-partner
 * indicator. Outfit overlays were removed (flat-rect chest patches read as
 * floating shapes besides the figure); we differentiate "professional" agents
 * via subtle body tint instead. Couple agents render a single body with a
 * small companion-ring inside the opinion ring rather than a side-by-side
 * second body.
 */

export interface SpriteCustomization {
  /** Phaser texture key (e.g., "char-Carlos_Gomez"). */
  spriteKey: string;
  /** Phaser multiplicative tint applied to the body sprite. 0xffffff = no tint. */
  tint?: number;
  /** Accessory overlay texture key (e.g., "accessory-hijab"). Head-only, hugs silhouette. */
  accessoryKey?: string;
  /**
   * Couple agents (the five "A & B" personas) display a small companion-ring
   * indicator inside the opinion ring instead of a second full body. Provide
   * just a name (for tooltips / journals) and an optional tint for the ring.
   */
  partner?: {
    name: string;
    tint?: number;
  };
}

/* ── Master 26-agent table ──────────────────────────────────── */
/*
 * Tints replace the old outfit overlays. The intent is a *subtle* shift in
 * the body's hue so adjacent agents don't all look identical — not a
 * literal uniform. A few hex hints used below:
 *   0xbcd4dc  cool teal-grey   — medical / scrubs implication
 *   0xd6ac82  warm tan         — labor / outdoor implication
 *   0xb8c0d8  cool blue-grey   — business / formal implication
 *   0xd9c2cc  mauve            — parent / cardigan implication
 *   0xc6d2b4  sage             — casual / community implication
 */

export const AGENT_CUSTOMIZATION: Record<string, SpriteCustomization> = {
  // ── Dover (6) ──────────────────────────────────────────────
  "carlos-restrepo":           { spriteKey: "char-Carlos_Gomez" },
  "miguel-hernandez":          { spriteKey: "char-Francisco_Lopez", tint: 0xd6ac82 },
  "maria-santos":              { spriteKey: "char-Carmen_Ortiz",    tint: 0xbcd4dc },
  "esperanza-guzman":          { spriteKey: "char-Isabella_Rodriguez", tint: 0xc4b8a6 },
  "sofia-ramirez":             { spriteKey: "char-Jane_Moreno",      tint: 0xc6d2b4 },
  "tom-kowalski":              { spriteKey: "char-Wolfgang_Schulz", tint: 0xd6cdb8 },

  // ── Montclair (7) ──────────────────────────────────────────
  "sarah-&-david-chen":        {
    spriteKey: "char-Mei_Lin",
    partner: { name: "David Chen", tint: 0x6a88b8 },
  },
  "rosa-chen":                 { spriteKey: "char-Yuriko_Yamamoto", tint: 0xd1c8b0 },
  "jordan-williams":           { spriteKey: "char-Latoya_Williams", tint: 0xc6d2b4 },
  "carmen-&-alejandro-vargas": {
    spriteKey: "char-Maria_Lopez",
    tint: 0xd9c2cc,
    partner: { name: "Alejandro Vargas", tint: 0xb8a48a },
  },
  "rabbi-daniel-goldstein":    { spriteKey: "char-Adam_Smith",      accessoryKey: "accessory-kippah" },
  "priya-patel":               { spriteKey: "char-Ayesha_Khan" },
  "margaret-\"peggy\"-o'brien":{ spriteKey: "char-Hailey_Johnson",  tint: 0xb8a896 },

  // ── Parsippany (7) ─────────────────────────────────────────
  "raj-&-sunita-krishnamurthy":{
    spriteKey: "char-Rajiv_Patel",
    partner: { name: "Sunita Krishnamurthy", tint: 0xd4b89c },
  },
  "kantibhai-\"kanti\"-desai": { spriteKey: "char-Eddy_Lin",        tint: 0xc8b89c },
  "brian-mccarthy":            { spriteKey: "char-Sam_Moore",       tint: 0xb8c0d8 },
  "aisha-&-omar-khan":         {
    spriteKey: "char-Abigail_Chen",
    accessoryKey: "accessory-hijab",
    partner: { name: "Omar Khan", tint: 0x8a8aa8 },
  },
  "pawan-sharma":              { spriteKey: "char-Giorgio_Rossi" },
  "linda-morrison":            { spriteKey: "char-Jennifer_Moore",  tint: 0xb8c0d8 },
  "grace-reyes":               { spriteKey: "char-Tamara_Taylor",   tint: 0xbcd4dc },

  // ── Randolph (6) ───────────────────────────────────────────
  "michael-\"mike\"-brennan":  { spriteKey: "char-Arthur_Burton",   tint: 0xb8c0d8 },
  "jennifer-\"jen\"-russo":    { spriteKey: "char-Hailey_Johnson",  tint: 0xd9c2cc },
  "frank-deluca":              { spriteKey: "char-Arthur_Burton",   tint: 0xa8a098, accessoryKey: "accessory-cap" },
  "tyler-&-megan-hart":        {
    spriteKey: "char-Ryan_Park",
    partner: { name: "Megan Hart", tint: 0xe0c8a8 },
  },
  "vikram-iyer":               { spriteKey: "char-Rajiv_Patel",     tint: 0x8aa0c8 },
  "tony-mancini":              { spriteKey: "char-John_Lin",        tint: 0xd6ac82 },
};

/* ── Fallback ring (rotated when an agent isn't in the table) ── */

export const FALLBACK_SPRITES = [
  "char-Carlos_Gomez",
  "char-Maria_Lopez",
  "char-Adam_Smith",
  "char-Abigail_Chen",
  "char-Tom_Moreno",
  "char-Hailey_Johnson",
  "char-Rajiv_Patel",
  "char-Tamara_Taylor",
];

/** Distinct list of body texture keys to preload. */
export const ALL_CHARACTER_KEYS: string[] = Array.from(
  new Set([
    ...Object.values(AGENT_CUSTOMIZATION).map((c) => c.spriteKey),
    ...FALLBACK_SPRITES,
  ]),
);

/** Look up an agent's sprite customization, falling back to a stable hash. */
export function resolveAgentSprite(agentId: string): SpriteCustomization {
  const direct = AGENT_CUSTOMIZATION[agentId];
  if (direct) return direct;
  // Stable hash to pick a deterministic fallback (so reloads don't reshuffle).
  let h = 0;
  for (let i = 0; i < agentId.length; i++) h = (h * 31 + agentId.charCodeAt(i)) >>> 0;
  return { spriteKey: FALLBACK_SPRITES[h % FALLBACK_SPRITES.length] };
}
