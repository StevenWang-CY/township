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

/* ── Ordered-dither light + shade ──────────────────────────────────────── */

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/**
 * A radial disc drawn with a Bayer 4x4 ordered dither in `block`-px cells:
 * the pixel-art answer to a soft radial gradient. `alphaAt(t)` maps the
 * normalised distance from the centre (0..1) to a target alpha; each cell
 * is either fully painted or skipped, so the falloff reads as dither rings
 * instead of a blur.
 */
export function ensureDitheredDiscTexture(
  scene: Phaser.Scene,
  key: string,
  size: number,
  rgb: [number, number, number],
  alphaAt: (t: number) => number,
  block = 2,
): string {
  if (scene.textures.exists(key)) return key;
  const canvas = scene.textures.createCanvas(key, size, size);
  if (!canvas) return key;
  const ctx = canvas.context;
  const half = size / 2;
  for (let y = 0; y < size; y += block) {
    for (let x = 0; x < size; x += block) {
      const t = Math.min(1, Math.hypot(x + block / 2 - half, y + block / 2 - half) / half);
      const a = Math.max(0, Math.min(1, alphaAt(t)));
      const bx = (x / block) & 3;
      const by = (y / block) & 3;
      // Four brightness bands: the threshold decides whether this cell paints
      // at all; the band decides how solid it is.
      if (a * 16 <= BAYER4[by][bx]) continue;
      const band = a > 0.75 ? 1 : a > 0.5 ? 0.8 : a > 0.25 ? 0.62 : 0.45;
      ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${band})`;
      ctx.fillRect(x, y, block, block);
    }
  }
  canvas.refresh();
  return key;
}

/** 256px dithered vignette (clear centre → dark dithered edges). Scaled to fit. */
export function ensureVignetteTexture(scene: Phaser.Scene): string {
  return ensureDitheredDiscTexture(
    scene,
    "px-vignette",
    256,
    [12, 10, 20],
    (t) => (t < 0.45 ? 0 : ((t - 0.45) / 0.55) * 0.6),
    4,
  );
}

/** 48px warm dithered halo for lit windows at night. */
export function ensureWindowGlowTexture(scene: Phaser.Scene): string {
  return ensureDitheredDiscTexture(scene, "px-window-glow", 48, [255, 200, 120], (t) => (1 - t) ** 1.6 * 0.9, 2);
}

/** 40px dithered lamp glow (tinted per town at use). */
export function ensureLampGlowTexture(scene: Phaser.Scene): string {
  return ensureDitheredDiscTexture(scene, "px-lamp-glow", 40, [255, 255, 255], (t) => (1 - t) ** 1.4, 2);
}

/* ── Pixel ambience sprites ────────────────────────────────────────────── */

function paintRows(scene: Phaser.Scene, key: string, rows: string[], palette: Record<string, string>): string {
  if (scene.textures.exists(key)) return key;
  const w = rows[0].length;
  const h = rows.length;
  const canvas = scene.textures.createCanvas(key, w, h);
  if (!canvas) return key;
  const ctx = canvas.context;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = palette[rows[y][x]];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  canvas.refresh();
  return key;
}

/** Three checker-dithered smoke puffs (6 / 8 / 11 px). */
export function ensureSmokePuffTextures(scene: Phaser.Scene): [string, string, string] {
  const keys: [string, string, string] = ["px-smoke-6", "px-smoke-8", "px-smoke-11"];
  const sizes = [6, 8, 11];
  keys.forEach((key, i) => {
    if (scene.textures.exists(key)) return;
    const S = sizes[i];
    const canvas = scene.textures.createCanvas(key, S, S);
    if (!canvas) return;
    const ctx = canvas.context;
    const r = S / 2;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const d = Math.hypot(x + 0.5 - r, y + 0.5 - r) / r;
        if (d > 1) continue;
        const solid = d < 0.55 || (x + y) % 2 === 0;
        if (!solid) continue;
        ctx.fillStyle = d < 0.55 ? "rgba(246, 243, 236, 1)" : "rgba(226, 222, 212, 0.85)";
        ctx.fillRect(x, y, 1, 1);
      }
    }
    canvas.refresh();
  });
  return keys;
}

/** 2x2 petal / speck, white — tint at use. */
export function ensurePetalTexture(scene: Phaser.Scene): string {
  const key = "px-petal";
  if (scene.textures.exists(key)) return key;
  const canvas = scene.textures.createCanvas(key, 2, 2);
  if (canvas) {
    canvas.context.fillStyle = "#ffffff";
    canvas.context.fillRect(0, 0, 2, 2);
    canvas.refresh();
  }
  return key;
}

/** Three 1px ripple rings (r = 4, 6, 8) that a ripple cycles through. */
export function ensureRippleTextures(scene: Phaser.Scene): [string, string, string] {
  const keys: [string, string, string] = ["px-ripple-4", "px-ripple-6", "px-ripple-8"];
  [4, 6, 8].forEach((r, i) => {
    const key = keys[i];
    if (scene.textures.exists(key)) return;
    const S = r * 2 + 2;
    const canvas = scene.textures.createCanvas(key, S, S);
    if (!canvas) return;
    const ctx = canvas.context;
    ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    // Bresenham-ish ring: every cell whose distance rounds to r.
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const d = Math.hypot(x + 0.5 - S / 2, (y + 0.5 - S / 2) * 1.6);
        if (Math.abs(d - r) < 0.7) ctx.fillRect(x, y, 1, 1);
      }
    }
    canvas.refresh();
  });
  return keys;
}

/** Two-frame falling leaf (5x3) in a colour — flat and tilted. */
export function ensureLeafTextures(scene: Phaser.Scene, color: number): [string, string] {
  const hex = `#${color.toString(16).padStart(6, "0")}`;
  const dark = `#${Math.max(0, (color >> 16) - 40).toString(16).padStart(2, "0")}${Math.max(0, ((color >> 8) & 255) - 40).toString(16).padStart(2, "0")}${Math.max(0, (color & 255) - 40).toString(16).padStart(2, "0")}`;
  const a = paintRows(scene, `px-leaf-${hex}-a`, [".###.", "##.##", ".###."], { "#": hex, ".": "" });
  const b = paintRows(scene, `px-leaf-${hex}-b`, ["..##.", ".#.#.", "##..."], { "#": dark, ".": "" });
  return [a, b];
}

/** Two-frame bird silhouette (7x5): wings up / wings down. */
export function ensureBirdTextures(scene: Phaser.Scene): [string, string] {
  const ink = "#2b2f3a";
  const up = paintRows(scene, "px-bird-up", ["#.....#", ".#...#.", "..#.#..", "...#...", "......."], { "#": ink });
  const down = paintRows(scene, "px-bird-down", [".......", "...#...", "..###..", ".#...#.", "#.....#"], { "#": ink });
  return [up, down];
}

/** Two-frame mallard (10x7): head up / head dipped. */
export function ensureDuckTextures(scene: Phaser.Scene): [string, string] {
  const pal = { "h": "#2f6b3a", "b": "#7a5a3a", "B": "#9a7a52", "e": "#1c1c1c", "k": "#d9a441", "w": "#f2ecd8" };
  const a = paintRows(scene, "px-duck-a", [
    ".......hh.",
    "......hhhk",
    "......eh..",
    ".wbbbbbh..",
    "wbBBBBbb..",
    ".bbbbbbb..",
    "..bbbbb...",
  ], pal);
  const b = paintRows(scene, "px-duck-b", [
    "..........",
    "..........",
    ".......hh.",
    ".wbbbbhhhk",
    "wbBBBBbeh.",
    ".bbbbbbb..",
    "..bbbbb...",
  ], pal);
  return [a, b];
}

/* ── Pixel type: a hand-authored 5x7 uppercase font ────────────────────── */

const FONT_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,:'-!?&/";

const GLYPHS: Record<string, string[]> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".####", "#....", "#....", "#.###", "#...#", "#...#", ".####"],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "#....", "####.", "....#", "....#", "####."],
  "6": [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
  ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
  ",": [".....", ".....", ".....", ".....", ".##..", ".##..", ".#..."],
  ":": [".....", ".##..", ".##..", ".....", ".##..", ".##..", "....."],
  "'": [".##..", ".##..", ".#...", ".....", ".....", ".....", "....."],
  "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
  "!": ["..#..", "..#..", "..#..", "..#..", "..#..", ".....", "..#.."],
  "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
  "&": [".##..", "#..#.", "#..#.", ".##..", "#.#.#", "#..#.", ".##.#"],
  "/": ["....#", "...#.", "...#.", "..#..", ".#...", ".#...", "#...."],
};

export const PIXEL_FONT = "px-font";
export const PIXEL_FONT_OUTLINED = "px-font-o";
/** Advance per glyph (5 px + 1 px gap). */
export const PIXEL_FONT_ADVANCE = 6;

/**
 * Register the two bitmap fonts: `px-font` (5x7 in a 6x8 cell, white — tint
 * at use) and `px-font-o` (the same glyphs with a baked 1 px dark outline in
 * an 8x10 cell, for names and captions that sit on busy tiles). Textured
 * quads never antialias, so labels stay crisp at any integer scale.
 */
export function ensurePixelFont(scene: Phaser.Scene): void {
  if (scene.cache.bitmapFont.has(PIXEL_FONT)) return;
  const n = FONT_CHARS.length;
  const plain = scene.textures.createCanvas(`${PIXEL_FONT}-atlas`, n * 6, 8);
  const outlined = scene.textures.createCanvas(`${PIXEL_FONT_OUTLINED}-atlas`, n * 8, 10);
  if (!plain || !outlined) return;
  const pc = plain.context;
  const oc = outlined.context;
  for (let i = 0; i < n; i++) {
    const rows = GLYPHS[FONT_CHARS[i]] ?? GLYPHS["?"];
    // Outline pass first (dark), then the glyph on top of both atlases.
    oc.fillStyle = "#1b1812";
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 5; x++) {
        if (rows[y][x] !== "#") continue;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) oc.fillRect(i * 8 + 1 + x + dx, 1 + y + dy, 1, 1);
        }
      }
    }
    pc.fillStyle = "#ffffff";
    oc.fillStyle = "#ffffff";
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 5; x++) {
        if (rows[y][x] !== "#") continue;
        pc.fillRect(i * 6 + x, y, 1, 1);
        oc.fillRect(i * 8 + 1 + x, 1 + y, 1, 1);
      }
    }
  }
  plain.refresh();
  outlined.refresh();
  scene.cache.bitmapFont.add(PIXEL_FONT, Phaser.GameObjects.RetroFont.Parse(scene, {
    image: `${PIXEL_FONT}-atlas`,
    width: 6,
    height: 8,
    chars: FONT_CHARS,
    charsPerRow: n,
    "offset.x": 0,
    "offset.y": 0,
    "spacing.x": 0,
    "spacing.y": 0,
    lineSpacing: 0,
  }));
  scene.cache.bitmapFont.add(PIXEL_FONT_OUTLINED, Phaser.GameObjects.RetroFont.Parse(scene, {
    image: `${PIXEL_FONT_OUTLINED}-atlas`,
    width: 8,
    height: 10,
    chars: FONT_CHARS,
    charsPerRow: n,
    "offset.x": 0,
    "offset.y": 0,
    "spacing.x": 0,
    "spacing.y": 0,
    lineSpacing: 0,
  }));
}

/** Text the pixel font can render: uppercase, unknown glyphs → "?". */
export function pixelText(text: string): string {
  return text
    .toUpperCase()
    .split("")
    .map((ch) => (FONT_CHARS.includes(ch) ? ch : ch === "’" ? "'" : ch === "—" || ch === "–" ? "-" : "?"))
    .join("");
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
