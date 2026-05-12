import Phaser from "phaser";

/**
 * Centralized emote/particle catalog. Each `EmoteKey` maps to a small recipe
 * (glyph, particle palette, lifetime). `AgentSprite.showEmote()` dispatches
 * via this registry — meaning new emote types only require a table entry.
 *
 * Free-standing `playEmote(scene, key, x, y)` is exposed so other systems
 * (encounter conversations, news beats) can fire emotes anywhere.
 */

export type EmoteKey =
  | "agree"
  | "disagree"
  | "surprise"
  | "anger"
  | "joy"
  | "confusion"
  | "heart"
  | "reflecting"
  | "opinion_changed";

export interface EmoteRecipe {
  glyph?: string;
  glyphColor?: string;
  particleColor: number;
  particleCount: number;
  durationMs: number;
  gravityY?: number;
  rise?: number;        // px the glyph drifts up
  shake?: boolean;      // tiny camera shake for high-energy emotes
}

export const EMOTE_REGISTRY: Record<EmoteKey, EmoteRecipe> = {
  agree:        { glyph: "✓",  glyphColor: "#15803D", particleColor: 0x86efac, particleCount: 6,  durationMs: 700,  rise: 14 },
  disagree:     { glyph: "!?", glyphColor: "#A16207", particleColor: 0xfde68a, particleCount: 6,  durationMs: 700,  rise: 14 },
  surprise:     { glyph: "!",  glyphColor: "#1f2937", particleColor: 0xffffff, particleCount: 12, durationMs: 600,  rise: 18, shake: true },
  anger:        { glyph: "✸",  glyphColor: "#b91c1c", particleColor: 0xfca5a5, particleCount: 10, durationMs: 700,  rise: 8 },
  joy:          { glyph: "✨", glyphColor: "#ca8a04", particleColor: 0xfde68a, particleCount: 16, durationMs: 900,  rise: 22 },
  confusion:    { glyph: "?",  glyphColor: "#475569", particleColor: 0xcbd5e1, particleCount: 4,  durationMs: 900,  rise: 14 },
  heart:        { glyph: "♥",  glyphColor: "#ec4899", particleColor: 0xfbcfe8, particleCount: 6,  durationMs: 1100, rise: 24 },
  reflecting:   { glyph: "…",  glyphColor: "#666666", particleColor: 0xcbd5e1, particleCount: 0,  durationMs: 3000, rise: 8 },
  opinion_changed: { particleColor: 0xffffff, particleCount: 10, durationMs: 800, gravityY: 80 },
};

/* ── Texture helpers ───────────────────────────────────────── */

function ensureParticleTexture(scene: Phaser.Scene) {
  if (scene.textures.exists("emote-particle")) return;
  const canvas = scene.textures.createCanvas("emote-particle", 4, 4);
  if (canvas) {
    canvas.context.fillStyle = "#ffffff";
    canvas.context.fillRect(0, 0, 4, 4);
    canvas.refresh();
  }
}

/* ── Public API ────────────────────────────────────────────── */

/**
 * Fire an emote at world coords (x, y). Returns the burst's lifetime in ms
 * so callers can chain follow-ups.
 *
 * `tint` optionally overrides the recipe's particle color (used by
 * `opinion_changed` to match the candidate color).
 */
export function playEmote(
  scene: Phaser.Scene,
  key: EmoteKey,
  x: number,
  y: number,
  options?: { tint?: number },
): number {
  const r = EMOTE_REGISTRY[key];
  if (!r) return 0;

  // Particles
  if (r.particleCount > 0) {
    ensureParticleTexture(scene);
    const emitter = scene.add.particles(x, y, "emote-particle", {
      speed: { min: 35, max: 95 },
      angle: { min: 215, max: 325 },
      lifespan: r.durationMs,
      quantity: r.particleCount,
      tint: options?.tint ?? r.particleColor,
      scale: { start: 1.4, end: 0 },
      alpha: { start: 1, end: 0 },
      gravityY: r.gravityY ?? 40,
      emitting: false,
    });
    emitter.setDepth(500);
    emitter.explode(r.particleCount);
    scene.time.delayedCall(r.durationMs + 200, () => emitter.destroy());
  }

  // Glyph
  if (r.glyph) {
    const txt = scene.add.text(x, y, r.glyph, {
      fontFamily: r.glyph === "♥" ? "serif" : "Inter, monospace",
      fontSize: r.glyph.length > 1 ? "12px" : "16px",
      fontStyle: "bold",
      color: r.glyphColor ?? "#1f2937",
      resolution: 2,
    });
    txt.setOrigin(0.5, 1);
    txt.setDepth(510);
    txt.setAlpha(0);
    txt.setScale(0.6);
    const rise = r.rise ?? 14;
    scene.tweens.add({
      targets: txt,
      alpha: 1,
      scaleX: 1,
      scaleY: 1,
      duration: 140,
      ease: "Back.easeOut",
    });
    scene.tweens.add({
      targets: txt,
      y: y - rise,
      duration: r.durationMs + 200,
      ease: "Sine.easeOut",
    });
    scene.time.delayedCall(r.durationMs - 120, () => {
      scene.tweens.add({
        targets: txt,
        alpha: 0,
        duration: 220,
        onComplete: () => txt.destroy(),
      });
    });
  }

  if (r.shake) {
    scene.cameras.main?.shake(60, 0.0025);
  }
  return r.durationMs;
}
