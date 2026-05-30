import Phaser from "phaser";
import type { LandmarkData, TownId } from "../types/messages";

/**
 * Programmatic landmark art. Pure functions — each draws the landmark in
 * Phaser Graphics so the game has a recognizable shape even before any
 * Tiled tilemap art is authored.
 *
 * The returned array can be used by the caller to set depth/visibility or
 * destroy later.
 */

function hexToInt(hex: string | undefined, fallback = 0x888888): number {
  if (!hex) return fallback;
  const cleaned = hex.replace("#", "");
  if (cleaned.length !== 6 && cleaned.length !== 3) return fallback;
  return parseInt(cleaned, 16);
}

/* ── Per-town architectural treatment ───────────────────────── */

type RoofStyle = "row-storefront" | "tudor" | "flat-corporate" | "colonial";
type WindowStyle = "warm-pane" | "diamond" | "teal-glass" | "shutter";

interface TownArchTheme {
  /** Fixed roof color (overrides the body-derived roof when set). */
  roof: number;
  /** Window glow tint. */
  windowColor: number;
  /** Window alpha. */
  windowAlpha: number;
  /** Wall accent wash blended into the body color (toward this hue), 0..1. */
  wallTint: number;
  wallTintColor: number;
  roofStyle: RoofStyle;
  windowStyle: WindowStyle;
}

const TOWN_ARCH: Record<TownId, TownArchTheme> = {
  // Dover — warm brick row-storefronts, terracotta roofs, amber windows.
  dover: {
    roof: 0x9c4a2f, windowColor: 0xffd896, windowAlpha: 0.6,
    wallTint: 0.18, wallTintColor: 0xd98a52,
    roofStyle: "row-storefront", windowStyle: "warm-pane",
  },
  // Montclair — tudor / copper-green roofs, diamond-pane windows.
  montclair: {
    roof: 0x5a7d6a, windowColor: 0xf3e7c0, windowAlpha: 0.55,
    wallTint: 0.14, wallTintColor: 0xcfc2a8,
    roofStyle: "tudor", windowStyle: "diamond",
  },
  // Parsippany — flat corporate, teal glass curtain walls.
  parsippany: {
    roof: 0x39606b, windowColor: 0x9fd8da, windowAlpha: 0.7,
    wallTint: 0.16, wallTintColor: 0xaebfc4,
    roofStyle: "flat-corporate", windowStyle: "teal-glass",
  },
  // Randolph — colonial taupe, shuttered windows, slate roofs.
  randolph: {
    roof: 0x4f4a44, windowColor: 0xf0e6cc, windowAlpha: 0.55,
    wallTint: 0.16, wallTintColor: 0xc9bca2,
    roofStyle: "colonial", windowStyle: "shutter",
  },
};

/** Blend an RGB int toward another RGB int by `amount` (0..1). */
function blendToward(color: number, target: number, amount: number): number {
  const r = (color >> 16) & 0xff, g = (color >> 8) & 0xff, b = color & 0xff;
  const tr = (target >> 16) & 0xff, tg = (target >> 8) & 0xff, tb = target & 0xff;
  const t = Math.max(0, Math.min(1, amount));
  return (
    (Math.round(r + (tr - r) * t) << 16) |
    (Math.round(g + (tg - g) * t) << 8) |
    Math.round(b + (tb - b) * t)
  );
}

/** Draw a single themed window at (x, y) sized (w, h). */
function themedWindow(
  scene: Phaser.Scene, theme: TownArchTheme, x: number, y: number, w: number, h: number,
): Phaser.GameObjects.GameObject {
  const g = scene.add.graphics();
  g.fillStyle(theme.windowColor, theme.windowAlpha);
  g.fillRoundedRect(x, y, w, h, 1.5);
  g.lineStyle(0.8, 0x000000, 0.18);
  g.strokeRoundedRect(x, y, w, h, 1.5);
  switch (theme.windowStyle) {
    case "diamond":
      // Tudor leaded diamond muntins.
      g.lineStyle(0.6, 0x6b5a3a, 0.5);
      g.lineBetween(x, y + h / 2, x + w / 2, y);
      g.lineBetween(x + w / 2, y, x + w, y + h / 2);
      g.lineBetween(x + w, y + h / 2, x + w / 2, y + h);
      g.lineBetween(x + w / 2, y + h, x, y + h / 2);
      break;
    case "teal-glass":
      // Horizontal curtain-wall mullion + cool reflection streak.
      g.lineStyle(0.7, 0x2f5a60, 0.45);
      g.lineBetween(x, y + h / 2, x + w, y + h / 2);
      g.fillStyle(0xffffff, 0.18);
      g.fillRect(x + 1, y + 1, Math.max(1, w * 0.3), h - 2);
      break;
    case "shutter":
      // Flanking colonial shutters.
      g.fillStyle(0x5a6b58, 0.85);
      g.fillRect(x - 2.5, y, 2, h);
      g.fillRect(x + w + 0.5, y, 2, h);
      break;
    case "warm-pane":
    default:
      // Simple cross muntin.
      g.lineStyle(0.6, 0x000000, 0.15);
      g.lineBetween(x + w / 2, y, x + w / 2, y + h);
      g.lineBetween(x, y + h / 2, x + w, y + h / 2);
      break;
  }
  g.setDepth(46);
  return g;
}

/** Blend an RGB int toward a warm cream (#f6efdb) by `amount` (0..1). */
function lightenTowardCream(color: number, amount: number): number {
  const cream = { r: 0xf6, g: 0xef, b: 0xdb };
  const r = (color >> 16) & 0xff, g = (color >> 8) & 0xff, b = color & 0xff;
  const t = Math.max(0, Math.min(1, amount));
  const nr = Math.round(r + (cream.r - r) * t);
  const ng = Math.round(g + (cream.g - g) * t);
  const nb = Math.round(b + (cream.b - b) * t);
  return (nr << 16) | (ng << 8) | nb;
}

/** Multiplicatively darken an RGB int by `amount` (0..1). */
function darken(color: number, amount: number): number {
  const r = (color >> 16) & 0xff, g = (color >> 8) & 0xff, b = color & 0xff;
  const t = Math.max(0, Math.min(1, 1 - amount));
  return (Math.round(r * t) << 16) | (Math.round(g * t) << 8) | Math.round(b * t);
}

/* ── Tiny shape helpers ────────────────────────────────────── */

function tree(scene: Phaser.Scene, x: number, y: number, size = 14): Phaser.GameObjects.GameObject[] {
  const g = scene.add.graphics();
  // Trunk
  g.fillStyle(0x6b4424, 1);
  g.fillRect(x - 2, y, 4, size * 0.6);
  // Canopy: layered circles for depth
  g.fillStyle(0x2f5a2c, 1);
  g.fillCircle(x, y - size * 0.2, size);
  g.fillStyle(0x4a7c3a, 1);
  g.fillCircle(x - size * 0.3, y - size * 0.5, size * 0.75);
  // Specular
  g.fillStyle(0x9bc483, 0.45);
  g.fillCircle(x - size * 0.45, y - size * 0.6, size * 0.3);
  g.setDepth(46 + y);
  return [g];
}

function bench(scene: Phaser.Scene, x: number, y: number): Phaser.GameObjects.GameObject[] {
  const g = scene.add.graphics();
  g.fillStyle(0x000000, 0.18);
  g.fillRect(x - 11, y + 3, 22, 3);
  g.fillStyle(0x6f4a2a, 1);
  g.fillRect(x - 12, y - 3, 24, 4);     // seat
  g.fillStyle(0x4a2f1a, 1);
  g.fillRect(x - 11, y + 1, 2, 4);       // legs
  g.fillRect(x + 9, y + 1, 2, 4);
  g.setDepth(45 + y);
  return [g];
}

function windowGlow(scene: Phaser.Scene, x: number, y: number, w: number, h: number, color = 0xffe9a8, alpha = 0.55): Phaser.GameObjects.GameObject {
  const g = scene.add.graphics();
  g.fillStyle(color, alpha);
  g.fillRoundedRect(x, y, w, h, 1.5);
  // Inner pane darken
  g.lineStyle(0.8, 0x000000, 0.18);
  g.strokeRoundedRect(x, y, w, h, 1.5);
  g.setDepth(46);
  return g;
}

/* ── Per-type builders ─────────────────────────────────────── */

function drawChurch(scene: Phaser.Scene, lm: LandmarkData, accent: number): Phaser.GameObjects.GameObject[] {
  const objs: Phaser.GameObjects.GameObject[] = [];
  const bodyColor = 0xd9c79f;
  const roofColor = 0x6e4a2a;
  const x = lm.x, y = lm.y, w = lm.width, h = lm.height;

  const g = scene.add.graphics();
  // Soft drop shadow
  g.fillStyle(0x000000, 0.12);
  g.fillEllipse(x + w / 2, y + h - 2, w * 1.05, 14);

  // Main body
  g.fillStyle(bodyColor, 1);
  g.fillRect(x + 6, y + h * 0.35, w - 12, h * 0.65);
  // Brick lines
  g.lineStyle(0.6, 0x000000, 0.08);
  for (let i = 1; i < 4; i++) {
    g.lineBetween(x + 6, y + h * 0.35 + (h * 0.65 / 4) * i, x + w - 6, y + h * 0.35 + (h * 0.65 / 4) * i);
  }

  // Roof (gable)
  g.fillStyle(roofColor, 1);
  g.fillTriangle(x + 4, y + h * 0.35, x + w - 4, y + h * 0.35, x + w / 2, y + h * 0.05);

  // Steeple
  const sx = x + w / 2;
  const sBase = y + h * 0.18;
  g.fillStyle(bodyColor, 1);
  g.fillRect(sx - 5, sBase, 10, h * 0.22);
  g.fillStyle(roofColor, 1);
  g.fillTriangle(sx - 7, sBase, sx + 7, sBase, sx, y - 4);

  // Cross
  g.lineStyle(2, 0xffffff, 0.95);
  g.lineBetween(sx, y - 12, sx, y);
  g.lineBetween(sx - 3, y - 8, sx + 3, y - 8);

  // Door
  g.fillStyle(0x5a3a22, 1);
  g.fillRoundedRect(x + w / 2 - 6, y + h - 18, 12, 18, { tl: 6, tr: 6, bl: 0, br: 0 });

  g.setDepth(46);
  objs.push(g);

  // Stained-glass windows (3 windows w/ warm light)
  for (let i = 0; i < 3; i++) {
    const wx = x + 10 + i * ((w - 20) / 2);
    objs.push(windowGlow(scene, wx, y + h * 0.5, 9, 14, 0xffd47a, 0.7));
  }
  // Accent banner across base
  const banner = scene.add.graphics();
  banner.fillStyle(accent, 0.8);
  banner.fillRoundedRect(x + 8, y + h - 6, w - 16, 4, 2);
  banner.setDepth(47);
  objs.push(banner);

  return objs;
}

function drawCommercialBuilding(
  scene: Phaser.Scene, lm: LandmarkData, accent: number, theme: TownArchTheme,
): Phaser.GameObjects.GameObject[] {
  const objs: Phaser.GameObjects.GameObject[] = [];
  const x = lm.x, y = lm.y, w = lm.width, h = lm.height;

  // Lighten the JSON body color so dark hexes like #607090 don't render as a
  // flat dark navy slab. We blend toward warm cream by 35%, then nudge it
  // toward the town's wall-tint hue so each town's storefronts share a palette.
  const rawBody = hexToInt(lm.color, 0xc9a785);
  const tintedBody = blendToward(rawBody, theme.wallTintColor, theme.wallTint);
  const bodyColor = lightenTowardCream(tintedBody, 0.35);
  const upperWash = lightenTowardCream(tintedBody, 0.55);
  // Roof: per-town fixed roof color for a recognizable town silhouette.
  const roofColor = theme.roof;

  const g = scene.add.graphics();
  // Ground shadow
  g.fillStyle(0x000000, 0.15);
  g.fillEllipse(x + w / 2, y + h - 2, w * 1.05, 12);

  // ── Body in two-tone (upper wash, lower body) so the building stops
  //    reading as a single dark monolith.
  g.fillStyle(bodyColor, 1);
  g.fillRect(x + 4, y + 16, w - 8, h - 20);
  g.fillStyle(upperWash, 1);
  g.fillRect(x + 4, y + 16, w - 8, Math.floor((h - 20) * 0.42));
  // Wall seam (faint horizontal line between floors)
  g.lineStyle(1, 0x000000, 0.10);
  g.lineBetween(x + 4, y + 16 + Math.floor((h - 20) * 0.42), x + w - 4, y + 16 + Math.floor((h - 20) * 0.42));

  // ── Per-town roof treatment ────────────────────────────────
  switch (theme.roofStyle) {
    case "tudor": {
      // Steeper gabled roof with a half-timber ridge.
      g.fillStyle(roofColor, 1);
      g.fillTriangle(x + 2, y + 16, x + w - 2, y + 16, x + w / 2, y + 1);
      g.fillStyle(darken(roofColor, 0.18), 1);
      g.fillTriangle(x + w / 2, y + 1, x + w - 2, y + 16, x + w / 2, y + 16);
      // Cream cross-beam under the gable
      g.fillStyle(0xeaddc0, 0.9);
      g.fillRect(x + 6, y + 16, w - 12, 3);
      break;
    }
    case "flat-corporate": {
      // Flat parapet roof + thin teal cap rail — no pitch.
      g.fillStyle(roofColor, 1);
      g.fillRect(x + 2, y + 6, w - 4, 10);
      g.fillStyle(0x6fb0b6, 0.9);
      g.fillRect(x + 2, y + 6, w - 4, 2.5);
      break;
    }
    case "colonial": {
      // Low slate hip roof with a center ridge and eave overhang.
      g.fillStyle(roofColor, 1);
      g.fillRect(x, y + 8, w, 11);
      g.fillStyle(darken(roofColor, 0.22), 1);
      g.fillTriangle(x, y + 8, x + 14, y + 8, x + 7, y + 2);
      g.fillTriangle(x + w, y + 8, x + w - 14, y + 8, x + w - 7, y + 2);
      g.fillRect(x + 14, y + 4, w - 28, 4);
      // Eave shadow line
      g.lineStyle(1, 0x000000, 0.2);
      g.lineBetween(x, y + 19, x + w, y + 19);
      break;
    }
    case "row-storefront":
    default: {
      // Slim two-tone cornice band — classic brick row storefront.
      g.fillStyle(roofColor, 1);
      g.fillRect(x + 2, y + 6, w - 4, 12);
      g.fillStyle(darken(roofColor, 0.20), 1);
      g.fillRect(x + 2, y + 14, w - 4, 4);
      // Dentil detail under the cornice
      g.fillStyle(lightenTowardCream(roofColor, 0.4), 0.8);
      for (let dx = 4; dx < w - 6; dx += 8) g.fillRect(x + dx, y + 12, 3, 2);
      break;
    }
  }
  // Roof front-edge highlight
  g.lineStyle(1, 0xffffff, 0.18);
  g.lineBetween(x + 2, y + 6, x + w - 2, y + 6);

  // ── Awning in the town accent, more saturated, with scalloped underside.
  g.fillStyle(accent, 0.95);
  const awningH = 9;
  g.fillRect(x + 6, y + 18, w - 12, awningH);
  g.lineStyle(1, 0xffffff, 0.5);
  for (let i = 1; i < (w - 12) / 8; i++) {
    g.lineBetween(x + 6 + i * 8, y + 18, x + 6 + i * 8, y + 18 + awningH);
  }
  // Scallop on bottom of awning
  for (let i = 0; i < (w - 12) / 6; i++) {
    g.fillStyle(accent, 0.95);
    g.fillTriangle(
      x + 6 + i * 6, y + 18 + awningH,
      x + 6 + i * 6 + 6, y + 18 + awningH,
      x + 6 + i * 6 + 3, y + 18 + awningH + 3,
    );
  }

  // Sign rail — kept, but smaller + tighter
  g.fillStyle(0xfff8e8, 0.96);
  const sw = Math.min(w - 18, 96);
  g.fillRoundedRect(x + w / 2 - sw / 2, y + 30, sw, 13, 2);
  g.lineStyle(1, 0x000000, 0.18);
  g.strokeRoundedRect(x + w / 2 - sw / 2, y + 30, sw, 13, 2);

  g.setDepth(46);
  objs.push(g);

  // Sign text
  const sign = scene.add.text(x + w / 2, y + 36, lm.name.slice(0, 16), {
    fontFamily: "Inter, sans-serif",
    fontSize: "9px",
    fontStyle: "bold",
    color: "#332617",
    resolution: 2,
  });
  sign.setOrigin(0.5, 0.5);
  sign.setDepth(47);
  objs.push(sign);

  // ── Windows in two rows for wider buildings — gives a recognisable
  //    storefront silhouette instead of one dark plain wall.
  const winCount = Math.max(3, Math.min(7, Math.floor(w / 32)));
  const winGap = (w - 20) / winCount;
  const winRows = h > 100 ? 2 : 1;
  for (let r = 0; r < winRows; r++) {
    const wy = y + h * 0.50 + r * 24;
    for (let i = 0; i < winCount; i++) {
      const wx = x + 10 + i * winGap + (winGap - 9) / 2;
      objs.push(themedWindow(scene, theme, wx, wy, 9, 11));
    }
  }

  // Door + lit door-frame
  const door = scene.add.graphics();
  door.fillStyle(0x4a2f1a, 1);
  door.fillRoundedRect(x + w / 2 - 7, y + h - 18, 14, 18, { tl: 1, tr: 1, bl: 0, br: 0 });
  // Doorknob
  door.fillStyle(0xe6c46a, 1);
  door.fillCircle(x + w / 2 + 4, y + h - 9, 1.2);
  // Lit step
  door.fillStyle(0xfff0c0, 0.5);
  door.fillRect(x + w / 2 - 9, y + h - 2, 18, 2);
  door.setDepth(47);
  objs.push(door);

  return objs;
}

function drawHousing(
  scene: Phaser.Scene, lm: LandmarkData, accent: number, theme: TownArchTheme,
): Phaser.GameObjects.GameObject[] {
  const objs: Phaser.GameObjects.GameObject[] = [];
  const x = lm.x, y = lm.y, w = lm.width, h = lm.height;
  const homes = 3;
  const homeW = w / homes;

  // Per-town wall palette nudged toward the town's wall tint.
  const wallA = blendToward(0xeadcc1, theme.wallTintColor, theme.wallTint * 0.7);
  const wallB = blendToward(0xddc4a4, theme.wallTintColor, theme.wallTint * 0.7);

  for (let i = 0; i < homes; i++) {
    const hx = x + i * homeW;
    const wallColor = i % 2 === 0 ? wallA : wallB;

    const g = scene.add.graphics();
    g.fillStyle(0x000000, 0.12);
    g.fillEllipse(hx + homeW / 2, y + h - 2, homeW * 1.05, 9);

    // Body
    g.fillStyle(wallColor, 1);
    g.fillRect(hx + 4, y + h * 0.4, homeW - 8, h * 0.6);

    // Per-town roof shape
    if (theme.roofStyle === "flat-corporate") {
      // Townhouse-style flat roof with a parapet cap.
      g.fillStyle(theme.roof, 1);
      g.fillRect(hx + 2, y + h * 0.34, homeW - 4, h * 0.08);
    } else if (theme.roofStyle === "colonial") {
      // Lower-pitch hip roof.
      g.fillStyle(theme.roof, 1);
      g.fillTriangle(hx + 2, y + h * 0.4, hx + homeW - 2, y + h * 0.4, hx + homeW / 2, y + h * 0.16);
    } else {
      // Steeper gable (Dover / Montclair).
      g.fillStyle(theme.roof, 1);
      g.fillTriangle(hx + 2, y + h * 0.4, hx + homeW - 2, y + h * 0.4, hx + homeW / 2, y + h * 0.05);
    }

    // Door
    g.fillStyle(accent, 0.85);
    g.fillRect(hx + homeW / 2 - 3, y + h - 12, 6, 12);
    g.setDepth(46);
    objs.push(g);

    // Themed windows
    objs.push(themedWindow(scene, theme, hx + 10, y + h * 0.6, 6, 6));
    objs.push(themedWindow(scene, theme, hx + homeW - 16, y + h * 0.6, 6, 6));
  }

  return objs;
}

function drawPark(scene: Phaser.Scene, lm: LandmarkData, _accent: number): Phaser.GameObjects.GameObject[] {
  const objs: Phaser.GameObjects.GameObject[] = [];
  const x = lm.x, y = lm.y, w = lm.width, h = lm.height;
  const cx = x + w / 2;
  const cy = y + h / 2;

  // Grass disc
  const g = scene.add.graphics();
  g.fillStyle(0x6daa6d, 0.85);
  g.fillEllipse(cx, cy, w * 0.95, h * 0.9);
  g.lineStyle(1.5, 0x3a703a, 0.4);
  g.strokeEllipse(cx, cy, w * 0.95, h * 0.9);

  // Curving path
  g.fillStyle(0xe9d8b8, 0.75);
  g.fillEllipse(cx, cy + 6, w * 0.55, 8);

  g.setDepth(44);
  objs.push(g);

  // Trees clustered around
  const nTrees = Math.max(5, Math.floor((w * h) / 8000));
  const rng = mulberry32((x * 1009 + y) >>> 0);
  for (let i = 0; i < nTrees; i++) {
    const t = i / nTrees;
    const angle = t * Math.PI * 2 + rng() * 0.5;
    const r = Math.min(w, h) * 0.35;
    const tx = cx + Math.cos(angle) * r * (0.8 + rng() * 0.3);
    const ty = cy + Math.sin(angle) * r * (0.6 + rng() * 0.3);
    objs.push(...tree(scene, tx, ty, 10 + rng() * 6));
  }
  // Two benches
  objs.push(...bench(scene, cx - w * 0.18, cy + 8));
  objs.push(...bench(scene, cx + w * 0.18, cy + 8));

  return objs;
}

function drawTransport(scene: Phaser.Scene, lm: LandmarkData, accent: number): Phaser.GameObjects.GameObject[] {
  const objs: Phaser.GameObjects.GameObject[] = [];
  const x = lm.x, y = lm.y, w = lm.width, h = lm.height;
  const isStation = /station|stop/i.test(lm.name);

  const g = scene.add.graphics();
  // Platform / pavement
  g.fillStyle(0xb8b3aa, 1);
  g.fillRect(x + 2, y + h * 0.55, w - 4, h * 0.45);
  // Platform stripe edge
  g.fillStyle(0xfeca48, 0.9);
  g.fillRect(x + 4, y + h * 0.55, w - 8, 3);

  // Train silhouette for "Station" labels
  if (isStation) {
    g.fillStyle(0x1f3a5f, 1);
    g.fillRoundedRect(x + 6, y + h * 0.18, w - 12, h * 0.35, 4);
    // Windows
    g.fillStyle(0xfff7d6, 0.85);
    const winCount = Math.max(3, Math.floor((w - 24) / 14));
    for (let i = 0; i < winCount; i++) {
      const wx = x + 12 + i * ((w - 24) / winCount);
      g.fillRect(wx, y + h * 0.25, 8, 6);
    }
    // Roof accent
    g.fillStyle(accent, 0.95);
    g.fillRect(x + 6, y + h * 0.16, w - 12, 4);
  } else {
    // Bus shelter: arched roof
    g.fillStyle(accent, 0.85);
    g.fillRoundedRect(x + 6, y + h * 0.2, w - 12, h * 0.32, { tl: 12, tr: 12, bl: 0, br: 0 });
    // Bench inside
    g.fillStyle(0x4a2f1a, 1);
    g.fillRect(x + 10, y + h * 0.5, w - 20, 3);
  }

  g.setDepth(46);
  objs.push(g);
  return objs;
}

function drawRoad(scene: Phaser.Scene, lm: LandmarkData, _accent: number): Phaser.GameObjects.GameObject[] {
  const objs: Phaser.GameObjects.GameObject[] = [];
  const x = lm.x, y = lm.y, w = lm.width, h = lm.height;
  const horizontal = w >= h;

  // ── Sidewalk band (light beige) sitting just outside the asphalt edges.
  // This is the single biggest reason the previous render felt "grey" —
  // there was no transition between road and ground.
  const SIDEWALK = 6;
  const sw = scene.add.graphics();
  sw.fillStyle(0xe9dfc6, 1);
  if (horizontal) {
    sw.fillRect(x - SIDEWALK, y - SIDEWALK, w + SIDEWALK * 2, h + SIDEWALK * 2);
  } else {
    sw.fillRect(x - SIDEWALK, y - SIDEWALK, w + SIDEWALK * 2, h + SIDEWALK * 2);
  }
  // Sidewalk seam ticks every ~24px for texture
  sw.lineStyle(0.8, 0xb8a983, 0.55);
  if (horizontal) {
    for (let dx = 18; dx < w; dx += 24) {
      sw.lineBetween(x + dx, y - SIDEWALK, x + dx, y);
      sw.lineBetween(x + dx, y + h, x + dx, y + h + SIDEWALK);
    }
  } else {
    for (let dy = 18; dy < h; dy += 24) {
      sw.lineBetween(x - SIDEWALK, y + dy, x, y + dy);
      sw.lineBetween(x + w, y + dy, x + w + SIDEWALK, y + dy);
    }
  }
  sw.setDepth(40);
  objs.push(sw);

  const g = scene.add.graphics();
  // Asphalt — a slightly cooler, more refined grey than the previous tan
  g.fillStyle(0x8a8579, 1);
  g.fillRect(x, y, w, h);
  // Subtle asphalt grain — fine speckles
  g.fillStyle(0x6f6a5f, 0.18);
  const speckleStep = 5;
  for (let dx = 0; dx < w; dx += speckleStep) {
    for (let dy = 0; dy < h; dy += speckleStep) {
      if (((dx * 37 + dy * 17) % 13) === 0) g.fillRect(x + dx, y + dy, 2, 2);
    }
  }
  // Curb shadow (thin darker line at the very edge of asphalt against sidewalk)
  g.lineStyle(1, 0x4b463c, 0.6);
  if (horizontal) {
    g.lineBetween(x, y, x + w, y);
    g.lineBetween(x, y + h, x + w, y + h);
  } else {
    g.lineBetween(x, y, x, y + h);
    g.lineBetween(x + w, y, x + w, y + h);
  }
  // Dashed center line
  g.lineStyle(2.2, 0xfff4cf, 0.92);
  if (horizontal) {
    const cy = y + h / 2;
    for (let dx = 6; dx < w - 6; dx += 22) {
      g.lineBetween(x + dx, cy, x + dx + 12, cy);
    }
    // Solid edge lines just inside the curb
    g.lineStyle(1.2, 0xfff4cf, 0.45);
    g.lineBetween(x + 2, y + 3, x + w - 2, y + 3);
    g.lineBetween(x + 2, y + h - 3, x + w - 2, y + h - 3);
    // Crosswalks (zebra) near both ends, sitting on the asphalt
    for (const cx of [x + 14, x + w - 26]) {
      for (let i = 0; i < 5; i++) {
        g.fillStyle(0xfffaee, 0.92);
        g.fillRect(cx + i * 3, y + 2, 2, h - 4);
      }
    }
  } else {
    const cx = x + w / 2;
    for (let dy = 6; dy < h - 6; dy += 22) {
      g.lineBetween(cx, y + dy, cx, y + dy + 12);
    }
    g.lineStyle(1.2, 0xfff4cf, 0.45);
    g.lineBetween(x + 3, y + 2, x + 3, y + h - 2);
    g.lineBetween(x + w - 3, y + 2, x + w - 3, y + h - 2);
    for (const cy of [y + 14, y + h - 26]) {
      for (let i = 0; i < 5; i++) {
        g.fillStyle(0xfffaee, 0.92);
        g.fillRect(x + 2, cy + i * 3, w - 4, 2);
      }
    }
  }
  g.setDepth(42);
  objs.push(g);
  return objs;
}

/* ── Tiny seeded RNG so trees don't reshuffle per frame ─────── */

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── Public dispatch ───────────────────────────────────────── */

export function drawLandmarkBuilding(
  scene: Phaser.Scene,
  lm: LandmarkData,
  townAccent: string,
  townId: TownId,
): Phaser.GameObjects.GameObject[] {
  const accent = hexToInt(townAccent, 0x888888);
  const theme = TOWN_ARCH[townId] ?? TOWN_ARCH.dover;
  switch (lm.type) {
    case "church":         return drawChurch(scene, lm, accent);
    case "building":
    case "commercial":
    case "commercial-strip": return drawCommercialBuilding(scene, lm, accent, theme);
    case "housing":        return drawHousing(scene, lm, accent, theme);
    case "park":           return drawPark(scene, lm, accent);
    case "transport":      return drawTransport(scene, lm, accent);
    case "road":           return drawRoad(scene, lm, accent);
    default:               return drawCommercialBuilding(scene, lm, accent, theme);
  }
}
