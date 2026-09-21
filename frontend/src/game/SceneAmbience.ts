/**
 * SceneAmbience — brings the generated tilemap to life, in pixels.
 *
 * The map generator (scripts/mapgen) emits an "anchors" object layer of point
 * objects; each anchor's `kind` property names a living detail the scene
 * should animate at that spot:
 *
 *   tree       → tileset tree stamp, breathing sway (scale, never rotation)
 *   lamp       → tileset lamppost stamp + a dithered additive glow at night
 *   flower     → white flower-patch stamp + the occasional lifting petal
 *   smoke      → pixel chimney puffs; `mode=hearth` only at dawn and dusk
 *   water-foam → foam shimmer, pixel ripple rings, and a drifting mallard
 *   windmill   → the animated windmill spritesheet
 *   yardsign / noticeboard / pollplace / banner / bunting / brazier
 *              → the election's furniture (owned by CivicLayer)
 *   label      → ignored here (TownScene draws the chips)
 *
 * Plus the sky and the seasons: pixel birds by day, falling leaves in the
 * towns whose palette asks for them, and a few drifting petals scaled to
 * the town's population.
 *
 * Anchor x/y is the sprite's bottom-center (the generator's contract), so all
 * stamp sprites use origin (0.5, 1) and slot into the same y-sorted depth
 * band as the agents (depth = 100 + feetY).
 *
 * Style rules: every effect is a small canvas texture or a tileset blit,
 * moved with stepped or slow linear tweens — never an anti-aliased shape.
 */
import Phaser from "phaser";
import type { TownId } from "../types/messages";
import type { PartOfDay } from "./WorldClock";
import stampDefs from "./stampDefs.json";
import {
  ensureBirdTextures,
  ensureDuckTextures,
  ensureLampGlowTexture,
  ensureLeafTextures,
  ensurePetalTexture,
  ensureRippleTextures,
  ensureSmokePuffTextures,
  mulberry32,
  reducedMotion,
} from "./pixelTextures";

// ── Anchor model (parsed from the map's "anchors" object layer) ────────

export interface MapAnchor {
  kind: string;
  x: number;
  y: number;
  /** Registry stamp name for trees (e.g. "tree_light", "tree_fruit_a"). */
  stamp?: string;
  /** Landmark name the anchor belongs to (labels, civic furniture). */
  name?: string;
  /** Every other string property the generator attached. */
  props?: Record<string, string>;
}

// ── Tile stamps (generated: scripts/mapgen/export_window_gids.py) ───────

const TILE: number = stampDefs.tileSize;
type SheetName = keyof typeof stampDefs.sheets;

function sheetFor(gid: number): { key: SheetName; local: number; columns: number } | null {
  const sheets = stampDefs.sheets as Record<SheetName, { firstgid: number; columns: number }>;
  let best: { key: SheetName; local: number; columns: number } | null = null;
  for (const key of Object.keys(sheets) as SheetName[]) {
    const s = sheets[key];
    if (gid >= s.firstgid && (!best || s.firstgid > sheets[best.key].firstgid)) {
      best = { key, local: gid - s.firstgid, columns: s.columns };
    }
  }
  return best;
}

function blitGid(scene: Phaser.Scene, ctx: CanvasRenderingContext2D, gid: number, dx: number, dy: number): boolean {
  const where = sheetFor(gid);
  if (!where || !scene.textures.exists(where.key)) return false;
  const src = scene.textures.get(where.key).getSourceImage() as HTMLImageElement;
  const col = where.local % where.columns;
  const row = (where.local - col) / where.columns;
  ctx.drawImage(src, col * TILE, row * TILE, TILE, TILE, dx, dy, TILE, TILE);
  return true;
}

/**
 * Create (once) a texture for a named multi-tile stamp by blitting its GIDs
 * out of the loaded tilesets. Returns the texture key, or null when the
 * stamp is unknown or a tileset is missing.
 */
export function ensureStampTexture(scene: Phaser.Scene, name: string): string | null {
  const def = (stampDefs.stamps as Record<string, { w: number; h: number; gids: number[][] }>)[name];
  if (!def) return null;
  const key = `stamp-${name}`;
  if (scene.textures.exists(key)) return key;
  const canvas = scene.textures.createCanvas(key, def.w * TILE, def.h * TILE);
  if (!canvas) return null;
  const ctx = canvas.getContext();
  ctx.imageSmoothingEnabled = false;
  let drew = false;
  for (let r = 0; r < def.h; r++) {
    for (let c = 0; c < def.w; c++) {
      const gid = def.gids[r][c];
      if (gid) drew = blitGid(scene, ctx, gid, c * TILE, r * TILE) || drew;
    }
  }
  canvas.refresh();
  return drew ? key : null;
}

/** Create (once) a 16x16 texture for a single prop tile by name. */
export function ensureSingleTexture(scene: Phaser.Scene, name: string): string | null {
  const gid = (stampDefs.singles as Record<string, number>)[name];
  if (!gid) return null;
  const key = `tile-${name}`;
  if (scene.textures.exists(key)) return key;
  const canvas = scene.textures.createCanvas(key, TILE, TILE);
  if (!canvas) return null;
  const ctx = canvas.getContext();
  ctx.imageSmoothingEnabled = false;
  const drew = blitGid(scene, ctx, gid, 0, 0);
  canvas.refresh();
  return drew ? key : null;
}

// ── Depth scheme (must match TownScene) ────────────────────────────────
// ground 0-2, buildings-base 3, agents 100+y, buildings-top 5000,
// petals 5400, leaves 5440, birds 5450, smoke 5600, sky tint 6000,
// lamp glow 6001.

/** Depth for a bottom-anchored prop so agents y-sort against its base. */
export function propDepth(anchorY: number): number {
  // Agent depth is 100 + centerY; agent feet sit ~14px below center, so a
  // prop whose base is at anchorY ties with an agent whose feet are there.
  return 100 + anchorY - 14;
}

// ── Per-town accent palette (lamp glow, petal tint, seasonal leaves) ────

interface Palette { lampGlow: number; petalDrift: number; leaves?: number[] }

const PALETTES: Record<TownId, Palette> = {
  dover:      { lampGlow: 0xffd58a, petalDrift: 0xd47c4a, leaves: [0xc0792a, 0xd9794b, 0xe0a86b] },
  montclair:  { lampGlow: 0xfff0c0, petalDrift: 0xe6a875, leaves: [0xb9302a, 0xe25e3b, 0xd8a14a] },
  parsippany: { lampGlow: 0xffd58a, petalDrift: 0xc4dba8 },
  randolph:   { lampGlow: 0xffd9a8, petalDrift: 0xd8c098 },
};

// Non-NJ-11 towns get a restrained warm default.
const DEFAULT_PALETTE: Palette = { lampGlow: 0xffe2b0, petalDrift: 0xd8c9a8 };

// ── Public API ─────────────────────────────────────────────────────────

export interface AmbienceOptions {
  /** Town population (drives how busy the sky and the petal drift are). */
  population?: number;
}

export interface AmbienceHandle {
  /** Drive lamp glow intensity from the world clock. */
  setHour(hour: number): void;
  /** Day-part gating: hearth smoke at dawn/dusk, birds by day only. */
  setPartOfDay(part: PartOfDay): void;
  destroy(): void;
}

const HEARTH_PARTS: ReadonlySet<PartOfDay> = new Set<PartOfDay>(["dawn", "morning", "evening", "dusk", "night"]);
const BIRD_PARTS: ReadonlySet<PartOfDay> = new Set<PartOfDay>(["dawn", "morning", "midday", "afternoon", "evening"]);

export function composeTownAmbience(
  scene: Phaser.Scene,
  scenarioId: string,
  town: TownId,
  anchors: MapAnchor[],
  W: number,
  H: number,
  opts: AmbienceOptions = {},
): AmbienceHandle {
  // Town ids are package-local. Only apply the NJ-authored accent adapter
  // inside its owning scenario so a custom package can safely reuse "dover"
  // (or any other id) and receive the neutral presentation.
  const pal = scenarioId === "nj11-2026"
    ? PALETTES[town] ?? DEFAULT_PALETTE
    : DEFAULT_PALETTE;
  const rng = mulberry32(0xa11ce ^ (town.length * 211));
  const still = reducedMotion();
  const objects: Phaser.GameObjects.GameObject[] = [];
  const tweens: Phaser.Tweens.Tween[] = [];
  const timers: Phaser.Time.TimerEvent[] = [];
  const lampGlows: Phaser.GameObjects.Image[] = [];
  let part: PartOfDay = "morning";
  let lampTarget = 0.025;

  /** Stepped upward drift for a tiny pixel (puff, petal, ripple). */
  const drift = (
    target: Phaser.GameObjects.GameObject,
    to: { x?: number; y?: number; alpha?: number; scale?: number },
    duration: number,
    steps: number,
  ) => scene.tweens.add({
    targets: target,
    ...to,
    duration,
    ease: "Stepped",
    easeParams: [steps],
    onComplete: () => target.destroy(),
  });

  for (const a of anchors) {
    switch (a.kind) {
      case "tree": {
        const key = ensureStampTexture(scene, a.stamp && (stampDefs.stamps as Record<string, unknown>)[a.stamp] ? a.stamp : "tree_light");
        if (!key) break;
        const tree = scene.add.image(a.x, a.y, key).setOrigin(0.5, 1).setDepth(propDepth(a.y));
        objects.push(tree);
        if (still) break;
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
        // Dithered additive light at the lantern head (lamppost is 2x5
        // tiles tall). Tight and translucent: maps cluster lamps around
        // plazas, where broad discs would bleach the tile art. The night
        // alpha is driven from setHour(); a slow two-state flicker sits on
        // top so the light breathes without ever resampling the dither.
        const glow = scene.add.image(a.x, a.y - 62, ensureLampGlowTexture(scene))
          .setTint(pal.lampGlow)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setDepth(6001)
          .setAlpha(0.025);
        objects.push(glow);
        lampGlows.push(glow);
        if (!still) {
          timers.push(scene.time.addEvent({
            delay: 900 + rng() * 700,
            loop: true,
            callback: () => {
              const dim = rng() < 0.3;
              glow.setAlpha(lampTarget * (dim ? 0.86 : 1));
            },
          }));
        }
        break;
      }

      case "flower": {
        const key = ensureStampTexture(scene, "flower_patch");
        if (!key) break;
        // Ground cover — always under the agents' feet.
        const patch = scene.add.image(a.x, a.y, key).setOrigin(0.5, 1).setDepth(96);
        objects.push(patch);
        if (still) break;
        // Occasional petal lifting off the patch: a 2x2 square, stepped.
        const petalKey = ensurePetalTexture(scene);
        timers.push(scene.time.addEvent({
          delay: 5200 + rng() * 4800,
          loop: true,
          callback: () => {
            const petal = scene.add.image(a.x + (rng() - 0.5) * 18, a.y - 6, petalKey)
              .setTint(0xfff4f0)
              .setAlpha(0.9)
              .setDepth(propDepth(a.y) + 1);
            drift(petal, { y: petal.y - 26 - rng() * 14, x: petal.x + (rng() - 0.5) * 24, alpha: 0 }, 2600 + rng() * 900, 8);
          },
        }));
        break;
      }

      case "smoke": {
        if (still) break;
        // Chimney puff stream: three dithered puff sizes cycling upward.
        // Hearth chimneys only smoke when a home would be warm — dawn,
        // evening, dusk and night — so a summer noon reads quiet.
        const hearth = a.props?.mode === "hearth";
        const puffs = ensureSmokePuffTextures(scene);
        timers.push(scene.time.addEvent({
          delay: 1300 + rng() * 800,
          loop: true,
          callback: () => {
            if (hearth && !HEARTH_PARTS.has(part)) return;
            const x = a.x + (rng() - 0.5) * 3;
            const puff = scene.add.image(x, a.y, puffs[0]).setDepth(5600).setAlpha(0.95);
            const dx = (rng() - 0.5) * 14;
            const rise = 44 + rng() * 16;
            scene.tweens.addCounter({
              from: 0,
              to: 1,
              duration: 2600 + rng() * 800,
              ease: "Linear",
              onUpdate: (tw) => {
                const t = tw.getValue() ?? 0;
                const step = Math.floor(t * 9) / 9;
                puff.setPosition(Math.round(x + dx * step), Math.round(a.y - rise * step));
                puff.setTexture(step < 0.34 ? puffs[0] : step < 0.67 ? puffs[1] : puffs[2]);
                puff.setAlpha(0.95 * (1 - step * step));
              },
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
          if (!still) foam.play("water-foam-shimmer");
          objects.push(foam);
          if (!still) {
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
        }
        if (still) break;
        // Expanding pixel ripple rings: three ring textures in turn.
        const rings = ensureRippleTextures(scene);
        timers.push(scene.time.addEvent({
          delay: 2400 + rng() * 1600,
          loop: true,
          callback: () => {
            const ring = scene.add.image(a.x + (rng() - 0.5) * 40, a.y + (rng() - 0.5) * 24, rings[0])
              .setDepth(12)
              .setAlpha(0.75);
            scene.tweens.addCounter({
              from: 0,
              to: 1,
              duration: 1400,
              ease: "Linear",
              onUpdate: (tw) => {
                const t = tw.getValue() ?? 0;
                ring.setTexture(t < 0.34 ? rings[0] : t < 0.67 ? rings[1] : rings[2]);
                ring.setAlpha(0.75 * (1 - t));
              },
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
          if (!still) mill.play("windmill-spin");
          objects.push(mill);
        }
        break;
      }

      // label / yardsign / noticeboard / pollplace / banner / bunting /
      // brazier → drawn by TownScene and CivicLayer.
      default:
        break;
    }
  }

  // ── A mallard on the first stretch of water ────────────────────────
  const water = anchors.find((a) => a.kind === "water-foam");
  if (water && !still) {
    const [duckA, duckB] = ensureDuckTextures(scene);
    const duck = scene.add.image(water.x - 18, water.y - 4, duckA).setDepth(13).setAlpha(0.95);
    objects.push(duck);
    let facingRight = true;
    const paddle = () => {
      if (!duck.active) return;
      const tx = water.x + (rng() - 0.5) * 56;
      const ty = water.y + (rng() - 0.5) * 20;
      facingRight = tx >= duck.x;
      duck.setFlipX(!facingRight);
      tweens.push(scene.tweens.add({
        targets: duck,
        x: tx,
        y: ty,
        duration: 2600 + rng() * 2400,
        ease: "Linear",
        onComplete: () => {
          if (!duck.active) return;
          // Dip for a beat, then paddle on.
          duck.setTexture(duckB);
          timers.push(scene.time.delayedCall(700 + rng() * 900, () => {
            if (!duck.active) return;
            duck.setTexture(duckA);
            timers.push(scene.time.delayedCall(400 + rng() * 1800, paddle));
          }));
        },
      }));
    };
    timers.push(scene.time.delayedCall(800, paddle));
  }

  // ── Sky: pixel birds by day ──────────────────────────────────────────
  if (!still) {
    const [wingsUp, wingsDown] = ensureBirdTextures(scene);
    const launchBird = () => {
      if (BIRD_PARTS.has(part)) {
        const fromLeft = rng() < 0.5;
        const y = 40 + rng() * (H / 3);
        const bird = scene.add.image(fromLeft ? -12 : W + 12, y, wingsUp).setDepth(5450).setAlpha(0.8);
        bird.setFlipX(!fromLeft);
        objects.push(bird);
        const flap = scene.time.addEvent({
          delay: 220 + rng() * 120,
          loop: true,
          callback: () => bird.setTexture(bird.texture.key === wingsUp ? wingsDown : wingsUp),
        });
        timers.push(flap);
        tweens.push(scene.tweens.add({
          targets: bird,
          x: fromLeft ? W + 12 : -12,
          y: y + (rng() - 0.5) * 40,
          duration: 7000 + rng() * 6000,
          ease: "Linear",
          onComplete: () => {
            flap.remove(false);
            bird.destroy();
          },
        }));
      }
      timers.push(scene.time.delayedCall(4000 + rng() * 8000, launchBird));
    };
    for (let i = 0; i < 2; i++) timers.push(scene.time.delayedCall(1000 + rng() * 5000, launchBird));
  }

  // ── Seasonal leaves (palette-driven, not town-id switches) ───────────
  if (!still && pal.leaves && pal.leaves.length > 0) {
    const frames = pal.leaves.map((c) => ensureLeafTextures(scene, c));
    timers.push(scene.time.addEvent({
      delay: 1500,
      loop: true,
      callback: () => {
        if (part === "night") return;
        const [flat, tilted] = frames[Math.floor(rng() * frames.length)];
        const startX = -20 + rng() * W * 0.4;
        const leaf = scene.add.image(startX, -6, flat).setDepth(5440).setAlpha(0.9);
        const flip = scene.time.addEvent({
          delay: 360 + rng() * 240,
          loop: true,
          callback: () => leaf.setTexture(leaf.texture.key === flat ? tilted : flat),
        });
        timers.push(flip);
        tweens.push(scene.tweens.add({
          targets: leaf,
          x: startX + 120 + rng() * 140,
          y: H + 8,
          duration: 9000 + rng() * 5000,
          ease: "Linear",
          onComplete: () => {
            flip.remove(false);
            leaf.destroy();
          },
        }));
      },
    }));
  }

  // ── Atmospheric petal drift — 2x2 tinted specks, count by population ──
  if (!still) {
    const petalKey = ensurePetalTexture(scene);
    const count = 6 + 2 * Math.min(6, Math.floor((opts.population ?? 0) / 10000));
    for (let i = 0; i < count; i++) {
      const petal = scene.add.image(rng() * W, rng() * H, petalKey)
        .setTint(pal.petalDrift)
        .setAlpha(0.35 + rng() * 0.25)
        .setDepth(5400);
      objects.push(petal);
      tweens.push(scene.tweens.add({
        targets: petal,
        x: petal.x + (rng() - 0.5) * 60,
        y: petal.y + 240,
        duration: 12000 + rng() * 8000,
        ease: "Linear",
        repeat: -1,
        delay: rng() * 5000,
        onRepeat: () => {
          petal.x = rng() * W;
          petal.y = -10;
        },
      }));
    }
  }

  // ── Handle ───────────────────────────────────────────────────────────
  let lastHour = -1;
  return {
    setHour(hour: number) {
      if (hour === lastHour) return;
      lastHour = hour;
      const night = hour < 6 || hour >= 19;
      const dusk = (hour >= 17 && hour < 19) || (hour >= 5 && hour < 7);
      lampTarget = night ? 0.42 : dusk ? 0.22 : 0.025;
      for (const g of lampGlows) {
        if (still) g.setAlpha(lampTarget);
        else scene.tweens.add({ targets: g, alpha: lampTarget, duration: 600, ease: "Stepped", easeParams: [4] });
      }
    },
    setPartOfDay(next: PartOfDay) {
      part = next;
    },
    destroy() {
      for (const t of tweens) t.stop();
      for (const ev of timers) ev.remove(false);
      for (const o of objects) o.destroy();
    },
  };
}
