/**
 * Spots — where a resident stands when they are "at" a landmark.
 *
 * The map generator authors standing spots per landmark (door apron, porch
 * steps, the cell before a window, bench seats, patio stools, market stalls,
 * platform edge, park lawn, the polling queue, and facing chat pairs) as
 * anchors of kind `spot`. This registry hands them out deterministically:
 * the same residents arriving at the same place in the same order always
 * take the same spots, so a replay seek re-derives an identical town.
 *
 * When a landmark's spots are full, overflow points are blue-noise samples
 * around its apron (best-candidate: the sample farthest from every body
 * already standing there), so a crowd spreads instead of stacking.
 *
 * Pure module — no Phaser. The scene injects `isFree(x, y)` (not blocked,
 * not asphalt) so the sampler never picks a wall or the road.
 */
import type { Pt } from "./NavGrid";
import { fnv1a, mulberry32 } from "../lib/hash";

export type SpotRole =
  | "door" | "porch" | "window" | "chat" | "bench" | "table"
  | "stall" | "platform" | "lawn" | "queue";
export type SpotFacing = "up" | "down" | "left" | "right" | "face";
export type Facing = Exclude<SpotFacing, "face">;
/** A resident holds at most one placement per kind: where they dwell, a
 *  conversation slot, and a place in the polling queue. */
export type PlacementKind = "dwell" | "chat" | "queue";

export interface Spot {
  id: string;
  landmark: string;
  role: SpotRole;
  x: number;
  y: number;
  facing: SpotFacing;
  cap: number;
  order: number;
  pair?: string;
  side?: "a" | "b";
}

export interface Placement {
  agentId: string;
  kind: PlacementKind;
  landmark: string;
  x: number;
  y: number;
  /** Resolved facing ("face" pairs resolve toward the partner at runtime). */
  facing?: Facing;
  /** The authored spot, or null for a blue-noise overflow point. */
  spot: Spot | null;
  overflow: boolean;
}

/** The shape TownScene.buildTilemap produces for every anchor object. */
export interface AnchorLike {
  kind: string;
  x: number;
  y: number;
  name?: string;
  props?: Record<string, string>;
}

const ROLES: ReadonlySet<string> = new Set([
  "door", "porch", "window", "chat", "bench", "table", "stall", "platform", "lawn", "queue",
]);
const FACINGS: ReadonlySet<string> = new Set(["up", "down", "left", "right", "face"]);

/** Parse the `spot` anchors out of a tilemap's anchor objects. */
export function spotsFromAnchors(anchors: AnchorLike[]): Spot[] {
  const out: Spot[] = [];
  for (const a of anchors) {
    if (a.kind !== "spot") continue;
    const props = a.props ?? {};
    const landmark = a.name ?? props.name ?? "";
    const role = props.role ?? "";
    if (!landmark || !ROLES.has(role)) continue;
    const facing = FACINGS.has(props.facing ?? "") ? (props.facing as SpotFacing) : "down";
    const order = Number.parseInt(props.order ?? "0", 10);
    const cap = Math.max(1, Number.parseInt(props.cap ?? "1", 10) || 1);
    out.push({
      id: `${landmark}#${role}#${Number.isFinite(order) ? order : out.length}`,
      landmark,
      role: role as SpotRole,
      x: a.x,
      y: a.y,
      facing,
      cap,
      order: Number.isFinite(order) ? order : out.length,
      pair: props.pair || undefined,
      side: props.side === "a" || props.side === "b" ? props.side : undefined,
    });
  }
  // Stable order: by landmark, then authored order — the registry's choice
  // must not depend on the tilemap's object order.
  out.sort((p, q) => (p.landmark < q.landmark ? -1 : p.landmark > q.landmark ? 1 : p.order - q.order));
  return out;
}

export interface ReserveOptions {
  /** Recorded coordinate the placement must stay near (replay envelope). */
  near?: Pt;
  envelope?: { dx: number; dy: number };
  kind?: PlacementKind;
  /** Centre for overflow sampling when the landmark has no usable spot. */
  apron?: Pt;
  /** Do not consume the spot's capacity (residents indoors all "hold" the
   *  door without blocking it). */
  shared?: boolean;
  /** Minimum distance an overflow point keeps from every placed body. */
  clearOf?: number;
}

const DEFAULT_CLEAR = 34;
const APRON_BOX = 96;
/** Two standing residents keep at least this apart (a facing chat pair is
 *  32 px): an authored spot this close to an occupied one waits its turn. */
const SPOT_CLEAR = 26;

export class SpotRegistry {
  private readonly byLandmark = new Map<string, Spot[]>();
  private readonly byId = new Map<string, Spot>();
  /** spot id → agent ids consuming its capacity. */
  private readonly holders = new Map<string, Set<string>>();
  /** agent id → kind → placement. */
  private readonly placements = new Map<string, Map<PlacementKind, Placement>>();

  constructor(
    spots: Spot[],
    private readonly isFree: (x: number, y: number) => boolean,
    /** Can a walker get from the landmark's apron to this point on the
     *  pavement? Without it, any free ground in the box will do; with it,
     *  no overflow seat lands in a service yard behind a hedge that only
     *  the street reaches. */
    private readonly reachable?: (from: Pt, to: Pt) => boolean,
  ) {
    for (const s of spots) {
      this.byId.set(s.id, s);
      const list = this.byLandmark.get(s.landmark) ?? [];
      list.push(s);
      this.byLandmark.set(s.landmark, list);
    }
  }

  /* ── Queries ─────────────────────────────────────────────── */

  landmarks(): string[] { return [...this.byLandmark.keys()]; }

  spotsOf(landmark: string, role?: SpotRole): Spot[] {
    const list = this.byLandmark.get(landmark) ?? [];
    return role ? list.filter((s) => s.role === role) : list.slice();
  }

  /** The door apron of a building (undefined for open landmarks). */
  doorOf(landmark: string): Pt | undefined {
    const door = this.spotsOf(landmark, "door")[0];
    return door ? { x: door.x, y: door.y } : undefined;
  }

  placementOf(agentId: string, kind: PlacementKind = "dwell"): Placement | undefined {
    return this.placements.get(agentId)?.get(kind);
  }

  /** Residents dwelling at a landmark (any spot or overflow there). */
  agentsAt(landmark: string): string[] {
    const out: string[] = [];
    for (const [id, kinds] of this.placements) {
      if (kinds.get("dwell")?.landmark === landmark) out.push(id);
    }
    return out;
  }

  occupancyOf(landmark: string): number { return this.agentsAt(landmark).length; }

  private isSpotFree(spot: Spot, forAgent: string): boolean {
    const held = this.holders.get(spot.id);
    if (held && held.size >= spot.cap && !held.has(forAgent)) return false;
    return this.clearOfOthers(spot, forAgent);
  }

  /** No one else (bar the agent's own placements and a chat partner in the
   *  same pair) stands within SPOT_CLEAR of the spot: doorstep roles are
   *  authored 16–24 px apart, and a crowd fills them one at a time. */
  private clearOfOthers(spot: Spot, forAgent: string, partner?: string): boolean {
    for (const [id, kinds] of this.placements) {
      if (id === forAgent || id === partner) continue;
      for (const p of kinds.values()) {
        if (p.spot?.pair && p.spot.pair === spot.pair) continue;
        if (Math.hypot(p.x - spot.x, p.y - spot.y) < SPOT_CLEAR) return false;
      }
    }
    return true;
  }

  /** Every occupied point (all kinds) except the agent's own. */
  private occupiedPoints(except?: string): Pt[] {
    const pts: Pt[] = [];
    for (const [id, kinds] of this.placements) {
      if (id === except) continue;
      for (const p of kinds.values()) pts.push({ x: p.x, y: p.y });
    }
    return pts;
  }

  /* ── Reservation ─────────────────────────────────────────── */

  private record(p: Placement) {
    let kinds = this.placements.get(p.agentId);
    if (!kinds) {
      kinds = new Map();
      this.placements.set(p.agentId, kinds);
    }
    kinds.set(p.kind, p);
  }

  private hold(spot: Spot, agentId: string) {
    let held = this.holders.get(spot.id);
    if (!held) {
      held = new Set();
      this.holders.set(spot.id, held);
    }
    held.add(agentId);
  }

  /**
   * Claim a spot of one of `roles` (in priority order) at `landmark` for
   * the agent, or a blue-noise overflow point near its apron. Deterministic:
   * candidates with free capacity are ordered by role priority, then by a
   * hash of (agent, landmark, spot), so the same crowd always sits the same
   * way; a `near` + `envelope` filter keeps replayed residents inside the
   * recorded coordinate's neighbourhood.
   */
  reserve(landmark: string, agentId: string, roles: SpotRole[], opts: ReserveOptions = {}): Placement {
    const kind = opts.kind ?? "dwell";
    const existing = this.placementOf(agentId, kind);
    if (existing) this.release(agentId, kind);

    const inEnvelope = (s: Pt) =>
      !opts.near || !opts.envelope
      || (Math.abs(s.x - opts.near.x) <= opts.envelope.dx && Math.abs(s.y - opts.near.y) <= opts.envelope.dy);
    const list = this.byLandmark.get(landmark) ?? [];
    const candidates = list
      .filter((s) => roles.includes(s.role) && inEnvelope(s) && (opts.shared || this.isSpotFree(s, agentId)))
      .map((s) => ({ s, pri: roles.indexOf(s.role), h: fnv1a(`${agentId}|${landmark}|${s.id}`) }))
      .sort((a, b) => a.pri - b.pri || a.h - b.h || a.s.order - b.s.order);
    const pick = candidates[0]?.s;
    if (pick) {
      if (!opts.shared) this.hold(pick, agentId);
      const p: Placement = {
        agentId, kind, landmark, x: pick.x, y: pick.y,
        facing: pick.facing === "face" ? undefined : pick.facing,
        spot: pick, overflow: false,
      };
      this.record(p);
      return p;
    }
    // Overflow samples spread from the apron (the door, or the walkable
    // ground nearest a recorded coordinate — the caller's choice), while
    // the recorded coordinate itself only bounds them: a landmark rect's
    // corner may sit on the street.
    const centre = opts.apron ?? opts.near ?? this.doorOf(landmark) ?? this.centroidOf(landmark) ?? { x: 600, y: 400 };
    const pt = this.sampleApron(landmark, agentId, centre, {
      minDist: opts.clearOf ?? DEFAULT_CLEAR,
      envelope: opts.near && opts.envelope ? { near: opts.near, ...opts.envelope } : undefined,
    });
    const p: Placement = { agentId, kind, landmark, x: pt.x, y: pt.y, facing: undefined, spot: null, overflow: true };
    this.record(p);
    return p;
  }

  /** Pin an explicit point as a placement (a legacy formation slot, a
   *  computed queue position) so later overflow samples avoid it. */
  reserveAt(landmark: string, agentId: string, pt: Pt, kind: PlacementKind = "dwell", facing?: Facing): Placement {
    if (this.placementOf(agentId, kind)) this.release(agentId, kind);
    const p: Placement = { agentId, kind, landmark, x: pt.x, y: pt.y, facing, spot: null, overflow: true };
    this.record(p);
    return p;
  }

  /**
   * A facing pair for a conversation at `landmark`: the free chat pair
   * nearest `near` (ids[0] takes side a, the western spot). Without one,
   * two points 32 px apart on free ground near the apron.
   */
  reserveChatPair(landmark: string, ids: [string, string], near?: Pt): [Placement, Placement] {
    for (const id of ids) this.release(id, "chat");
    const chats = this.spotsOf(landmark, "chat");
    const pairs = new Map<string, Spot[]>();
    for (const s of chats) {
      if (!s.pair) continue;
      const list = pairs.get(s.pair) ?? [];
      list.push(s);
      pairs.set(s.pair, list);
    }
    let best: Spot[] | null = null;
    let bestD = Infinity;
    for (const list of pairs.values()) {
      const a = list.find((s) => s.side === "a");
      const b = list.find((s) => s.side === "b");
      if (!a || !b) continue;
      if (!this.isSpotFree(a, ids[0]) || !this.isSpotFree(b, ids[1])) continue;
      if (!this.clearOfOthers(a, ids[0], ids[1]) || !this.clearOfOthers(b, ids[1], ids[0])) continue;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const d = near ? Math.hypot(mx - near.x, my - near.y) : 0;
      if (d < bestD) { bestD = d; best = [a, b]; }
    }
    if (best) {
      const [a, b] = best;
      this.hold(a, ids[0]);
      this.hold(b, ids[1]);
      const pa: Placement = { agentId: ids[0], kind: "chat", landmark, x: a.x, y: a.y, facing: "right", spot: a, overflow: false };
      const pb: Placement = { agentId: ids[1], kind: "chat", landmark, x: b.x, y: b.y, facing: "left", spot: b, overflow: false };
      this.record(pa);
      this.record(pb);
      return [pa, pb];
    }
    // Overflow pair: flank a free midpoint by 16 px each side.
    const centre = near ?? this.doorOf(landmark) ?? this.centroidOf(landmark) ?? { x: 600, y: 400 };
    const mid = this.sampleApron(landmark, `${ids[0]}+${ids[1]}`, centre, { minDist: 40, needsWidth: 32 });
    const pa: Placement = { agentId: ids[0], kind: "chat", landmark, x: mid.x - 16, y: mid.y, facing: "right", spot: null, overflow: true };
    const pb: Placement = { agentId: ids[1], kind: "chat", landmark, x: mid.x + 16, y: mid.y, facing: "left", spot: null, overflow: true };
    this.record(pa);
    this.record(pb);
    return [pa, pb];
  }

  /** A pair plus nearby standing spots (porch, lawn, bench…) for a group;
   *  everyone faces the group's centroid at runtime. */
  reserveCluster(landmark: string, ids: string[], near: Pt): Placement[] {
    if (ids.length === 0) return [];
    if (ids.length === 1) {
      return [this.reserve(landmark, ids[0], ["porch", "lawn", "bench", "table", "platform", "window"], { near, envelope: { dx: 48, dy: 48 }, kind: "chat", apron: near })];
    }
    const [pa, pb] = this.reserveChatPair(landmark, [ids[0], ids[1]], near);
    const out = [pa, pb];
    const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
    for (const id of ids.slice(2)) {
      out.push(this.reserve(landmark, id, ["porch", "lawn", "bench", "table", "platform", "window"], {
        near: mid, envelope: { dx: 48, dy: 48 }, kind: "chat", apron: mid, clearOf: 30,
      }));
    }
    return out;
  }

  release(agentId: string, kind?: PlacementKind) {
    const kinds = this.placements.get(agentId);
    if (!kinds) return;
    const drop = kind ? [kind] : [...kinds.keys()];
    for (const k of drop) {
      const p = kinds.get(k);
      if (!p) continue;
      if (p.spot) this.holders.get(p.spot.id)?.delete(agentId);
      kinds.delete(k);
    }
    if (kinds.size === 0) this.placements.delete(agentId);
  }

  clear() {
    this.holders.clear();
    this.placements.clear();
  }

  /* ── Overflow sampling ───────────────────────────────────── */

  private centroidOf(landmark: string): Pt | undefined {
    const list = this.byLandmark.get(landmark);
    if (!list || list.length === 0) return undefined;
    let x = 0;
    let y = 0;
    for (const s of list) { x += s.x; y += s.y; }
    return { x: x / list.length, y: y / list.length };
  }

  /**
   * Best-candidate blue noise around `centre`: 16 seeded samples in a box,
   * keep the free ones at least `minDist` from every placed body, return
   * the one that maximises that minimum distance. Widens the box when
   * nothing qualifies; falls back to the centre itself.
   */
  sampleApron(
    landmark: string,
    agentId: string,
    centre: Pt,
    opts: { minDist?: number; box?: number; envelope?: { near: Pt; dx: number; dy: number }; needsWidth?: number } = {},
  ): Pt {
    const minDist = opts.minDist ?? DEFAULT_CLEAR;
    const rng = mulberry32(fnv1a(`${landmark}|${agentId}`));
    const occupied = this.occupiedPoints(agentId);
    // Reachability is judged from the centre when the centre is standable
    // ground; a road landmark's apron is the asphalt itself, and from there
    // any free ground nearby will do.
    const reachFrom = this.reachable && this.isFree(centre.x, centre.y) ? this.reachable : undefined;
    const okFree = (x: number, y: number) => {
      if (!this.isFree(x, y)) return false;
      if (opts.needsWidth) {
        const half = opts.needsWidth / 2;
        if (!this.isFree(x - half, y) || !this.isFree(x + half, y)) return false;
      }
      if (opts.envelope) {
        const e = opts.envelope;
        if (Math.abs(x - e.near.x) > e.dx || Math.abs(y - e.near.y) > e.dy) return false;
      }
      if (reachFrom && !reachFrom(centre, { x, y })) return false;
      return true;
    };
    let box = opts.box ?? APRON_BOX;
    for (let widen = 0; widen < 3; widen++) {
      let best: Pt | null = null;
      let bestScore = -Infinity;
      let fallback: Pt | null = null;
      let fallbackScore = -Infinity;
      for (let i = 0; i < 16; i++) {
        const x = Math.round(centre.x + (rng() - 0.5) * box);
        const y = Math.round(centre.y + (rng() - 0.5) * box * 0.7);
        if (!okFree(x, y)) continue;
        let nearest = Infinity;
        for (const o of occupied) nearest = Math.min(nearest, Math.hypot(o.x - x, o.y - y));
        // Prefer samples that keep their distance AND stay close to the centre.
        const score = Math.min(nearest, minDist * 2) - Math.hypot(x - centre.x, y - centre.y) * 0.15;
        if (nearest >= minDist && score > bestScore) { bestScore = score; best = { x, y }; }
        if (score > fallbackScore) { fallbackScore = score; fallback = { x, y }; }
      }
      if (best) return best;
      if (widen === 2 && fallback) return fallback;
      box = Math.round(box * 1.5);
    }
    // Nothing sampled was free (a road landmark's apron is the asphalt
    // itself): ring-search for the nearest free ground before giving up.
    for (let radius = 16; radius <= 160; radius += 8) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const x = Math.round(centre.x + Math.cos(a) * radius);
        const y = Math.round(centre.y + Math.sin(a) * radius);
        if (this.isFree(x, y) && (!reachFrom || reachFrom(centre, { x, y }))) return { x, y };
      }
    }
    return { x: centre.x, y: centre.y };
  }
}
