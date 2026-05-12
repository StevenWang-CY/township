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

// Brighter, more saturated canopy palette — the previous palette read as
// dark navy/teal blobs against the cream ground (especially Parsippany). All
// canopy colours pushed lighter and warmer so they unmistakably read as
// foliage even at small sizes.
const PALETTES: Record<TownId, {
  treeCanopyA: number; treeCanopyB: number; treeShadow: number;
  trunk: number; flowerA: number; flowerB: number; lampGlow: number;
  petalDrift: number;
}> = {
  dover: {
    treeCanopyA: 0xb6d878, treeCanopyB: 0x8db84e, treeShadow: 0x6a8e3a,
    trunk: 0x6e5436, flowerA: 0xe06b3a, flowerB: 0xffc77a, lampGlow: 0xffd58a,
    petalDrift: 0xd47c4a,
  },
  montclair: {
    treeCanopyA: 0xb8d088, treeCanopyB: 0x8db065, treeShadow: 0x668248,
    trunk: 0x66523e, flowerA: 0xc89bd4, flowerB: 0xf3d8e6, lampGlow: 0xfff0c0,
    petalDrift: 0xe6a875,
  },
  parsippany: {
    treeCanopyA: 0xbed98e, treeCanopyB: 0x90b56d, treeShadow: 0x6b884e,
    trunk: 0x6b513a, flowerA: 0xe6b85a, flowerB: 0xffe3a0, lampGlow: 0xffd58a,
    petalDrift: 0xc4dba8,
  },
  randolph: {
    treeCanopyA: 0xbcd293, treeCanopyB: 0x8eaa6a, treeShadow: 0x687f48,
    trunk: 0x6e5440, flowerA: 0xe2a464, flowerB: 0xffdca8, lampGlow: 0xffd9a8,
    petalDrift: 0xd8c098,
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

  // 1. Scattered trees with shadow + subtle sway. Previous pass used 56
  //    trees + no inter-tree spacing rule, which clumped 5-6 canopies on top
  //    of each other into dark navy blobs that read like rectangles. Now:
  //    - reduced to 22 trees, larger canopy reads as one tree per spot.
  //    - inter-tree spacing of 56px enforced.
  //    - explicit road-avoidance buffer (roads were not in the avoid list).
  const treeAvoid = collectAvoidRects(landmarks);
  const placedTrees: Array<{ x: number; y: number }> = [];
  const treeTarget = 22;
  let treeAttempts = 0;
  while (placedTrees.length < treeTarget && treeAttempts < treeTarget * 24) {
    treeAttempts++;
    const x = rng() * (W - 80) + 40;
    const y = rng() * (H - 100) + 50;
    if (intersectsAny(x, y, 24, 30, treeAvoid)) continue;
    let tooClose = false;
    for (const p of placedTrees) {
      if (Math.hypot(p.x - x, p.y - y) < 56) { tooClose = true; break; }
    }
    if (tooClose) continue;
    placedTrees.push({ x, y });

    const small = rng() < 0.4;
    const tree = drawTree(scene, x, y, pal, small);
    objects.push(...tree.objs);
    const sway = scene.tweens.add({
      targets: tree.canopy,
      rotation: { from: -0.03, to: 0.03 },
      duration: 2400 + rng() * 800,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
      delay: rng() * 1400,
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
  //    brighter at night via setHour(). Wider spacing (220 px not 120) so the
  //    road doesn't look like a runway; staggered between sides so the eye
  //    sees one lamp at a time, not paired walls of light.
  const lampSpots: { x: number; y: number }[] = [];
  for (const lm of landmarks) {
    if (lm.type === "road") {
      const horiz = lm.width >= lm.height;
      const step = 220;
      if (horiz) {
        for (let dx = step / 2; dx < lm.width; dx += step) {
          lampSpots.push({ x: lm.x + dx, y: lm.y - 14 });
        }
        for (let dx = step; dx < lm.width; dx += step) {
          lampSpots.push({ x: lm.x + dx, y: lm.y + lm.height + 14 });
        }
      } else {
        for (let dy = step / 2; dy < lm.height; dy += step) {
          lampSpots.push({ x: lm.x - 14, y: lm.y + dy });
        }
        for (let dy = step; dy < lm.height; dy += step) {
          lampSpots.push({ x: lm.x + lm.width + 14, y: lm.y + dy });
        }
      }
    }
  }
  for (const sp of lampSpots) {
    const lamp = drawLamppost(scene, sp.x, sp.y, pal);
    objects.push(...lamp.objs);
    lampGlows.push(lamp.glow);
    // Always-on micro-flicker via scale (NOT alpha) so the setHour() alpha
    // tween isn't constantly fighting an alpha-jitter tween.
    const flicker = scene.tweens.add({
      targets: lamp.glow,
      scaleX: { from: 0.96, to: 1.04 },
      scaleY: { from: 0.96, to: 1.04 },
      duration: 1300 + rng() * 800,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
      delay: rng() * 900,
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
      // Lower daytime alpha — additive blend mode + yellow glow over cream
      // made the bulbs read as "weird bright circles" by day in the bug report.
      const night = hour < 6 || hour >= 19;
      const dusk = (hour >= 17 && hour < 19) || (hour >= 5 && hour < 7);
      const targetAlpha = night ? 0.78 : dusk ? 0.42 : 0.10;
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
  // Start dim — the setHour() driver above immediately bumps this to the
  // hour-correct value, but we don't want a daytime flash on first frame.
  glow.setAlpha(0.10);
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
    // Parks: skip — trees look nice INSIDE parks.
    if (lm.type === "park") continue;
    // Roads need a larger buffer so trees don't sit on the asphalt or
    // straddle the sidewalk. 18 px padding clears the road + sidewalk.
    const pad = lm.type === "road" ? 18 : 6;
    out.push({ x: lm.x - pad, y: lm.y - pad, w: lm.width + pad * 2, h: lm.height + pad * 2 });
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
