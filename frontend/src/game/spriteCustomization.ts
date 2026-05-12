/**
 * Per-agent sprite customization map.
 *
 * Maps each of the 26 Township agents to a Smallville body sprite + optional
 * color tint + optional outfit / accessory overlay key. Resolves the duplicates
 * from the old `AGENT_SPRITE_MAP` (Jennifer_Moore was shared by Peggy & Jen)
 * and applies the Phase 2.1 "new sprite" column from the plan.
 *
 * Used by `TownScene.addAgent` (replaces the inline AGENT_SPRITE_MAP).
 */

export interface SpriteCustomization {
  /** Phaser texture key (e.g., "char-Carlos_Gomez"). */
  spriteKey: string;
  /** Phaser multiplicative tint applied to the body sprite. 0xffffff = no tint. */
  tint?: number;
  /** Outfit overlay texture key (e.g., "outfit-scrubs"). */
  outfitKey?: string;
  /** Accessory overlay texture key (e.g., "accessory-hijab"). */
  accessoryKey?: string;
}

/* ── Master 26-agent table (matches Phase 2.1 spec) ─────────── */

export const AGENT_CUSTOMIZATION: Record<string, SpriteCustomization> = {
  // ── Dover (6) ──────────────────────────────────────────────
  "carlos-restrepo":           { spriteKey: "char-Carlos_Gomez" },
  "miguel-hernandez":          { spriteKey: "char-Francisco_Lopez", outfitKey: "outfit-labor" },
  "maria-santos":              { spriteKey: "char-Carmen_Ortiz",    outfitKey: "outfit-scrubs" },
  "esperanza-guzman":          { spriteKey: "char-Isabella_Rodriguez", tint: 0xd8d4cf },
  "sofia-ramirez":             { spriteKey: "char-Jane_Moreno" },
  "tom-kowalski":              { spriteKey: "char-Wolfgang_Schulz", tint: 0xefe9dd },

  // ── Montclair (7) ──────────────────────────────────────────
  "sarah-&-david-chen":        { spriteKey: "char-Mei_Lin" },
  "rosa-chen":                 { spriteKey: "char-Yuriko_Yamamoto", tint: 0xe9e0c8 },
  "jordan-williams":           { spriteKey: "char-Latoya_Williams" },
  "carmen-&-alejandro-vargas": { spriteKey: "char-Maria_Lopez" },
  "rabbi-daniel-goldstein":    { spriteKey: "char-Adam_Smith",      accessoryKey: "accessory-kippah" },
  "priya-patel":               { spriteKey: "char-Ayesha_Khan" },
  "margaret-\"peggy\"-o'brien":{ spriteKey: "char-Hailey_Johnson",  tint: 0xe5e1dc },

  // ── Parsippany (7) ─────────────────────────────────────────
  "raj-&-sunita-krishnamurthy":{ spriteKey: "char-Rajiv_Patel" },
  "kantibhai-\"kanti\"-desai": { spriteKey: "char-Eddy_Lin",        tint: 0xe6dccb },
  "brian-mccarthy":            { spriteKey: "char-Sam_Moore" },
  "aisha-&-omar-khan":         { spriteKey: "char-Abigail_Chen",    accessoryKey: "accessory-hijab" },
  "pawan-sharma":              { spriteKey: "char-Giorgio_Rossi" },
  "linda-morrison":            { spriteKey: "char-Jennifer_Moore",  tint: 0xe5e1dc },
  "grace-reyes":               { spriteKey: "char-Tamara_Taylor",   outfitKey: "outfit-scrubs" },

  // ── Randolph (6) ───────────────────────────────────────────
  "michael-\"mike\"-brennan":  { spriteKey: "char-Arthur_Burton" },
  "jennifer-\"jen\"-russo":    { spriteKey: "char-Hailey_Johnson" },
  "frank-deluca":              { spriteKey: "char-Arthur_Burton",   tint: 0xc8c4be, accessoryKey: "accessory-cap" },
  "tyler-&-megan-hart":        { spriteKey: "char-Ryan_Park" },
  "vikram-iyer":               { spriteKey: "char-Rajiv_Patel",     tint: 0xc4d4e8 },
  "tony-mancini":              { spriteKey: "char-John_Lin",        outfitKey: "outfit-labor" },
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
