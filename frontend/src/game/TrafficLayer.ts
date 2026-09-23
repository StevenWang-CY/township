/**
 * TrafficLayer — a car or two on the main road.
 *
 * The map's `traffic` object layer gives lane polylines (world px, lane
 * centres, edge to edge) and stop lines (a point just before each crosswalk
 * band, flagged when a signal governs it). Cars are stamp sprites from the
 * modern kit that advance in 2 px steps at ~25 px/s, stop when a resident's
 * feet are in the lane ahead or the signal ahead is red for their axis,
 * leave at the map edge and come back a while later. Parked cars are tiles;
 * this layer only owns the moving ones. Reduced motion → nothing moves.
 */
import Phaser from "phaser";
import { ensureStampTexture, ensureSingleTexture } from "./SceneAmbience";
import stampDefs from "./stampDefs.json";
import { reducedMotion } from "./pixelTextures";
import type { Pt } from "./NavGrid";

export type LaneDir = "e" | "w" | "n" | "s";
export interface TrafficLane { dir: LaneDir; road: string; points: Pt[]; /** Both ends touch the map edge. */ through?: boolean }
export interface StopLine { x: number; y: number; axis: "h" | "v"; signal: boolean }
export interface SignalAnchor { x: number; y: number; axis: "h" | "v" }

interface Car {
  sprite: Phaser.GameObjects.Image;
  lane: TrafficLane;
  /** Distance travelled along the lane polyline (px). */
  s: number;
  length: number;
  waitMs: number;
}

const STEP_PX = 2;
const STEP_MS = 80;
const LOOK_AHEAD = 24;
const LANE_HALF = 10;
const SIGNAL_PERIOD_MS = 9000;
const CAR_COLORS = ["red", "blue", "white", "silver", "green"];

function laneLength(points: Pt[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return len;
}

function pointAt(points: Pt[], s: number): { p: Pt; heading: Pt } {
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    if (s <= acc + len || i === points.length - 1) {
      const t = Math.max(0, Math.min(1, (s - acc) / len));
      return { p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, heading: { x: (b.x - a.x) / len, y: (b.y - a.y) / len } };
    }
    acc += len;
  }
  return { p: points[0], heading: { x: 1, y: 0 } };
}

/** First stamp name that exists in stampDefs, from a list of candidates. */
function stampName(candidates: string[]): string | null {
  const stamps = stampDefs.stamps as Record<string, unknown>;
  for (const c of candidates) if (stamps[c]) return c;
  return null;
}

export class TrafficLayer {
  private cars: Car[] = [];
  private accum = 0;
  private signalAccum = 0;
  private nsGreen = true;
  private paused = false;
  private readonly count: number;
  /** Lanes cars may use: edge-to-edge ones when the map has any (no pop-in). */
  private readonly usable: TrafficLane[];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly lanes: TrafficLane[],
    private readonly stops: StopLine[],
    private readonly signals: SignalAnchor[],
    private readonly opts: { population: number; bodies: () => Array<{ x: number; y: number; active: boolean }>; layers: () => Phaser.Tilemaps.TilemapLayer[] },
  ) {
    const through = lanes.filter((l) => l.through);
    const pool = through.length > 0 ? through : lanes;
    // The main road: only lanes at least 60% as long as the longest.
    const longest = Math.max(0, ...pool.map((l) => laneLength(l.points)));
    this.usable = pool.filter((l) => laneLength(l.points) >= longest * 0.6);
    this.count = reducedMotion() || this.usable.length === 0 ? 0 : (opts.population > 30000 ? 2 : 1);
    for (let i = 0; i < this.count; i++) this.spawn(6000 + i * 9000);
    this.applySignal();
  }

  pause(on = true) { this.paused = on; }

  destroy() {
    for (const c of this.cars) c.sprite.destroy();
    this.cars = [];
  }

  private spawn(waitMs: number) {
    const lane = this.usable[Math.floor(Math.random() * this.usable.length)];
    const color = CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
    const horizontal = lane.dir === "e" || lane.dir === "w";
    const name = stampName(
      horizontal
        ? [`car_h_${color}`, `car_${color}_h`, `CAR_H_${color}`, "car_h_red", "car_red_h"]
        : [`car_v_${color}`, `car_${color}_v`, `CAR_V_${color}`, "car_v_red", "car_red_v"],
    );
    const key = name ? ensureStampTexture(this.scene, name) : null;
    if (!key) return;
    const start = pointAt(lane.points, 0);
    const sprite = this.scene.add.image(start.p.x, start.p.y, key).setVisible(false);
    sprite.setFlipX(lane.dir === "w");
    sprite.setFlipY(lane.dir === "n");
    this.cars.push({ sprite, lane, s: 0, length: laneLength(lane.points), waitMs });
  }

  /** Green for the north–south lanes, red for east–west, and vice versa. */
  private applySignal() {
    const red = ensureSingleTexture(this.scene, "signal_red");
    const green = ensureSingleTexture(this.scene, "signal_green");
    void red; void green;
    const singles = stampDefs.singles as Record<string, number>;
    const redGid = singles.signal_red;
    const greenGid = singles.signal_green;
    if (!redGid || !greenGid) return;
    const T = stampDefs.tileSize;
    for (const sig of this.signals) {
      const tx = Math.floor(sig.x / T);
      const ty = Math.floor((sig.y - 1) / T);
      const green_ = sig.axis === "v" ? this.nsGreen : !this.nsGreen;
      for (const layer of this.opts.layers()) {
        const tile = layer.getTileAt(tx, ty);
        if (!tile || (tile.index !== redGid && tile.index !== greenGid)) continue;
        layer.putTileAt(green_ ? greenGid : redGid, tx, ty);
      }
    }
  }

  private blockedAhead(car: Car, p: Pt, heading: Pt): boolean {
    // A resident's feet inside the lane ahead.
    for (const b of this.opts.bodies()) {
      if (!b.active) continue;
      const rx = b.x - p.x;
      const ry = b.y - p.y;
      const along = rx * heading.x + ry * heading.y;
      if (along < -6 || along > LOOK_AHEAD) continue;
      const across = Math.abs(rx * heading.y - ry * heading.x);
      if (across <= LANE_HALF + 6) return true;
    }
    // A red signal at a stop line just ahead.
    const axis: "h" | "v" = heading.x !== 0 ? "h" : "v";
    for (const st of this.stops) {
      if (st.axis !== axis || !st.signal) continue;
      const rx = st.x - p.x;
      const ry = st.y - p.y;
      const along = rx * heading.x + ry * heading.y;
      if (along < 0 || along > 10) continue;
      const across = Math.abs(rx * heading.y - ry * heading.x);
      if (across > 24) continue;
      const green = axis === "v" ? this.nsGreen : !this.nsGreen;
      if (!green) return true;
    }
    return false;
  }

  update(delta: number) {
    if (this.count === 0 || this.paused) return;
    this.signalAccum += delta;
    if (this.signalAccum >= SIGNAL_PERIOD_MS) {
      this.signalAccum = 0;
      this.nsGreen = !this.nsGreen;
      this.applySignal();
    }
    this.accum += delta;
    if (this.accum < STEP_MS) return;
    const steps = Math.min(4, Math.floor(this.accum / STEP_MS));
    this.accum -= steps * STEP_MS;
    for (const car of this.cars) {
      if (car.waitMs > 0) {
        car.waitMs -= steps * STEP_MS;
        if (car.waitMs <= 0) {
          car.lane = this.usable[Math.floor(Math.random() * this.usable.length)];
          car.length = laneLength(car.lane.points);
          car.s = 0;
          car.sprite.setFlipX(car.lane.dir === "w").setFlipY(car.lane.dir === "n").setVisible(true);
        }
        continue;
      }
      for (let k = 0; k < steps; k++) {
        const here = pointAt(car.lane.points, car.s);
        if (this.blockedAhead(car, here.p, here.heading)) break;
        car.s += STEP_PX;
        if (car.s >= car.length) {
          car.sprite.setVisible(false);
          car.waitMs = 6000 + Math.random() * 14000;
          break;
        }
      }
      const at = pointAt(car.lane.points, Math.min(car.s, car.length));
      car.sprite.setPosition(Math.round(at.p.x), Math.round(at.p.y)).setDepth(100 + Math.floor(at.p.y));
    }
  }
}
