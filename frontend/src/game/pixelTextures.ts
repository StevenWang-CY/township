/**
 * Generated pixel textures shared by AgentSprite and TownScene.
 *
 * Everything here is tiny canvas art built at runtime — chunky, dithered,
 * quantized to a few tones so sprites and effects sit natively on the 16px
 * tile world instead of floating above it like vector shapes.
 */
import Phaser from "phaser";

/** True when the user asked for reduced motion (App.tsx stamps <html>). */
export function reducedMotion(): boolean {
  if (typeof document === "undefined") return false;
  if (document.documentElement.hasAttribute("data-reduced-motion")) return true;
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {
    return false;
  }
}

/* ── Dithered ground shadow ────────────────────────────────────────────── */

/**
 * 26x10 three-tone dithered shadow ellipse built from 2x2 blocks, drawn at
 * final size so callers can keep using plain setScale(1) resets. Sized for
 * the SPRITE_SCALE 1.6 body (~51 px tall, ~24 px wide at the shoulders).
 */
export function ensureShadowTexture(scene: Phaser.Scene): string {
  const key = "px-shadow";
  if (scene.textures.exists(key)) return key;
  const W = 26, H = 10, B = 2; // B = chunky block size
  const canvas = scene.textures.createCanvas(key, W, H);
  if (!canvas) return key;
  const ctx = canvas.context;
  const cx = W / 2 - 1, cy = H / 2 - 1, rx = W / 2, ry = H / 2;
  for (let y = 0; y < H; y += B) {
    for (let x = 0; x < W; x += B) {
      const d = ((x + 1 - cx) / rx) ** 2 + ((y + 1 - cy) / ry) ** 2;
      if (d > 1) continue;
      const bx = x / B, by = y / B;
      let a = 0;
      if (d < 0.4) a = 0.30;                                  // core
      else if (d < 0.75) a = (bx + by) % 2 === 0 ? 0.30 : 0.18; // mid dither
      else a = (bx + by) % 2 === 0 ? 0.14 : 0;                // edge dither
      if (a > 0) {
        ctx.fillStyle = `rgba(20, 16, 10, ${a})`;
        ctx.fillRect(x, y, B, B);
      }
    }
  }
  canvas.refresh();
  return key;
}

/* ── Chunky pixel opinion ring ─────────────────────────────────────────── */

/**
 * 2-frame chunky pixel GROUND ring in a candidate color: a flattened
 * ellipse of 2x2 blocks that sits under the agent's feet like a native
 * tile marker. Frame B shifts the dim-block pattern for a subtle shimmer.
 * Returns the two texture keys.
 */
export function ensureRingTextures(
  scene: Phaser.Scene,
  color: string,
): [string, string] {
  const hex = color.replace("#", "").toLowerCase();
  const keys: [string, string] = [`px-ring-${hex}-a`, `px-ring-${hex}-b`];
  if (scene.textures.exists(keys[0])) return keys;
  const col = Phaser.Display.Color.HexStringToColor(color);
  // Hand-authored pixel ellipse (each cell = one 2x2 block → clean 2px line).
  // Sized for the SPRITE_SCALE 1.6 body: 32x14 px sits just past the feet.
  const MASK = [
    "....########....",
    "..##........##..",
    ".#............#.",
    "#..............#",
    ".#............#.",
    "..##........##..",
    "....########....",
  ];
  const W = MASK[0].length * 2, H = MASK.length * 2;
  for (let f = 0; f < 2; f++) {
    const canvas = scene.textures.createCanvas(keys[f], W, H);
    if (!canvas) continue;
    const ctx = canvas.context;
    let i = 0;
    for (let r = 0; r < MASK.length; r++) {
      for (let c = 0; c < MASK[r].length; c++) {
        if (MASK[r][c] !== "#") continue;
        i++;
        // Every third block dims; frame B advances the pattern one step.
        const dim = (i + f) % 3 === 0;
        ctx.fillStyle = `rgba(${col.red}, ${col.green}, ${col.blue}, ${dim ? 0.5 : 0.9})`;
        ctx.fillRect(c * 2, r * 2, 2, 2);
      }
    }
    canvas.refresh();
  }
  return keys;
}

/* ── Tiny effect sprites ───────────────────────────────────────────────── */

/** 3x3 white square — tint at use (confetti, sparks). */
export function ensureSquareTexture(scene: Phaser.Scene): string {
  const key = "px-square";
  if (scene.textures.exists(key)) return key;
  const canvas = scene.textures.createCanvas(key, 3, 3);
  if (canvas) {
    canvas.context.fillStyle = "#ffffff";
    canvas.context.fillRect(0, 0, 3, 3);
    canvas.refresh();
  }
  return key;
}

/** 7x8 pixel ballot: cream paper, ink border, mark slot. Tint with option color. */
export function ensureBallotTexture(scene: Phaser.Scene): string {
  const key = "px-ballot";
  if (scene.textures.exists(key)) return key;
  const canvas = scene.textures.createCanvas(key, 7, 8);
  if (!canvas) return key;
  const ctx = canvas.context;
  ctx.fillStyle = "#f5efe0";
  ctx.fillRect(0, 0, 7, 8);
  ctx.fillStyle = "#2c2416";
  ctx.fillRect(0, 0, 7, 1); ctx.fillRect(0, 7, 7, 1);
  ctx.fillRect(0, 0, 1, 8); ctx.fillRect(6, 0, 1, 8);
  ctx.fillRect(2, 3, 3, 2); // the mark
  canvas.refresh();
  return key;
}

/** 12x9 pixel newspaper: folded sheet with headline bar + text lines. */
export function ensureNewspaperTexture(scene: Phaser.Scene): string {
  const key = "px-news";
  if (scene.textures.exists(key)) return key;
  const canvas = scene.textures.createCanvas(key, 12, 9);
  if (!canvas) return key;
  const ctx = canvas.context;
  ctx.fillStyle = "#efe9d8";                 // paper
  ctx.fillRect(0, 0, 12, 9);
  ctx.fillStyle = "#c9c2ae";                 // fold shading
  ctx.fillRect(0, 7, 12, 2);
  ctx.fillStyle = "#2c2416";                 // outline
  ctx.fillRect(0, 0, 12, 1); ctx.fillRect(0, 8, 12, 1);
  ctx.fillRect(0, 0, 1, 9); ctx.fillRect(11, 0, 1, 9);
  ctx.fillRect(2, 2, 5, 1);                  // headline bar
  ctx.fillStyle = "#8a8272";                 // body text lines
  ctx.fillRect(2, 4, 8, 1);
  ctx.fillRect(2, 6, 6, 1);
  canvas.refresh();
  return key;
}

/** 7x7 pixel "zz" glyph for residents resting at home. */
export function ensureZzTexture(scene: Phaser.Scene): string {
  const key = "px-zz";
  if (scene.textures.exists(key)) return key;
  const canvas = scene.textures.createCanvas(key, 9, 9);
  if (!canvas) return key;
  const ctx = canvas.context;
  const rows = [
    ".....####",
    "........#",
    ".......#.",
    "......#..",
    ".....####",
    ".###.....",
    "...#.....",
    "..#......",
    ".###.....",
  ];
  ctx.fillStyle = "#5b6d84";
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      if (rows[r][c] === "#") ctx.fillRect(c, r, 1, 1);
    }
  }
  canvas.refresh();
  return key;
}

/* ── Pixel 9-slice plate ───────────────────────────────────────────────── */

export interface PlateStyle {
  /** Border + text ink. */
  ink?: number;
  /** Parchment fill. */
  fill?: number;
  /** Hard 2 px drop shadow alpha (0 disables). */
  shadow?: number;
}

/**
 * Draw the shared parchment plate (speech bubbles, topic strips, takeaway
 * cards, hover chips): a hard offset shadow, a cross-shaped body so the 2 px
 * corners stay notched, and a 2 px ink border skipping those corners.
 * (x, y) is the plate's top-left in the Graphics' local space.
 */
export function drawPixelPlate(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  style: PlateStyle = {},
): void {
  const ink = style.ink ?? 0x3a3226;
  const fill = style.fill ?? 0xf6eedd;
  const shadow = style.shadow ?? 0.16;
  if (shadow > 0) {
    g.fillStyle(0x2c2416, shadow);
    g.fillRect(x + 2, y + 3, w, h);
  }
  g.fillStyle(fill, 0.98);
  g.fillRect(x + 2, y, w - 4, h);
  g.fillRect(x, y + 2, w, h - 4);
  g.fillStyle(ink, 1);
  g.fillRect(x + 2, y, w - 4, 2);
  g.fillRect(x + 2, y + h - 2, w - 4, 2);
  g.fillRect(x, y + 2, 2, h - 4);
  g.fillRect(x + w - 2, y + 2, 2, h - 4);
}

/* ── Scene-wide overlays ───────────────────────────────────────────────── */

/** 256px radial vignette (transparent centre → dark edges). Scaled to fit. */
export function ensureVignetteTexture(scene: Phaser.Scene): string {
  const key = "px-vignette";
  if (scene.textures.exists(key)) return key;
  const S = 256;
  const canvas = scene.textures.createCanvas(key, S, S);
  if (!canvas) return key;
  const ctx = canvas.context;
  const grd = ctx.createRadialGradient(S / 2, S / 2, S * 0.28, S / 2, S / 2, S * 0.62);
  grd.addColorStop(0, "rgba(12, 10, 20, 0)");
  grd.addColorStop(1, "rgba(12, 10, 20, 0.55)");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, S, S);
  canvas.refresh();
  return key;
}

/** 64px soft warm radial glow for lit windows at night. */
export function ensureWindowGlowTexture(scene: Phaser.Scene): string {
  const key = "px-window-glow";
  if (scene.textures.exists(key)) return key;
  const S = 64;
  const canvas = scene.textures.createCanvas(key, S, S);
  if (!canvas) return key;
  const ctx = canvas.context;
  const grd = ctx.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
  grd.addColorStop(0, "rgba(255, 214, 138, 0.9)");
  grd.addColorStop(0.5, "rgba(255, 190, 110, 0.32)");
  grd.addColorStop(1, "rgba(255, 180, 100, 0)");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, S, S);
  canvas.refresh();
  return key;
}

/* ── Deterministic RNG for the capture pipeline ────────────────────────── */

/** mulberry32 — tiny seeded PRNG, same recipe SceneAmbience uses. */
export function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
