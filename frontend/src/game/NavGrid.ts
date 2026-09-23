/**
 * NavGrid — a walkability grid + A* pathfinder for the 1200×800 town.
 *
 * Built once per town from the tilemap's collision rectangles plus a
 * per-cell GROUND KIND sampled from the tile layers. Walkers keep to
 * sidewalks and paths, cross asphalt only where a crosswalk is painted
 * (asphalt itself is priced so high that any crossing within a few hundred
 * pixels of detour wins), cut across grass when it is worth it, and avoid
 * the rail ballast.
 *
 * Routes are 4-connected with the heading carried in the search state and
 * a small turn penalty, so a walk is a handful of long straight legs with
 * clean 90° corners — the shape a four-direction sprite can actually walk
 * without sliding sideways. Pure module: no Phaser scene dependency.
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
/** A temporary obstacle for one search (a body standing on the route). */
export interface AvoidPt { x: number; y: number; r: number }

/** Ground classes the grid distinguishes (see scripts/mapgen/export_road_gids.py). */
export type GroundKind = "grass" | "sidewalk" | "road" | "rough" | "crosswalk";
export type KindSampler = (px: number, py: number) => GroundKind;

const KIND_ID: Record<GroundKind, number> = { grass: 0, sidewalk: 1, road: 2, rough: 3, crosswalk: 4 };
const KIND_NAME: GroundKind[] = ["grass", "sidewalk", "road", "rough", "crosswalk"];
/** Step-cost multiplier per kind. Sidewalks, paths and crossings are the
 *  baseline; grass is dearer; ballast strongly discouraged; asphalt priced
 *  like a wall with a gate — a 3-tile street is 12 cells, so jaywalking
 *  costs ~1150 px-equivalent and a crosswalk up to ~570 px away still wins.
 *  A town with no crossing on a street is still crossed, once, straight. */
export const GROUND_COST: Record<GroundKind, number> = {
  sidewalk: 1.0, crosswalk: 1.0, grass: 1.6, road: 24, rough: 2.6,
};
const COST_BY_ID = [GROUND_COST.grass, GROUND_COST.sidewalk, GROUND_COST.road, GROUND_COST.rough, GROUND_COST.crosswalk];
/** Cost of changing heading (px-equivalent): fewer, longer legs. */
export const TURN_PENALTY = 6;
/** Heuristic weight. Grass costs 1.6× the baseline the admissible estimate
 *  assumes, so a small weight keeps the search a narrow band along the
 *  route instead of a wide ellipse; routes stay visually optimal (corners
 *  and crossings come from the costs, not the estimate). */
const H_WEIGHT = 1.3;
/** The last hop onto an exact target may be this long and oblique. */
export const FINAL_HOP_PX = 12;

export interface NavGridOptions {
  width?: number;
  height?: number;
  margin?: number;
  cell?: number;
  pad?: number;
}

const LOS_STEP = 4;
/** Headings: up, right, down, left. */
const DIR_DC = [0, 1, 0, -1];
const DIR_DR = [-1, 0, 1, 0];

/** Binary min-heap keyed by an external f-score array. */
class MinHeap {
  private items: number[] = [];
  constructor(private readonly f: Float32Array) {}
  get size() { return this.items.length; }
  clear() { this.items.length = 0; }
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

  // A* scratch over cells, allocated once and stamped per search so a
  // route allocates nothing. `dir` is the heading a cell was reached by,
  // which is what the turn penalty is charged against.
  private readonly g: Float32Array;
  private readonly f: Float32Array;
  private readonly came: Int32Array;
  private readonly dir: Uint8Array;
  private readonly seen: Uint32Array;
  private readonly closed: Uint32Array;
  private readonly heap: MinHeap;
  private generation = 0;
  // BFS scratch (nearestReachable).
  private readonly visited: Uint32Array;
  private readonly queue: Int32Array;

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
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.came = new Int32Array(n);
    this.dir = new Uint8Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.heap = new MinHeap(this.f);
    this.visited = new Uint32Array(n);
    this.queue = new Int32Array(n);

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

  private isRoadIdx(idx: number): boolean {
    const k = this.kind[idx];
    return k === KIND_ID.road || k === KIND_ID.crosswalk;
  }

  /** Asphalt or a crossing — fine to cross, never a place to stand. */
  isRoad(px: number, py: number): boolean {
    const idx = this.cellOf(px, py);
    return idx >= 0 && this.isRoadIdx(idx);
  }

  /** A painted crosswalk (or a rail crossing) — the only asphalt walkers use. */
  isCrossing(px: number, py: number): boolean {
    return this.kindAt(px, py) === "crosswalk";
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
   * asphalt and crossings are only used when nothing else is in range.
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
          if (avoidRoad && this.isRoadIdx(idx)) {
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

  /** True when the straight segment a→b passes over asphalt or a crossing —
   *  a gathering on one sidewalk should not spill onto the far side. */
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

  /** Line of sight that also refuses bare asphalt (crossings are fine) and
   *  the avoid discs — the test a shortcut leg has to pass. */
  private legClear(a: Pt, b: Pt, avoid?: AvoidPt[]): boolean {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(len / LOS_STEP));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = a.x + dx * t;
      const y = a.y + dy * t;
      if (i < steps && !this.isWalkable(x, y)) return false;
      if (this.kindAt(x, y) === "road") return false;
      if (avoid) {
        for (const o of avoid) {
          if (Math.hypot(o.x - x, o.y - y) < o.r) return false;
        }
      }
    }
    return true;
  }

  /* ── A* ──────────────────────────────────────────────────── */

  /**
   * Corner-waypoint path from `from` to `to` (world px), excluding `from`.
   * Every leg is axis-aligned except the final hop onto the exact `to`
   * (≤ FINAL_HOP_PX), so a four-direction sprite never slides. Ends exactly
   * at `to` whenever `to` is (within a cell of) walkable ground. Returns
   * null when no route exists or the search budget is exhausted; callers
   * then stay put or ask for `nearestReachable`.
   */
  findPath(from: Pt, to: Pt, opts?: { maxExpansions?: number; avoid?: AvoidPt[] }): Pt[] | null {
    const goal = this.nearestWalkable(to.x, to.y, 96);
    if (!goal) return null;
    const goalHop = Math.hypot(goal.x - to.x, goal.y - to.y);
    const finalPt = goalHop <= FINAL_HOP_PX ? to : goal;
    const start = this.nearestWalkable(from.x, from.y, 96) ?? from;
    const sIdx = this.cellOf(start.x, start.y);
    const gIdx = this.cellOf(goal.x, goal.y);
    if (sIdx < 0 || gIdx < 0) return null;
    const avoid = opts?.avoid && opts.avoid.length > 0 ? opts.avoid : undefined;
    if (sIdx === gIdx) return this.rectify(from, [finalPt]);

    // Shortcuts: a straight axis-aligned leg, or an L (longer axis first).
    const adx = Math.abs(goal.x - from.x);
    const ady = Math.abs(goal.y - from.y);
    if ((adx < 2 || ady < 2) && this.legClear(from, goal, avoid)) return this.rectify(from, [finalPt]);
    const corner = adx >= ady ? { x: goal.x, y: from.y } : { x: from.x, y: goal.y };
    if (this.isWalkable(corner.x, corner.y) && !this.isRoad(corner.x, corner.y)
      && this.legClear(from, corner, avoid) && this.legClear(corner, goal, avoid)) {
      return this.rectify(from, [corner, finalPt]);
    }

    // Avoid discs → cell set for this search (never the start cell).
    let avoidCells: Set<number> | null = null;
    if (avoid) {
      avoidCells = new Set();
      for (const o of avoid) {
        const k = Math.ceil(o.r / this.cell);
        const c0 = Math.floor(o.x / this.cell);
        const r0 = Math.floor(o.y / this.cell);
        for (let dr = -k; dr <= k; dr++) {
          for (let dc = -k; dc <= k; dc++) {
            const cc = c0 + dc;
            const rr = r0 + dr;
            if (cc < 0 || rr < 0 || cc >= this.cols || rr >= this.rows) continue;
            const idx = rr * this.cols + cc;
            if (idx === sIdx) continue;
            const p = this.centre(idx);
            if (Math.hypot(p.x - o.x, p.y - o.y) < o.r) avoidCells.add(idx);
          }
        }
      }
    }

    const gen = ++this.generation;
    if (gen === 0xffffffff) {
      this.seen.fill(0);
      this.closed.fill(0);
      this.visited.fill(0);
      this.generation = 1;
    }
    const { g, f, came, dir, seen, closed, heap, cols } = this;
    heap.clear();
    const gc = gIdx % cols;
    const gr = (gIdx - gc) / cols;
    const heuristic = (idx: number) => {
      const c = idx % cols;
      const r = (idx - c) / cols;
      return (Math.abs(c - gc) + Math.abs(r - gr)) * this.cell * H_WEIGHT;
    };
    seen[sIdx] = gen;
    g[sIdx] = 0;
    f[sIdx] = heuristic(sIdx);
    came[sIdx] = -1;
    dir[sIdx] = 255;
    heap.push(sIdx);
    const budget = opts?.maxExpansions ?? 120000;
    let expansions = 0;
    let found = false;

    while (heap.size > 0) {
      const cur = heap.pop();
      if (closed[cur] === gen) continue;
      if (cur === gIdx) { found = true; break; }
      closed[cur] = gen;
      if (++expansions > budget) break;
      const heading = dir[cur];
      const cc = cur % cols;
      const cr = (cur - cc) / cols;
      for (let nd = 0; nd < 4; nd++) {
        const nc = cc + DIR_DC[nd];
        const nr = cr + DIR_DR[nd];
        if (nc < 0 || nr < 0 || nc >= cols || nr >= this.rows) continue;
        const nb = nr * cols + nc;
        if (this.blocked[nb] || closed[nb] === gen) continue;
        if (avoidCells && avoidCells.has(nb)) continue;
        const tentative = g[cur]
          + this.cell * 0.5 * (this.cost[cur] + this.cost[nb])
          + (heading !== 255 && nd !== heading ? TURN_PENALTY : 0);
        if (seen[nb] === gen && tentative >= g[nb]) continue;
        seen[nb] = gen;
        g[nb] = tentative;
        f[nb] = tentative + heuristic(nb);
        came[nb] = cur;
        dir[nb] = nd;
        heap.push(nb);
      }
    }
    if (!found) return null;

    // Reconstruct cells (goal → start), then keep only the corners.
    const cells: number[] = [];
    for (let s = gIdx; s !== -1; s = came[s]) cells.push(s);
    cells.reverse();
    const corners: Pt[] = [];
    for (let i = 1; i < cells.length; i++) {
      const prev = cells[i - 1];
      const cur = cells[i];
      const next = cells[i + 1];
      if (next === undefined) { corners.push(this.centre(cur)); break; }
      const d1 = cur - prev;
      const d2 = next - cur;
      if (d1 !== d2) corners.push(this.centre(cur));
    }
    if (corners.length === 0) corners.push(goal);
    corners[corners.length - 1] = finalPt;
    return this.rectify(from, corners);
  }

  /**
   * Guarantee axis-aligned legs. Corners are cell centres while `from` and
   * the exact target are not, so the first and last legs can be a couple
   * of pixels oblique: snap the first corner onto the walker's own axis and
   * the last onto the target's, then bend any leg that is still oblique
   * into an L (the final hop excepted when it is short).
   */
  private rectify(from: Pt, pts: Pt[]): Pt[] {
    const out: Pt[] = pts.map((p) => ({ x: p.x, y: p.y }));
    if (out.length >= 2) {
      // First leg: move along the walker's own axis, then step onto the corner.
      const c1 = out[0];
      const vertical = Math.abs(c1.y - from.y) >= Math.abs(c1.x - from.x);
      if (vertical) c1.x = from.x; else c1.y = from.y;
    }
    const result: Pt[] = [];
    let prev = from;
    for (let i = 0; i < out.length; i++) {
      const p = out[i];
      const dx = Math.abs(p.x - prev.x);
      const dy = Math.abs(p.y - prev.y);
      const last = i === out.length - 1;
      if (dx > 0.5 && dy > 0.5 && !(last && Math.hypot(dx, dy) <= FINAL_HOP_PX)) {
        // Bend into an L, keeping the leg's dominant axis first.
        const mid = dy >= dx ? { x: prev.x, y: p.y } : { x: p.x, y: prev.y };
        if (mid.x !== prev.x || mid.y !== prev.y) result.push(mid);
      }
      if (p.x !== prev.x || p.y !== prev.y || last) result.push(p);
      prev = p;
    }
    return result;
  }

  /**
   * Nearest reachable point to `to` when `to` itself is walled off: a
   * bounded BFS from `from` over walkable cells returning the centre of the
   * visited cell closest to `to`. Returns `from` when nothing is better.
   */
  nearestReachable(from: Pt, to: Pt, maxRadius = 400): Pt | null {
    const start = this.nearestWalkable(from.x, from.y, 96) ?? from;
    const sIdx = this.cellOf(start.x, start.y);
    if (sIdx < 0) return null;
    const gen = ++this.generation;
    const { visited, queue, cols } = this;
    const sc = sIdx % cols;
    const sr = (sIdx - sc) / cols;
    const K = Math.ceil(maxRadius / this.cell);
    let head = 0;
    let tail = 0;
    queue[tail++] = sIdx;
    visited[sIdx] = gen;
    let best = sIdx;
    let bestD = Infinity;
    const tc = Math.floor(to.x / this.cell);
    const tr = Math.floor(to.y / this.cell);
    while (head < tail) {
      const cur = queue[head++];
      const c = cur % cols;
      const r = (cur - c) / cols;
      const d = (c - tc) ** 2 + (r - tr) ** 2;
      if (d < bestD) { bestD = d; best = cur; }
      if (d <= 1) break;
      for (let nd = 0; nd < 4; nd++) {
        const nc = c + DIR_DC[nd];
        const nr = r + DIR_DR[nd];
        if (nc < 0 || nr < 0 || nc >= cols || nr >= this.rows) continue;
        if (Math.abs(nc - sc) > K || Math.abs(nr - sr) > K) continue;
        const nb = nr * cols + nc;
        if (this.blocked[nb] || visited[nb] === gen) continue;
        visited[nb] = gen;
        queue[tail++] = nb;
      }
    }
    return best === sIdx ? { x: from.x, y: from.y } : this.centre(best);
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
