/**
 * In-game world clock + day/night helpers.
 *
 * Runs ~60x real time by default (1 real second = 1 in-game minute), but the
 * speed is configurable. Drives the sky overlay tint and is also synced from
 * backend `world_clock_tick` events when the simulation is live.
 */

export type PartOfDay =
  | "night"
  | "dawn"
  | "morning"
  | "midday"
  | "afternoon"
  | "evening"
  | "dusk";

export interface WorldClockOptions {
  startHour?: number;
  startMinute?: number;
  /** How many in-game minutes pass per real second. 1 = 60x speed. */
  minutesPerSecond?: number;
}

export interface DayNightTint {
  /** Phaser hex color (0xrrggbb) used for the sky overlay rect. */
  color: number;
  /** Overlay alpha [0..1]. 0 = full daylight. */
  alpha: number;
}

/* ── Helpers ────────────────────────────────────────────────── */

function hexToInt(hex: string): number {
  return parseInt(hex.replace("#", ""), 16);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(lerp(ar, br, t));
  const g = Math.round(lerp(ag, bg, t));
  const bl = Math.round(lerp(ab, bb, t));
  return (r << 16) | (g << 8) | bl;
}

/**
 * Pre-baked LUT matching plan §7.1, with linear blending between key hours
 * so the transition feels continuous instead of stepped.
 */
const LUT: Array<{ h: number; color: number; alpha: number }> = [
  { h: 0,  color: hexToInt("#0c1633"), alpha: 0.50 }, // deep night
  { h: 5,  color: hexToInt("#0c1633"), alpha: 0.50 },
  { h: 6,  color: hexToInt("#5b6a99"), alpha: 0.25 }, // dawn blue
  { h: 7,  color: hexToInt("#ffb066"), alpha: 0.22 }, // dawn warm
  { h: 8,  color: hexToInt("#ffffff"), alpha: 0.0 },
  { h: 12, color: hexToInt("#ffffff"), alpha: 0.0 },
  { h: 17, color: hexToInt("#ffffff"), alpha: 0.0 },
  { h: 18, color: hexToInt("#ff8866"), alpha: 0.18 }, // golden hour
  { h: 19, color: hexToInt("#ff8866"), alpha: 0.20 },
  { h: 20, color: hexToInt("#4a3b6a"), alpha: 0.32 }, // dusk
  { h: 21, color: hexToInt("#2c2450"), alpha: 0.44 }, // early night

  { h: 22, color: hexToInt("#0c1633"), alpha: 0.50 }, // night
  { h: 24, color: hexToInt("#0c1633"), alpha: 0.50 },
];

export class WorldClock {
  public hour: number;
  public minute: number;
  private accumulatorMs = 0;
  private minutesPerSecond: number;

  constructor(opts: WorldClockOptions = {}) {
    this.hour = opts.startHour ?? 8;
    this.minute = opts.startMinute ?? 0;
    this.minutesPerSecond = opts.minutesPerSecond ?? 1;
  }

  setTime(h: number, m: number) {
    this.hour = Math.max(0, Math.min(23, Math.floor(h)));
    this.minute = Math.max(0, Math.min(59, Math.floor(m)));
    this.accumulatorMs = 0;
  }

  /** Advance the clock. `deltaMs` is real-time elapsed since last tick. */
  tick(deltaMs: number) {
    this.accumulatorMs += deltaMs * this.minutesPerSecond;
    const minutesToAdd = Math.floor(this.accumulatorMs / 1000);
    if (minutesToAdd <= 0) return;
    this.accumulatorMs -= minutesToAdd * 1000;
    this.minute += minutesToAdd;
    while (this.minute >= 60) {
      this.minute -= 60;
      this.hour = (this.hour + 1) % 24;
    }
  }

  partOfDay(): PartOfDay {
    const h = this.hour;
    if (h < 5) return "night";
    if (h < 7) return "dawn";
    if (h < 11) return "morning";
    if (h < 14) return "midday";
    if (h < 17) return "afternoon";
    if (h < 19) return "evening";
    if (h < 22) return "dusk";
    return "night";
  }

  /** Fractional hour, e.g. 8:30 → 8.5. */
  fractionalHour(): number {
    return this.hour + this.minute / 60;
  }

  /** "8:42 AM" style human readable label. */
  label(): string {
    const period = this.hour < 12 ? "AM" : "PM";
    const h12 = this.hour % 12 === 0 ? 12 : this.hour % 12;
    return `${h12}:${this.minute.toString().padStart(2, "0")} ${period}`;
  }

  /**
   * Compute the sky overlay tint for a given fractional hour by linearly
   * interpolating between the LUT key points.
   */
  static computeDayNightTint(hour: number): DayNightTint {
    const h = ((hour % 24) + 24) % 24;
    for (let i = 0; i < LUT.length - 1; i++) {
      const a = LUT[i];
      const b = LUT[i + 1];
      if (h >= a.h && h <= b.h) {
        const t = b.h === a.h ? 0 : (h - a.h) / (b.h - a.h);
        return {
          color: lerpColor(a.color, b.color, t),
          alpha: lerp(a.alpha, b.alpha, t),
        };
      }
    }
    return { color: LUT[0].color, alpha: LUT[0].alpha };
  }
}
