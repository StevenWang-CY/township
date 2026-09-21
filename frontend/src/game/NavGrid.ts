/**
 * NavGrid — a walkability grid + A* pathfinder for the 1200×800 town.
 *
 * Built once per town from the tilemap's collision rectangles plus a
 * per-cell GROUND KIND sampled from the tile layers, so walkers prefer
 * sidewalks and paths, cross roads freely without lingering on them, cut
 * across grass when it is worth it, and avoid the rail ballast. Pure
 * module: no Phaser scene dependency, so it is trivially unit-testable and
 * reusable by the onboarding scene or a headless test.
 *
 * Coordinates are world pixels throughout; cells are NAV_CELL px wide.
 */

/** Logical world size — every generated town map is exactly this. */
export const WORLD_W = 1200;
export const WORLD_H = 800;
/** Walkable inset from the map edge (keeps feet off the border tiles). */
export const WORLD_MARGIN = 40;

/** Grid resolution. 4 px = a quarter tile: fine enough to thread the
 *  16 px gaps between props and building aprons that an 8 px grid sealed
 *  shut; a 300×200 grid still searches in ~1 ms. */
export const NAV_CELL = 4;
/** Padding around collision rects. Slightly under TownScene.isBlocked's 6 px
 *  so every point that scene helper accepts also lands in a walkable cell
 *  after the ±2 px cell-centre quantisation. */
export const NAV_PAD = 5;

export interface Pt { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }

/** Ground classes the grid distinguishes (see scripts/mapgen/export_road_gids.py). */
export type GroundKind = "grass" | "sidewalk" | "road" | "rough";
export type KindSampler = (px: number, py: number) => GroundKind;

const KIND_ID: Record<GroundKind, number> = { grass: 0, sidewalk: 1, road: 2, rough: 3 };
const KIND_NAME: GroundKind[] = ["grass", "sidewalk", "road", "rough"];
/** Step-cost multiplier per kind: sidewalk is the baseline, asphalt a touch
 *  dearer (walk beside the road, cross it anywhere), grass dearer still,
 *  ballast strongly discouraged. */
export const GROUND_COST: Record<GroundKind, number> = { sidewalk: 1.0, road: 1.15, grass: 1.4, rough: 2.6 };
const COST_BY_ID = [GROUND_COST.grass, GROUND_COST.sidewalk, GROUND_COST.road, GROUND_COST.rough];

export interface NavGridOptions {
  width?: number;
  height?: number;
  margin?: number;
  cell?: number;
  pad?: number;
}

const SQRT2 = Math.SQRT2;
const LOS_STEP = 4;

/** Binary min-heap keyed by an external f-score array. */
class MinHeap {
  private items: number[] = [];
  constructor(private readonly f: Float32Array) {}
  get size() { return this.items.length; }
  push(idx: number) {
    const a = this.items;
    a.push(idx);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.f[a[p]] <= this.f[a[i]]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0];
    const last = a.pop() as number;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && this.f[a[l]] < this.f[a[m]]) m = l;
        if (r < a.length && this.f[a[r]] < this.f[a[m]]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

export class NavGrid {
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  readonly width: number;
  readonly height: number;
  readonly margin: number;
  private readonly blocked: Uint8Array;
  private readonly kind: Uint8Array;
  private readonly cost: Float32Array;

  constructor(rects: Rect[], kindAt?: KindSampler, opts: NavGridOptions = {}) {
    this.width = opts.width ?? WORLD_W;
    this.height = opts.height ?? WORLD_H;
    this.margin = opts.margin ?? WORLD_MARGIN;
    this.cell = opts.cell ?? NAV_CELL;
    const pad = opts.pad ?? NAV_PAD;
    this.cols = Math.ceil(this.width / this.cell);
    this.rows = Math.ceil(this.height / this.cell);
    const n = this.cols * this.rows;
    this.blocked = new Uint8Array(n);
    this.kind = new Uint8Array(n);
    this.cost = new Float32Array(n).fill(GROUND_COST.grass);

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const px = (c + 0.5) * this.cell;
        const py = (r + 0.5) * this.cell;
        if (
          px < this.margin || px > this.width - this.margin
          || py < this.margin || py > this.height - this.margin
        ) {
          this.blocked[r * this.cols + c] = 1;
        }
      }
    }
    for (const rect of rects) {
      const c0 = Math.max(0, Math.floor((rect.x - pad) / this.cell));
      const c1 = Math.min(this.cols - 1, Math.floor((rect.x + rect.w + pad) / this.cell));
      const r0 = Math.max(0, Math.floor((rect.y - pad) / this.cell));
      const r1 = Math.min(this.rows - 1, Math.floor((rect.y + rect.h + pad) / this.cell));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const px = (c + 0.5) * this.cell;
          const py = (r + 0.5) * this.cell;
          // Same strict test as TownScene.isBlocked.
          if (px > rect.x - pad && px < rect.x + rect.w + pad && py > rect.y - pad && py < rect.y + rect.h + pad) {
            this.blocked[r * this.cols + c] = 1;
          }
        }
      }
    }
    if (kindAt) {
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          const idx = r * this.cols + c;
          const k = KIND_ID[kindAt((c + 0.5) * this.cell, (r + 0.5) * this.cell)] ?? 0;
          this.kind[idx] = k;
          this.cost[idx] = COST_BY_ID[k];
        }
      }
    }
  }

  /* ── Queries ─────────────────────────────────────────────── */

  private cellOf(px: number, py: number): number {
    const c = Math.floor(px / this.cell);
    const r = Math.floor(py / this.cell);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  private centre(idx: number): Pt {
    const c = idx % this.cols;
    const r = (idx - c) / this.cols;
    return { x: (c + 0.5) * this.cell, y: (r + 0.5) * this.cell };
  }

  isWalkable(px: number, py: number): boolean {
    const idx = this.cellOf(px, py);
    return idx >= 0 && this.blocked[idx] === 0;
  }

  kindAt(px: number, py: number): GroundKind {
    const idx = this.cellOf(px, py);
    return idx < 0 ? "grass" : KIND_NAME[this.kind[idx]];
  }

  /** Asphalt — fine to cross, not a place to stand. */
  isRoad(px: number, py: number): boolean {
    return this.kindAt(px, py) === "road";
  }

  /** Ground cost at a point (1 = sidewalk). Blocked / off-grid → Infinity. */
  costAt(px: number, py: number): number {
    const idx = this.cellOf(px, py);
    if (idx < 0 || this.blocked[idx]) return Infinity;
    return this.cost[idx];
  }

  /** Free cells in every direction before the nearest blocked one (capped);
   *  a rough "how much elbow room is here" measure. */
  clearanceAt(px: number, py: number, maxRings = 6): number {
    const c0 = Math.floor(px / this.cell);
    const r0 = Math.floor(py / this.cell);
    if (!this.isWalkable(px, py)) return 0;
    for (let k = 1; k <= maxRings; k++) {
      for (let dr = -k; dr <= k; dr++) {
        const rr = r0 + dr;
        const edge = Math.abs(dr) === k;
        for (let dc = -k; dc <= k; dc += edge ? 1 : 2 * k) {
          const cc = c0 + dc;
          if (rr < 0 || rr >= this.rows || cc < 0 || cc >= this.cols) return k - 1;
          if (this.blocked[rr * this.cols + cc]) return k - 1;
        }
      }
    }
    return maxRings;
  }

  /**
   * The point itself when walkable, else the centre of the nearest walkable
   * cell within `maxRadius` px (ring scan), else null. With `avoidRoad`,
   * asphalt cells are only used when nothing else is in range.
   */
  nearestWalkable(px: number, py: number, maxRadius = 96, opts?: { avoidRoad?: boolean }): Pt | null {
    const avoidRoad = opts?.avoidRoad ?? false;
    if (this.isWalkable(px, py) && !(avoidRoad && this.isRoad(px, py))) return { x: px, y: py };
    const c0 = Math.floor(px / this.cell);
    const r0 = Math.floor(py / this.cell);
    const K = Math.ceil(maxRadius / this.cell);
    let fallback: Pt | null = null;
    for (let k = 1; k <= K; k++) {
      let best: Pt | null = null;
      let bestD = Infinity;
      for (let dr = -k; dr <= k; dr++) {
        const rr = r0 + dr;
        if (rr < 0 || rr >= this.rows) continue;
        const edge = Math.abs(dr) === k;
        for (let dc = -k; dc <= k; dc += edge ? 1 : 2 * k) {
          const cc = c0 + dc;
          if (cc < 0 || cc >= this.cols) continue;
          const idx = rr * this.cols + cc;
          if (this.blocked[idx]) continue;
          const p = this.centre(idx);
          const d = (p.x - px) ** 2 + (p.y - py) ** 2;
          if (avoidRoad && this.kind[idx] === KIND_ID.road) {
            if (!fallback) fallback = p;
            continue;
          }
          if (d < bestD) { bestD = d; best = p; }
        }
      }
      if (best) return best;
    }
    if (this.isWalkable(px, py)) return { x: px, y: py };
    return fallback;
  }

  /**
   * The roomiest walkable point near (px, py): samples a small lattice
   * within `radius` and picks the cell with the most clearance, breaking
   * ties toward the centre and away from asphalt. Used for open landmarks
   * (parks, plazas) whose geometric centre may sit on a well or a bench.
   */
  openestNear(px: number, py: number, radius = 64): Pt | null {
    let best: Pt | null = null;
    let bestScore = -Infinity;
    const step = this.cell * 2;
    for (let dy = -radius; dy <= radius; dy += step) {
      for (let dx = -radius; dx <= radius; dx += step) {
        const x = px + dx;
        const y = py + dy;
        if (!this.isWalkable(x, y)) continue;
        const clear = this.clearanceAt(x, y, 8);
        const dist = Math.hypot(dx, dy);
        const score = clear * 3 - dist * 0.03 - (this.isRoad(x, y) ? 6 : 0);
        if (score > bestScore) {
          bestScore = score;
          best = { x, y };
        }
      }
    }
    return best ?? this.nearestWalkable(px, py, radius * 2, { avoidRoad: true });
  }

  /** True when the straight segment a→b passes over asphalt — a gathering
   *  on one sidewalk should not spill onto the far side of the street. */
  crossesRoad(a: Pt, b: Pt): boolean {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / LOS_STEP));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (this.isRoad(a.x + dx * t, a.y + dy * t)) return true;
    }
    return false;
  }

  /** True when every interior sample of a→b lands on walkable ground. The
   *  endpoints themselves are exempt so a resident standing on a door apron
   *  (inside the padded zone) can still step straight off it. */
  lineOfSight(a: Pt, b: Pt): boolean {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const steps = Math.ceil(len / LOS_STEP);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (!this.isWalkable(a.x + dx * t, a.y + dy * t)) return false;
    }
    return true;
  }

  /* ── A* ──────────────────────────────────────────────────── */

  /**
   * Smoothed waypoint path from `from` to `to` (world px), excluding `from`.
   * Ends exactly at `to` whenever `to` is (within a cell of) walkable ground,
   * so callers that reserve precise targets keep landing on them. Returns
   * null when no route exists or the search budget is exhausted; callers
   * fall back to a straight line so nothing ever fails to move.
   */
  findPath(from: Pt, to: Pt, opts?: { maxExpansions?: number }): Pt[] | null {
    const goal = this.nearestWalkable(to.x, to.y, 96);
    if (!goal) return null;
    const goalHop = Math.hypot(goal.x - to.x, goal.y - to.y);
    const finalPt = goalHop <= 12 ? to : goal;
    if (this.lineOfSight(from, goal)) return [finalPt];

    const start = this.nearestWalkable(from.x, from.y, 96) ?? from;
    const sIdx = this.cellOf(start.x, start.y);
    const gIdx = this.cellOf(goal.x, goal.y);
    if (sIdx < 0 || gIdx < 0) return null;
    if (sIdx === gIdx) return [finalPt];

    const n = this.cols * this.rows;
    const g = new Float32Array(n).fill(Infinity);
    const f = new Float32Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const gc = gIdx % this.cols;
    const gr = (gIdx - gc) / this.cols;
    const heuristic = (idx: number) => {
      const c = idx % this.cols;
      const r = (idx - c) / this.cols;
      const dx = Math.abs(c - gc);
      const dy = Math.abs(r - gr);
      return (Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy)) * this.cell;
    };
    g[sIdx] = 0;
    f[sIdx] = heuristic(sIdx);
    const open = new MinHeap(f);
    open.push(sIdx);
    const budget = opts?.maxExpansions ?? 24000;
    let expansions = 0;
    let found = false;

    while (open.size > 0) {
      const cur = open.pop();
      if (closed[cur]) continue;
      if (cur === gIdx) { found = true; break; }
      closed[cur] = 1;
      if (++expansions > budget) break;
      const cc = cur % this.cols;
      const cr = (cur - cc) / this.cols;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nc = cc + dc;
          const nr = cr + dr;
          if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
          const nb = nr * this.cols + nc;
          if (this.blocked[nb] || closed[nb]) continue;
          // No corner cutting: a diagonal needs both orthogonal neighbours open.
          if (dr !== 0 && dc !== 0) {
            if (this.blocked[cr * this.cols + nc] || this.blocked[nr * this.cols + cc]) continue;
          }
          const stepLen = (dr !== 0 && dc !== 0 ? SQRT2 : 1) * this.cell;
          const tentative = g[cur] + stepLen * 0.5 * (this.cost[cur] + this.cost[nb]);
          if (tentative >= g[nb]) continue;
          g[nb] = tentative;
          f[nb] = tentative + heuristic(nb);
          came[nb] = cur;
          open.push(nb);
        }
      }
    }
    if (!found) return null;

    // Reconstruct cell centres (goal → start), then string-pull from the
    // sprite's true position so the first leg leaves at a natural angle.
    const cells: Pt[] = [];
    for (let idx = gIdx; idx !== -1 && idx !== sIdx; idx = came[idx]) cells.push(this.centre(idx));
    cells.reverse();
    const pts: Pt[] = [from, ...cells];
    pts[pts.length - 1] = goal;
    const out: Pt[] = [];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !this.lineOfSight(pts[i], pts[j])) j--;
      out.push(pts[j]);
      i = j;
    }
    out[out.length - 1] = finalPt;
    return out;
  }
}

/** Trim a waypoint path so its total length is at most `maxLen` px. */
export function truncatePath(from: Pt, path: Pt[], maxLen: number): Pt[] {
  const out: Pt[] = [];
  let prev = from;
  let budget = maxLen;
  for (const p of path) {
    const len = Math.hypot(p.x - prev.x, p.y - prev.y);
    if (len <= budget) {
      out.push(p);
      budget -= len;
      prev = p;
      continue;
    }
    const t = budget / len;
    out.push({ x: prev.x + (p.x - prev.x) * t, y: prev.y + (p.y - prev.y) * t });
    break;
  }
  return out;
}
