/**
 * SceneAmbience — brings the generated tilemap to life.
 *
 * The map generator (scripts/mapgen) emits an "anchors" object layer of point
 * objects; each anchor's `kind` property names a living detail the scene
 * should animate at that spot:
 *
 *   tree       → tileset tree stamp, breathing sway (scale, never rotation)
 *   lamp       → tileset lamppost stamp + additive glow that brightens at night
 *   flower     → white flower-patch stamp + occasional drifting petal
 *   smoke      → chimney puff stream rising from a rooftop
 *   water-foam → foam shimmer + expanding ripple rings on water
 *   windmill   → the animated windmill spritesheet
 *   label      → ignored here (the DOM overlay owns landmark names)
 *
 * Anchor x/y is the sprite's bottom-center (the generator's contract), so all
 * stamp sprites use origin (0.5, 1) and slot into the same y-sorted depth
 * band as the agents (depth = 100 + feetY).
 *
 * Style rules: soft pastel palette, no rotation on foliage, additive light
 * only at lamp heads, every "living" detail animates gently.
 */
import Phaser from "phaser";
import type { TownId } from "../types/messages";

// ── Anchor model (parsed from the map's "anchors" object layer) ────────

export interface MapAnchor {
  kind: string;
  x: number;
  y: number;
  /** Registry stamp name for trees (e.g. "tree_light", "tree_fruit_a"). */
  stamp?: string;
}

// ── Tile stamps (mirror of scripts/mapgen/tiles.py definitions) ────────
//
// Each stamp is a contiguous rect of 16px tiles in rpg-tileset.png
// (100 columns). row/col are 0-based tile coordinates, w/h in tiles.

interface StampDef { row: number; col: number; w: number; h: number }

const STAMP_DEFS: Record<string, StampDef> = {
  tree_light:       { row: 49, col: 2,  w: 6, h: 7 },
  tree_dark:        { row: 49, col: 8,  w: 6, h: 7 },
  tree_small:       { row: 48, col: 0,  w: 2, h: 4 },
  tree_round_small: { row: 52, col: 0,  w: 2, h: 2 },
  tree_fruit_a:     { row: 77, col: 33, w: 4, h: 4 },
  tree_fruit_b:     { row: 77, col: 37, w: 4, h: 5 },
  tree_fruit_c:     { row: 77, col: 41, w: 4, h: 5 },
  lamppost:         { row: 39, col: 64, w: 2, h: 5 },
  flower_patch:     { row: 52, col: 24, w: 2, h: 2 },
};

const TILE = 16;

/**
 * Create (once) a texture for a named stamp by blitting its tile block out
 * of the loaded rpg-tileset image. Returns the texture key, or null if the
 * tileset isn't available.
 */
function ensureStampTexture(scene: Phaser.Scene, name: string): string | null {
  const def = STAMP_DEFS[name];
  if (!def) return null;
  const key = `stamp-${name}`;
  if (scene.textures.exists(key)) return key;
  if (!scene.textures.exists("rpg-tileset")) return null;
  const src = scene.textures.get("rpg-tileset").getSourceImage();
  const canvas = scene.textures.createCanvas(key, def.w * TILE, def.h * TILE);
  if (!canvas) return null;
  const ctx = canvas.getContext();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    src as HTMLImageElement,
    def.col * TILE, def.row * TILE, def.w * TILE, def.h * TILE,
    0, 0, def.w * TILE, def.h * TILE,
  );
  canvas.refresh();
  return key;
}

// ── Depth scheme (must match TownScene) ────────────────────────────────
// ground 0-2, buildings-base 3, agents 100+y, buildings-top 5000,
// petals 5400, smoke 5600, sky tint 6000, lamp glow 6001.

/** Depth for a bottom-anchored prop so agents y-sort against its base. */
function propDepth(anchorY: number): number {
  // Agent depth is 100 + centerY; agent feet sit ~14px below center, so a
  // prop whose base is at anchorY ties with an agent whose feet are there.
  return 100 + anchorY - 14;
}

// ── Per-town accent palette (lamp glow + petal drift tints) ────────────

const PALETTES: Record<TownId, { lampGlow: number; petalDrift: number }> = {
  dover:      { lampGlow: 0xffd58a, petalDrift: 0xd47c4a },
  montclair:  { lampGlow: 0xfff0c0, petalDrift: 0xe6a875 },
  parsippany: { lampGlow: 0xffd58a, petalDrift: 0xc4dba8 },
  randolph:   { lampGlow: 0xffd9a8, petalDrift: 0xd8c098 },
};

// Non-NJ-11 towns get a restrained warm default.
const DEFAULT_PALETTE = { lampGlow: 0xffe2b0, petalDrift: 0xd8c9a8 };

// ── Public API ─────────────────────────────────────────────────────────

export interface AmbienceHandle {
  /** Drive lamp glow intensity from the world clock. */
  setHour(hour: number): void;
  destroy(): void;
}

export function composeTownAmbience(
  scene: Phaser.Scene,
  scenarioId: string,
  town: TownId,
  anchors: MapAnchor[],
  W: number,
  H: number,
): AmbienceHandle {
  // Town ids are package-local. Only apply the NJ-authored accent adapter
  // inside its owning scenario so a custom package can safely reuse "dover"
  // (or any other id) and receive the neutral presentation.
  const pal = scenarioId === "nj11-2026"
    ? PALETTES[town] ?? DEFAULT_PALETTE
    : DEFAULT_PALETTE;
  const rng = mulberry32(0xa11ce ^ (town.length * 211));
  const objects: Phaser.GameObjects.GameObject[] = [];
  const tweens: Phaser.Tweens.Tween[] = [];
  const timers: Phaser.Time.TimerEvent[] = [];
  const lampGlows: Phaser.GameObjects.Graphics[] = [];

  for (const a of anchors) {
    switch (a.kind) {
      case "tree": {
        const key = ensureStampTexture(scene, a.stamp && STAMP_DEFS[a.stamp] ? a.stamp : "tree_light");
        if (!key) break;
        const tree = scene.add.image(a.x, a.y, key).setOrigin(0.5, 1).setDepth(propDepth(a.y));
        objects.push(tree);
        // Breathing sway — scale only (±1.5%), never rotation.
        tweens.push(scene.tweens.add({
          targets: tree,
          scaleX: { from: 0.985, to: 1.015 },
          scaleY: { from: 1.012, to: 0.99 },
          duration: 2600 + rng() * 1400,
          yoyo: true,
          repeat: -1,
          ease: "Sine.easeInOut",
          delay: rng() * 2200,
        }));
        break;
      }

      case "lamp": {
        const key = ensureStampTexture(scene, "lamppost");
        if (key) {
          const post = scene.add.image(a.x, a.y, key).setOrigin(0.5, 1).setDepth(propDepth(a.y));
          objects.push(post);
        }
        // Additive light at the lantern head (lamppost is 2x5 tiles tall).
        // Keep the spill tight and translucent: maps deliberately cluster a
        // few lamps around plazas, where broad opaque discs quickly bleach
        // the tile art. Drawing around a local origin also makes the subtle
        // scale flicker stay pinned to the bulb instead of orbiting (0, 0).
        const glow = scene.add.graphics().setPosition(a.x, a.y - 62);
        glow.fillStyle(pal.lampGlow, 0.12);
        glow.fillCircle(0, 0, 14);
        glow.fillStyle(pal.lampGlow, 0.22);
        glow.fillCircle(0, 0, 8);
        glow.fillStyle(pal.lampGlow, 0.5);
        glow.fillCircle(0, 0, 3);
        glow.setAlpha(0.025);
        glow.setBlendMode(Phaser.BlendModes.ADD);
        // Above the sky tint so lamps visibly pierce the night.
        glow.setDepth(6001);
        objects.push(glow);
        lampGlows.push(glow);
        // Always-on micro-flicker via scale (NOT alpha) so the setHour()
        // alpha tween isn't fighting an alpha-jitter tween.
        tweens.push(scene.tweens.add({
          targets: glow,
          scaleX: { from: 0.96, to: 1.04 },
          scaleY: { from: 0.96, to: 1.04 },
          duration: 1300 + rng() * 800,
          yoyo: true,
          repeat: -1,
          ease: "Sine.easeInOut",
          delay: rng() * 900,
        }));
        break;
      }

      case "flower": {
        const key = ensureStampTexture(scene, "flower_patch");
        if (!key) break;
        // Ground cover — always under the agents' feet.
        const patch = scene.add.image(a.x, a.y, key).setOrigin(0.5, 1).setDepth(96);
        objects.push(patch);
        // Occasional petal lifting off the patch.
        timers.push(scene.time.addEvent({
          delay: 5200 + rng() * 4800,
          loop: true,
          callback: () => {
            const petal = scene.add.graphics();
            petal.fillStyle(0xfff4f0, 0.9);
            petal.fillCircle(0, 0, 1.3);
            petal.setPosition(a.x + (rng() - 0.5) * 18, a.y - 6);
            petal.setDepth(propDepth(a.y) + 1);
            scene.tweens.add({
              targets: petal,
              y: petal.y - 26 - rng() * 14,
              x: petal.x + (rng() - 0.5) * 24,
              alpha: 0,
              duration: 2600 + rng() * 900,
              ease: "Sine.easeOut",
              onComplete: () => petal.destroy(),
            });
          },
        }));
        break;
      }

      case "smoke": {
        // Continuous chimney puff stream; anchors sit on rooftops, so puffs
        // render above buildings-top.
        timers.push(scene.time.addEvent({
          delay: 1100 + rng() * 700,
          loop: true,
          callback: () => {
            const puff = scene.add.graphics();
            puff.fillStyle(0xe6e3da, 0.5);
            puff.fillCircle(0, 0, 3);
            puff.setPosition(a.x + (rng() - 0.5) * 3, a.y);
            puff.setDepth(5600);
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
        }));
        break;
      }

      case "water-foam": {
        if (scene.textures.exists("water-foam")) {
          // Frames 30-35 are the sparse foam-bubble row of the waterfall
          // sheet (rows above are vertical streaks — wrong on flat water).
          if (!scene.anims.exists("water-foam-shimmer")) {
            scene.anims.create({
              key: "water-foam-shimmer",
              frames: scene.anims.generateFrameNumbers("water-foam", { start: 30, end: 35 }),
              frameRate: 4,
              repeat: -1,
            });
          }
          const foam = scene.add.sprite(a.x, a.y, "water-foam", 30);
          foam.setScale(1.1).setAlpha(0.45).setDepth(12);
          foam.play("water-foam-shimmer");
          objects.push(foam);
          tweens.push(scene.tweens.add({
            targets: foam,
            x: a.x + 10,
            alpha: { from: 0.28, to: 0.5 },
            duration: 3800 + rng() * 1400,
            yoyo: true,
            repeat: -1,
            ease: "Sine.easeInOut",
            delay: rng() * 1200,
          }));
        }
        // Occasional expanding ripple rings around the anchor.
        timers.push(scene.time.addEvent({
          delay: 2400 + rng() * 1600,
          loop: true,
          callback: () => {
            const ring = scene.add.graphics();
            ring.lineStyle(1.2, 0xffffff, 0.55);
            ring.strokeCircle(0, 0, 4);
            ring.setPosition(a.x + (rng() - 0.5) * 40, a.y + (rng() - 0.5) * 24);
            ring.setDepth(12);
            scene.tweens.add({
              targets: ring,
              alpha: 0,
              scale: 2.4,
              duration: 1400,
              ease: "Quad.easeOut",
              onComplete: () => ring.destroy(),
            });
          },
        }));
        break;
      }

      case "windmill": {
        if (scene.textures.exists("windmill") && scene.anims.exists("windmill-spin")) {
          const mill = scene.add.sprite(a.x, a.y, "windmill", 0);
          mill.setScale(0.42).setOrigin(0.5, 1).setDepth(propDepth(a.y)).setAlpha(0.95);
          mill.play("windmill-spin");
          objects.push(mill);
        }
        break;
      }

      // "label" → handled by the DOM overlay, nothing to draw here.
      default:
        break;
    }
  }

  // Atmospheric petal drift — a few tinted specks slowly falling across the
  // town, above the rooftops (they're airborne).
  const petalKey = `petal-${town}`;
  if (!scene.textures.exists(petalKey)) {
    const g = scene.add.graphics();
    g.fillStyle(pal.petalDrift, 1);
    g.fillCircle(2, 2, 1.4);
    g.generateTexture(petalKey, 4, 4);
    g.destroy();
  }
  for (let i = 0; i < 18; i++) {
    const petal = scene.add.image(rng() * W, rng() * H, petalKey);
    petal.setAlpha(0.35 + rng() * 0.25);
    petal.setDepth(5400);
    objects.push(petal);
    tweens.push(scene.tweens.add({
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
    }));
  }

  // ── Handle ───────────────────────────────────────────────────────────
  let lastHour = -1;
  return {
    setHour(hour: number) {
      if (hour === lastHour) return;
      lastHour = hour;
      const night = hour < 6 || hour >= 19;
      const dusk = (hour >= 17 && hour < 19) || (hour >= 5 && hour < 7);
      const targetAlpha = night ? 0.42 : dusk ? 0.22 : 0.025;
      for (const g of lampGlows) {
        scene.tweens.add({
          targets: g, alpha: targetAlpha, duration: 600, ease: "Sine.easeInOut",
        });
      }
    },
    destroy() {
      for (const t of tweens) t.stop();
      for (const ev of timers) ev.remove();
      for (const o of objects) o.destroy();
    },
  };
}

// ── Utilities ──────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
