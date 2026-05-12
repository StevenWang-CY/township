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

function drawCommercialBuilding(scene: Phaser.Scene, lm: LandmarkData, accent: number): Phaser.GameObjects.GameObject[] {
  const objs: Phaser.GameObjects.GameObject[] = [];
  const x = lm.x, y = lm.y, w = lm.width, h = lm.height;
  const bodyColor = hexToInt(lm.color, 0xc9a785);

  const g = scene.add.graphics();
  g.fillStyle(0x000000, 0.12);
  g.fillEllipse(x + w / 2, y + h - 2, w * 1.05, 12);

  // Body
  g.fillStyle(bodyColor, 1);
  g.fillRect(x + 4, y + 12, w - 8, h - 16);
  // Flat roof
  g.fillStyle(0x000000, 0.18);
  g.fillRect(x + 2, y + 8, w - 4, 6);

  // Awning (in town accent)
  g.fillStyle(accent, 0.9);
  const awningH = 8;
  g.fillRect(x + 6, y + 14, w - 12, awningH);
  // Striped accent on awning
  g.lineStyle(1, 0xffffff, 0.45);
  for (let i = 1; i < (w - 12) / 8; i++) {
    g.lineBetween(x + 6 + i * 8, y + 14, x + 6 + i * 8, y + 14 + awningH);
  }

  // Sign rail
  g.fillStyle(0xffffff, 0.92);
  const sw = Math.min(w - 16, 84);
  g.fillRoundedRect(x + w / 2 - sw / 2, y + 24, sw, 12, 2);
  g.lineStyle(1, 0x000000, 0.18);
  g.strokeRoundedRect(x + w / 2 - sw / 2, y + 24, sw, 12, 2);

  g.setDepth(46);
  objs.push(g);

  // Sign text
  const sign = scene.add.text(x + w / 2, y + 30, lm.name.slice(0, 14), {
    fontFamily: "Inter, sans-serif",
    fontSize: "8px",
    fontStyle: "bold",
    color: "#332617",
    resolution: 2,
  });
  sign.setOrigin(0.5, 0.5);
  sign.setDepth(47);
  objs.push(sign);

  // Three windows
  for (let i = 0; i < 3; i++) {
    const wx = x + 10 + i * ((w - 20) / 2);
    const wy = y + h * 0.55;
    objs.push(windowGlow(scene, wx, wy, 9, 11));
  }

  // Door
  const door = scene.add.graphics();
  door.fillStyle(0x4a2f1a, 1);
  door.fillRoundedRect(x + w / 2 - 6, y + h - 16, 12, 16, { tl: 1, tr: 1, bl: 0, br: 0 });
  door.setDepth(47);
  objs.push(door);

  return objs;
}

function drawHousing(scene: Phaser.Scene, lm: LandmarkData, accent: number): Phaser.GameObjects.GameObject[] {
  const objs: Phaser.GameObjects.GameObject[] = [];
  const x = lm.x, y = lm.y, w = lm.width, h = lm.height;
  const homes = 3;
  const homeW = w / homes;

  for (let i = 0; i < homes; i++) {
    const hx = x + i * homeW;
    const wallColor = i % 2 === 0 ? 0xeadcc1 : 0xddc4a4;

    const g = scene.add.graphics();
    g.fillStyle(0x000000, 0.12);
    g.fillEllipse(hx + homeW / 2, y + h - 2, homeW * 1.05, 9);

    // Body
    g.fillStyle(wallColor, 1);
    g.fillRect(hx + 4, y + h * 0.4, homeW - 8, h * 0.6);
    // Triangular roof
    g.fillStyle(0x7c4f2c, 1);
    g.fillTriangle(hx + 2, y + h * 0.4, hx + homeW - 2, y + h * 0.4, hx + homeW / 2, y + h * 0.05);

    // Door
    g.fillStyle(accent, 0.85);
    g.fillRect(hx + homeW / 2 - 3, y + h - 12, 6, 12);
    // Window
    g.fillStyle(0xffe9a8, 0.6);
    g.fillRect(hx + 10, y + h * 0.6, 6, 6);
    g.fillRect(hx + homeW - 16, y + h * 0.6, 6, 6);
    g.lineStyle(0.6, 0x000000, 0.2);
    g.strokeRect(hx + 10, y + h * 0.6, 6, 6);
    g.strokeRect(hx + homeW - 16, y + h * 0.6, 6, 6);

    g.setDepth(46);
    objs.push(g);
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

/* ── Streetlamp helper (used by TownScene addStreetlamps) ──── */

export interface StreetlampHandle {
  group: Phaser.GameObjects.Container;
  /** Yellow glow shown only at night. */
  glow: Phaser.GameObjects.Graphics;
  /** Set the visible alpha of the glow (call from clock tick). */
  setNight: (isNight: boolean) => void;
  /** Random per-frame flicker — call from scene update. */
  flicker: () => void;
}

export function drawStreetlamp(scene: Phaser.Scene, x: number, y: number): StreetlampHandle {
  const group = scene.add.container(x, y);

  // Drop shadow
  const shadow = scene.add.graphics();
  shadow.fillStyle(0x000000, 0.18);
  shadow.fillEllipse(0, 3, 12, 4);

  // Lamp post
  const post = scene.add.graphics();
  post.fillStyle(0x4a4a4a, 1);
  post.fillRect(-1, -22, 2, 22);
  post.fillStyle(0x6a6a6a, 1);
  post.fillRect(-1.5, -23, 3, 3);

  // Fixture
  const fix = scene.add.graphics();
  fix.fillStyle(0x222222, 1);
  fix.fillRoundedRect(-4, -28, 8, 5, 1);

  // Night-time glow — invisible by default
  const glow = scene.add.graphics();
  glow.fillStyle(0xffd680, 0.55);
  glow.fillCircle(0, -25, 14);
  glow.fillStyle(0xfff0b0, 0.35);
  glow.fillCircle(0, -25, 22);
  glow.setAlpha(0);

  group.add([shadow, post, fix, glow]);
  group.setDepth(60 + y);

  const setNight = (isNight: boolean) => {
    scene.tweens.add({
      targets: glow,
      alpha: isNight ? 1 : 0,
      duration: 800,
      ease: "Sine.easeInOut",
    });
  };
  const flicker = () => {
    if (glow.alpha < 0.05) return;
    // 0.5% chance per call to trigger a quick flicker
    if (Math.random() < 0.005) {
      const orig = glow.alpha;
      glow.setAlpha(orig * 0.5);
      scene.time.delayedCall(60, () => glow.setAlpha(orig));
    }
  };

  return { group, glow, setNight, flicker };
}

/* ── Public dispatch ───────────────────────────────────────── */

export function drawLandmarkBuilding(
  scene: Phaser.Scene,
  lm: LandmarkData,
  townAccent: string,
  _townId: TownId,
): Phaser.GameObjects.GameObject[] {
  const accent = hexToInt(townAccent, 0x888888);
  switch (lm.type) {
    case "church":         return drawChurch(scene, lm, accent);
    case "building":
    case "commercial":
    case "commercial-strip": return drawCommercialBuilding(scene, lm, accent);
    case "housing":        return drawHousing(scene, lm, accent);
    case "park":           return drawPark(scene, lm, accent);
    case "transport":      return drawTransport(scene, lm, accent);
    case "road":           return drawRoad(scene, lm, accent);
    default:               return drawCommercialBuilding(scene, lm, accent);
  }
}
