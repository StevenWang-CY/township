/**
 * SceneAmbience — delicate, animation-quality environment composition that
 * matches the Smallville chibi style.
 *
 * Style rules (to keep visual consistency with the agent sprites):
 *  - Soft pastel palette, mild saturation.
 *  - 1px dark outlines used sparingly (only on tree trunks + lamppost posts).
 *  - 2 shadow levels per element max.
 *  - All "living" details animate: trees sway, flowers bob, water ripples,
 *    smoke wisps rise, sparkles drift.
 *
 * Public surface:
 *   composeTownAmbience(scene, town, landmarks, W, H)
 *     - Adds trees, flowers, lampposts, smoke, water FX, windmill
 *     - Each created GameObject is owned by the scene (no manual cleanup).
 */
import Phaser from "phaser";
import type { LandmarkData, TownId } from "../types/messages";

// ── Style palette (Smallville-chibi-matched) ───────────────────────────

const PALETTES: Record<TownId, {
  treeCanopyA: number; treeCanopyB: number; treeShadow: number;
  trunk: number; flowerA: number; flowerB: number; lampGlow: number;
  petalDrift: number;
}> = {
  dover: {
    treeCanopyA: 0x8fb35c, treeCanopyB: 0x6f9447, treeShadow: 0x4b6c32,
    trunk: 0x5a4633, flowerA: 0xe06b3a, flowerB: 0xffb86b, lampGlow: 0xffd58a,
    petalDrift: 0xd47c4a,
  },
  montclair: {
    treeCanopyA: 0x88a8b8, treeCanopyB: 0x6b8a9a, treeShadow: 0x445a68,
    trunk: 0x614a3c, flowerA: 0xb88ac8, flowerB: 0xeacbdc, lampGlow: 0xfff0c0,
    petalDrift: 0xe6a875,
  },
  parsippany: {
    treeCanopyA: 0x95b8a0, treeCanopyB: 0x6c9078, treeShadow: 0x466253,
    trunk: 0x584536, flowerA: 0xe6b85a, flowerB: 0xffe3a0, lampGlow: 0xffd58a,
    petalDrift: 0xb8d4c0,
  },
  randolph: {
    treeCanopyA: 0x9cb487, treeCanopyB: 0x728c5c, treeShadow: 0x4d6240,
    trunk: 0x5e4a36, flowerA: 0xd49b59, flowerB: 0xfdd9a0, lampGlow: 0xffd9a8,
    petalDrift: 0xc8b094,
  },
};

// ── Public API ─────────────────────────────────────────────────────────

export interface AmbienceHandle {
  /** Call from TownScene.update() to drive shimmer & flicker tied to hour. */
  setHour(hour: number): void;
  /** Smoothly switch ambient density on focus / blur if needed. */
  destroy(): void;
}

export function composeTownAmbience(
  scene: Phaser.Scene,
  town: TownId,
  landmarks: LandmarkData[],
  W: number,
  H: number,
): AmbienceHandle {
  const pal = PALETTES[town];
  const rng = mulberry32(0xa11ce ^ town.length * 211);
  const objects: Phaser.GameObjects.GameObject[] = [];
  const tweens: Phaser.Tweens.Tween[] = [];
  const lampGlows: Phaser.GameObjects.Graphics[] = [];

  // 1. Scattered trees with shadow + subtle sway (50-80 trees per town).
  const treeAvoid = collectAvoidRects(landmarks);
  const treeCount = 56;
  for (let i = 0; i < treeCount; i++) {
    let x = 0, y = 0;
    for (let attempt = 0; attempt < 12; attempt++) {
      x = rng() * (W - 40) + 20;
      y = rng() * (H - 60) + 30;
      if (!intersectsAny(x, y, 20, 26, treeAvoid)) break;
    }
    const small = rng() < 0.45;
    const tree = drawTree(scene, x, y, pal, small);
    objects.push(...tree.objs);
    // Subtle sway: rotate canopy ±0.04 rad over ~2.6s, staggered.
    const canopy = tree.canopy;
    const sway = scene.tweens.add({
      targets: canopy,
      rotation: { from: -0.035, to: 0.035 },
      duration: 2200 + rng() * 800,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
      delay: rng() * 1200,
    });
    tweens.push(sway);
  }

  // 2. Flower clusters with gentle bob — placed near parks and along sidewalks.
  for (let i = 0; i < 32; i++) {
    const x = rng() * (W - 40) + 20;
    const y = rng() * (H - 60) + 30;
    if (intersectsAny(x, y, 14, 14, treeAvoid)) continue;
    const cluster = drawFlowerCluster(scene, x, y, pal, rng);
    objects.push(...cluster.objs);
    const bob = scene.tweens.add({
      targets: cluster.group,
      y: y - 1.5,
      duration: 1400 + rng() * 600,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
      delay: rng() * 1400,
    });
    tweens.push(bob);
  }

  // 3. Lampposts at road edges + commercial perimeters — always-on warm glow,
  //    brighter at night via setHour().
  const lampSpots: { x: number; y: number }[] = [];
  for (const lm of landmarks) {
    if (lm.type === "road") {
      const horiz = lm.width >= lm.height;
      const step = horiz ? Math.max(120, lm.width / 5) : Math.max(120, lm.height / 5);
      if (horiz) {
        for (let dx = step / 2; dx < lm.width; dx += step) {
          lampSpots.push({ x: lm.x + dx, y: lm.y - 14 });
          lampSpots.push({ x: lm.x + dx, y: lm.y + lm.height + 14 });
        }
      } else {
        for (let dy = step / 2; dy < lm.height; dy += step) {
          lampSpots.push({ x: lm.x - 14, y: lm.y + dy });
          lampSpots.push({ x: lm.x + lm.width + 14, y: lm.y + dy });
        }
      }
    }
  }
  for (const sp of lampSpots) {
    const lamp = drawLamppost(scene, sp.x, sp.y, pal);
    objects.push(...lamp.objs);
    lampGlows.push(lamp.glow);
    // Always-on tiny flicker — random alpha jitter at low magnitude.
    const flicker = scene.tweens.add({
      targets: lamp.glow,
      alpha: { from: 0.20, to: 0.30 },
      duration: 1200 + rng() * 800,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
      delay: rng() * 800,
    });
    tweens.push(flicker);
  }

  // 4. Smoke wisps rising from a few rooftops — drift upward, fade out, loop.
  const chimneySpots: { x: number; y: number }[] = [];
  for (const lm of landmarks) {
    if (lm.type === "housing" || lm.type === "church" || lm.type === "building") {
      // pick a random rooftop position inside the landmark
      chimneySpots.push({ x: lm.x + lm.width * (0.3 + rng() * 0.4), y: lm.y + 6 });
    }
  }
  for (const cs of chimneySpots.slice(0, 8)) {
    objects.push(...spawnSmokeStream(scene, cs.x, cs.y, rng));
  }

  // 5. Water at Lake Parsippany / similar — animated bubble overlay using the
  //    waterfall sprite's bottom-half "foam" frames.
  for (const lm of landmarks) {
    const isWater = lm.name.toLowerCase().includes("lake") || lm.type === "water";
    if (!isWater) continue;
    if (scene.textures.exists("water-foam")) {
      const cx = lm.x + lm.width / 2;
      const cy = lm.y + lm.height / 2;
      for (let i = 0; i < 3; i++) {
        const tile = scene.add.sprite(cx - 30 + i * 30, cy + i * 6, "water-foam", 0);
        tile.setScale(1.6);
        tile.setAlpha(0.55);
        tile.setDepth(38);
        objects.push(tile);
        const drift = scene.tweens.add({
          targets: tile,
          x: tile.x + 18,
          duration: 4000 + rng() * 1200,
          yoyo: true,
          repeat: -1,
          ease: "Sine.easeInOut",
          delay: i * 600,
        });
        tweens.push(drift);
      }
    }
    // Expanding ripple rings (occasional)
    scene.time.addEvent({
      delay: 2200, loop: true,
      callback: () => {
        const rx = lm.x + 20 + rng() * (lm.width - 40);
        const ry = lm.y + 20 + rng() * (lm.height - 40);
        const ring = scene.add.graphics();
        ring.lineStyle(1.2, 0xffffff, 0.6);
        ring.strokeCircle(rx, ry, 4);
        ring.setDepth(39);
        scene.tweens.add({
          targets: ring,
          alpha: 0,
          scale: 2.4,
          duration: 1400,
          ease: "Quad.easeOut",
          onComplete: () => ring.destroy(),
        });
      },
    });
  }

  // 6. Windmill (animated 8-frame loop) at appropriate park / open space.
  if (scene.textures.exists("windmill") && scene.anims.exists("windmill-spin")) {
    // Place at the largest park or sports-field landmark, if any.
    const park = landmarks.find((l) => l.type === "park") || landmarks[0];
    if (park) {
      const wx = park.x + park.width * 0.85;
      const wy = park.y + park.height * 0.25;
      const mill = scene.add.sprite(wx, wy, "windmill", 0);
      mill.setScale(0.42);  // 624px frames → 262px scaled
      mill.setOrigin(0.5, 1);
      mill.setDepth(45);
      mill.setAlpha(0.92);
      mill.play("windmill-spin");
      objects.push(mill);
    }
  }

  // 7. Atmospheric particle drift layer — per-town tint, very subtle,
  //    falling slowly across the canvas. Cherry petals / autumn leaves / pollen.
  const driftEmitter = scene.add.graphics();
  driftEmitter.fillStyle(pal.petalDrift, 1);
  driftEmitter.fillCircle(0, 0, 1.4);
  driftEmitter.generateTexture(`petal-${town}`, 4, 4);
  driftEmitter.destroy();
  for (let i = 0; i < 22; i++) {
    const px = rng() * W;
    const py = rng() * H;
    const petal = scene.add.image(px, py, `petal-${town}`);
    petal.setAlpha(0.4 + rng() * 0.25);
    petal.setDepth(180);
    objects.push(petal);
    const drift = scene.tweens.add({
      targets: petal,
      x: petal.x + (rng() - 0.5) * 60,
      y: petal.y + 240,
      duration: 12000 + rng() * 8000,
      ease: "Sine.easeInOut",
      repeat: -1,
      delay: rng() * 5000,
      onRepeat: () => {
        petal.x = rng() * W;
        petal.y = -10;
      },
    });
    tweens.push(drift);
  }

  // ── Handle ───────────────────────────────────────────────────────────
  let lastHour = -1;
  return {
    setHour(hour: number) {
      if (hour === lastHour) return;
      lastHour = hour;
      const night = hour < 6 || hour >= 19;
      const dusk = (hour >= 17 && hour < 19) || (hour >= 5 && hour < 7);
      const targetAlpha = night ? 0.85 : dusk ? 0.55 : 0.22;
      for (const g of lampGlows) {
        scene.tweens.add({
          targets: g, alpha: targetAlpha, duration: 600, ease: "Sine.easeInOut",
        });
      }
    },
    destroy() {
      for (const t of tweens) t.stop();
      for (const o of objects) o.destroy();
    },
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

function drawTree(
  scene: Phaser.Scene, x: number, y: number,
  pal: ReturnType<() => typeof PALETTES[TownId]>,
  small: boolean,
): { objs: Phaser.GameObjects.GameObject[]; canopy: Phaser.GameObjects.Graphics } {
  const objs: Phaser.GameObjects.GameObject[] = [];
  const scale = small ? 0.78 : 1;

  // Ground shadow (chibi-style flat ellipse)
  const shadow = scene.add.graphics();
  shadow.fillStyle(0x000000, 0.16);
  shadow.fillEllipse(x, y + 2, 22 * scale, 6 * scale);
  shadow.setDepth(5);
  objs.push(shadow);

  // Trunk (small dark rect with rounded top)
  const trunk = scene.add.graphics();
  trunk.fillStyle(pal.trunk, 1);
  trunk.fillRoundedRect(x - 2 * scale, y - 4 * scale, 4 * scale, 6 * scale, 1);
  trunk.setDepth(6);
  objs.push(trunk);

  // Canopy — 2-layer ellipses with shadow underlay + bright top accent.
  // Drawn as its OWN graphics so we can sway-rotate just the canopy.
  const canopy = scene.add.graphics();
  // Shadow underlay
  canopy.fillStyle(pal.treeShadow, 1);
  canopy.fillEllipse(0, -14 * scale, 22 * scale, 18 * scale);
  // Main canopy
  canopy.fillStyle(pal.treeCanopyB, 1);
  canopy.fillEllipse(0, -16 * scale, 20 * scale, 16 * scale);
  // Top highlight
  canopy.fillStyle(pal.treeCanopyA, 1);
  canopy.fillEllipse(-2 * scale, -19 * scale, 12 * scale, 10 * scale);
  // Bright dot highlight
  canopy.fillStyle(0xffffff, 0.16);
  canopy.fillCircle(-4 * scale, -22 * scale, 3 * scale);
  canopy.setPosition(x, y);
  canopy.setDepth(8);
  objs.push(canopy);

  return { objs, canopy };
}

function drawFlowerCluster(
  scene: Phaser.Scene, x: number, y: number,
  pal: ReturnType<() => typeof PALETTES[TownId]>,
  rng: () => number,
): { objs: Phaser.GameObjects.GameObject[]; group: Phaser.GameObjects.Container } {
  const g = scene.add.container(x, y);
  // 4-6 little flower heads, alternating two colors.
  const count = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < count; i++) {
    const fx = (rng() - 0.5) * 14;
    const fy = (rng() - 0.5) * 8;
    const color = i % 2 === 0 ? pal.flowerA : pal.flowerB;
    // Stem
    const stem = scene.add.graphics();
    stem.fillStyle(0x4d7042, 0.9);
    stem.fillRect(fx - 0.4, fy, 0.8, 3);
    g.add(stem);
    // Petal
    const petal = scene.add.graphics();
    petal.fillStyle(color, 1);
    petal.fillCircle(fx, fy - 1, 1.6);
    petal.fillStyle(0xfff7e0, 0.7);
    petal.fillCircle(fx, fy - 1, 0.6);
    g.add(petal);
  }
  g.setDepth(6);
  return { objs: [g], group: g };
}

function drawLamppost(
  scene: Phaser.Scene, x: number, y: number,
  pal: ReturnType<() => typeof PALETTES[TownId]>,
): { objs: Phaser.GameObjects.GameObject[]; glow: Phaser.GameObjects.Graphics } {
  const objs: Phaser.GameObjects.GameObject[] = [];

  // Ground shadow
  const sh = scene.add.graphics();
  sh.fillStyle(0x000000, 0.18);
  sh.fillEllipse(x, y + 1, 8, 3);
  sh.setDepth(5);
  objs.push(sh);

  // Post (1px dark outline, then dark fill)
  const post = scene.add.graphics();
  post.fillStyle(0x2c2620, 1);
  post.fillRect(x - 1.2, y - 24, 2.4, 24);
  // Cross-arm cap
  post.fillStyle(0x2c2620, 1);
  post.fillRect(x - 4, y - 27, 8, 3);
  // Lamp head (warm)
  post.fillStyle(pal.lampGlow, 1);
  post.fillRoundedRect(x - 3, y - 30, 6, 4, 1);
  post.setDepth(20);
  objs.push(post);

  // Halo glow — separate Graphics so we can tween alpha freely.
  const glow = scene.add.graphics();
  glow.fillStyle(pal.lampGlow, 1);
  glow.fillCircle(x, y - 28, 18);
  glow.fillStyle(pal.lampGlow, 1);
  glow.fillCircle(x, y - 28, 26);
  glow.setAlpha(0.22);
  glow.setBlendMode(Phaser.BlendModes.ADD);
  glow.setDepth(19);
  objs.push(glow);

  return { objs, glow };
}

function spawnSmokeStream(
  scene: Phaser.Scene, x: number, y: number, rng: () => number,
): Phaser.GameObjects.GameObject[] {
  const objs: Phaser.GameObjects.GameObject[] = [];
  // Continuous puff stream via timed event.
  scene.time.addEvent({
    delay: 1100 + rng() * 700,
    loop: true,
    callback: () => {
      const puff = scene.add.graphics();
      puff.fillStyle(0xe6e3da, 0.55);
      puff.fillCircle(0, 0, 3);
      puff.setPosition(x + (rng() - 0.5) * 3, y);
      puff.setDepth(35);
      scene.tweens.add({
        targets: puff,
        y: puff.y - 28 - rng() * 16,
        x: puff.x + (rng() - 0.5) * 12,
        scaleX: 2.4,
        scaleY: 2.4,
        alpha: 0,
        duration: 2400 + rng() * 800,
        ease: "Sine.easeOut",
        onComplete: () => puff.destroy(),
      });
    },
  });
  return objs;
}

// ── Geometry utilities ─────────────────────────────────────────────────

interface Rect { x: number; y: number; w: number; h: number }

function collectAvoidRects(landmarks: LandmarkData[]): Rect[] {
  const out: Rect[] = [];
  for (const lm of landmarks) {
    // Avoid placing trees on buildings/roads (parks are fine — they look nice with trees).
    if (lm.type === "park") continue;
    out.push({ x: lm.x - 4, y: lm.y - 4, w: lm.width + 8, h: lm.height + 8 });
  }
  return out;
}

function intersectsAny(x: number, y: number, w: number, h: number, rects: Rect[]): boolean {
  for (const r of rects) {
    if (x + w > r.x && x < r.x + r.w && y + h > r.y && y < r.y + r.h) return true;
  }
  return false;
}

function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
