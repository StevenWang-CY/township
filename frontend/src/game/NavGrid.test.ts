import { describe, expect, it } from "vitest";
import { NavGrid, type GroundKind, type Pt, type Rect } from "./NavGrid";

/** A town-shaped test world: a 48 px street across the middle with 16 px
 *  sidewalks either side, crosswalks at x≈300 and x≈900, grass elsewhere. */
function streetTown(opts: { crosswalks?: boolean; rects?: Rect[] } = {}) {
  const crosswalks = opts.crosswalks ?? true;
  const kindAt = (px: number, py: number): GroundKind => {
    const onStreet = py >= 376 && py < 424;
    if (onStreet) {
      if (crosswalks && ((px >= 296 && px < 312) || (px >= 896 && px < 912))) return "crosswalk";
      return "road";
    }
    if ((py >= 360 && py < 376) || (py >= 424 && py < 440)) return "sidewalk";
    return "grass";
  };
  return new NavGrid(opts.rects ?? [], kindAt);
}

function legs(from: Pt, path: Pt[]) {
  const out: Array<{ a: Pt; b: Pt; dx: number; dy: number; len: number; last: boolean }> = [];
  let prev = from;
  path.forEach((p, i) => {
    const dx = Math.abs(p.x - prev.x);
    const dy = Math.abs(p.y - prev.y);
    out.push({ a: prev, b: p, dx, dy, len: Math.hypot(dx, dy), last: i === path.length - 1 });
    prev = p;
  });
  return out;
}

function expectAxisAligned(from: Pt, path: Pt[]) {
  for (const leg of legs(from, path)) {
    const oblique = leg.dx > 0.5 && leg.dy > 0.5;
    if (oblique && !(leg.last && leg.len <= 12.5)) {
      throw new Error(`oblique leg ${leg.a.x},${leg.a.y} -> ${leg.b.x},${leg.b.y}`);
    }
  }
}

function samples(from: Pt, path: Pt[], step = 4): Pt[] {
  const pts: Pt[] = [];
  let prev = from;
  for (const p of path) {
    const len = Math.hypot(p.x - prev.x, p.y - prev.y);
    const n = Math.max(1, Math.ceil(len / step));
    for (let i = 1; i <= n; i++) pts.push({ x: prev.x + (p.x - prev.x) * (i / n), y: prev.y + (p.y - prev.y) * (i / n) });
    prev = p;
  }
  return pts;
}

describe("NavGrid paths", () => {
  it("returns only axis-aligned legs (final hop excepted)", () => {
    const grid = streetTown({ rects: [{ x: 500, y: 100, w: 120, h: 80 }, { x: 700, y: 520, w: 60, h: 160 }] });
    const pairs: Array<[Pt, Pt]> = [
      [{ x: 100, y: 100 }, { x: 700, y: 300 }],
      [{ x: 450, y: 90 }, { x: 650, y: 210 }],
      [{ x: 122, y: 613 }, { x: 1013, y: 601 }],
      [{ x: 640, y: 480 }, { x: 800, y: 700 }],
      [{ x: 61, y: 61 }, { x: 1139, y: 739 }],
    ];
    for (const [a, b] of pairs) {
      const path = grid.findPath(a, b);
      expect(path, `${a.x},${a.y} -> ${b.x},${b.y}`).not.toBeNull();
      expectAxisAligned(a, path!);
      const end = path![path!.length - 1];
      expect(Math.hypot(end.x - b.x, end.y - b.y)).toBeLessThanOrEqual(12.5);
    }
  });

  it("crosses open grass with a single corner", () => {
    const grid = streetTown();
    const path = grid.findPath({ x: 100, y: 100 }, { x: 700, y: 300 })!;
    expectAxisAligned({ x: 100, y: 100 }, path);
    const turns = legs({ x: 100, y: 100 }, path).filter((l) => l.len > 0.5).length - 1;
    expect(turns).toBeLessThanOrEqual(1);
    expect(path[path.length - 1]).toEqual({ x: 700, y: 300 });
  });

  it("crosses the street only at a crosswalk", () => {
    const grid = streetTown();
    const from = { x: 100, y: 200 };
    const to = { x: 100, y: 600 };
    const path = grid.findPath(from, to)!;
    expect(path).not.toBeNull();
    expectAxisAligned(from, path);
    const onAsphalt = samples(from, path).filter((p) => grid.isRoad(p.x, p.y));
    expect(onAsphalt.length).toBeGreaterThan(0);
    for (const p of onAsphalt) expect(grid.isCrossing(p.x, p.y), `${p.x},${p.y} is bare asphalt`).toBe(true);
    // The nearer crossing (x≈304) is the one used.
    expect(Math.abs(onAsphalt[0].x - 304)).toBeLessThanOrEqual(8);
  });

  it("crosses a street with no crosswalk exactly once, straight across", () => {
    const grid = streetTown({ crosswalks: false });
    const from = { x: 100, y: 200 };
    const path = grid.findPath(from, { x: 100, y: 600 })!;
    expect(path).not.toBeNull();
    const onAsphalt = samples(from, path).filter((p) => grid.isRoad(p.x, p.y));
    expect(onAsphalt.length).toBeGreaterThan(0);
    const xs = new Set(onAsphalt.map((p) => Math.round(p.x)));
    expect(xs.size, "the crossing is one straight run").toBe(1);
  });

  it("returns null when walled off and offers the nearest reachable point", () => {
    // A closed box around the goal.
    const rects: Rect[] = [
      { x: 560, y: 560, w: 200, h: 8 }, { x: 560, y: 760, w: 200, h: 8 },
      { x: 560, y: 560, w: 8, h: 208 }, { x: 752, y: 560, w: 8, h: 208 },
    ];
    const grid = streetTown({ rects });
    const from = { x: 100, y: 660 };
    const to = { x: 660, y: 660 };
    expect(grid.findPath(from, to)).toBeNull();
    const near = grid.nearestReachable(from, to)!;
    expect(near).not.toBeNull();
    expect(Math.hypot(near.x - to.x, near.y - to.y)).toBeLessThan(Math.hypot(from.x - to.x, from.y - to.y));
    expect(grid.isWalkable(near.x, near.y)).toBe(true);
  });

  it("bends around an avoid point on the straight route", () => {
    const grid = streetTown();
    const from = { x: 100, y: 100 };
    const to = { x: 500, y: 100 };
    const direct = grid.findPath(from, to)!;
    expect(direct.every((p) => p.y === 100)).toBe(true);
    const path = grid.findPath(from, to, { avoid: [{ x: 300, y: 100, r: 14 }] })!;
    expect(path).not.toBeNull();
    expectAxisAligned(from, path);
    expect(path.some((p) => Math.abs(p.y - 100) > 10)).toBe(true);
    for (const p of samples(from, path)) expect(Math.hypot(p.x - 300, p.y - 100)).toBeGreaterThanOrEqual(10);
    expect(path[path.length - 1]).toEqual(to);
  });

  it("keeps a junction corner passable around a pole-sized prop", () => {
    // A 5x11 px pole post on the sidewalk corner between the crosswalk
    // at x≈300 and the sidewalk: full 5 px padding would seal the cells that
    // join them and push the walk onto the asphalt beside the paint.
    const pole: Rect = { x: 313.6, y: 364.8, w: 4.8, h: 11.2 };
    const grid = streetTown({ rects: [pole] });
    const path = grid.findPath({ x: 318, y: 368 }, { x: 318, y: 432 });
    expect(path).not.toBeNull();
    expect(grid.touchesRoad({ x: 318, y: 368 }, path!)).toBe(false);
    // The prop itself still blocks.
    expect(grid.isWalkable(316, 370)).toBe(false);
  });

  it("keeps the wall-side sidewalk row open past a shopfront prop", () => {
    // A shopfront whose foot is the sidewalk's top edge, and a mailbox on
    // the pavement in front of it. The wall's clearance band would block
    // the top row and the box the other three, sealing the pavement and
    // forcing the walk onto the kerb — pavement cells take no clearance.
    const wall: Rect = { x: 150, y: 300, w: 300, h: 60 };
    const box: Rect = { x: 290, y: 364.8, w: 12.8, h: 11.2 };
    const grid = streetTown({ rects: [wall, box] });
    const from = { x: 200, y: 368 };
    const to = { x: 400, y: 368 };
    const path = grid.findPath(from, to);
    expect(path).not.toBeNull();
    expect(grid.touchesRoad(from, path!)).toBe(false);
    // The wall itself and the box itself still block; grass beside a wall keeps its clearance.
    expect(grid.isWalkable(300, 350)).toBe(false);
    expect(grid.isWalkable(296, 370)).toBe(false);
    const lawnGrid = streetTown({ rects: [{ x: 500, y: 100, w: 100, h: 100 }] });
    expect(lawnGrid.isWalkable(602, 150)).toBe(false);
    expect(lawnGrid.isWalkable(610, 150)).toBe(true);
  });

  it("refuses a detour that would step onto the asphalt (noRoad)", () => {
    // A shopfront wall the whole length of the south sidewalk: the pavement
    // is 16 px between the wall and the kerb, as in front of a storefront
    // strip, and there is no way round the back.
    const grid = streetTown({ rects: [{ x: 0, y: 440, w: 1200, h: 60 }] });
    const from = { x: 200, y: 432 };
    const to = { x: 400, y: 432 };
    // Someone standing on the sidewalk right on the route: the only way
    // round is over the kerb.
    const avoid = [{ x: 300, y: 432, r: 14 }];
    const detour = grid.findPath(from, to, { avoid });
    expect(detour).not.toBeNull();
    expect(grid.touchesRoad(from, detour!)).toBe(true);
    expect(grid.findPath(from, to, { avoid, noRoad: true })).toBeNull();
    // Without the obstacle the same walk is plain pavement.
    const clear = grid.findPath(from, to, { noRoad: true });
    expect(clear).not.toBeNull();
  });

  it("walks across a lot like pavement and never counts it as street", () => {
    const kindAt = (px: number, py: number): GroundKind => (px >= 400 && px < 600 && py >= 300 && py < 400 ? "lot" : "grass");
    const grid = new NavGrid([], kindAt);
    const from = { x: 380, y: 350 };
    const path = grid.findPath(from, { x: 620, y: 350 }, { noRoad: true });
    expect(path).not.toBeNull();
    expect(grid.touchesRoad(from, path!)).toBe(false);
    expect(grid.isRoad(500, 350)).toBe(false);
    expect(grid.kindAt(500, 350)).toBe("lot");
    expect(grid.costAt(500, 350)).toBeLessThan(grid.costAt(100, 100));
  });

  it("classifies crossings", () => {
    const grid = streetTown();
    expect(grid.isRoad(304, 400)).toBe(true);
    expect(grid.isCrossing(304, 400)).toBe(true);
    expect(grid.isRoad(500, 400)).toBe(true);
    expect(grid.isCrossing(500, 400)).toBe(false);
    expect(grid.isRoad(500, 368)).toBe(false);
    expect(grid.kindAt(500, 368)).toBe("sidewalk");
  });

  it("is deterministic and fast on a Dover-sized world", () => {
    let seed = 12345;
    const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const rects: Rect[] = [];
    for (let i = 0; i < 100; i++) {
      rects.push({ x: 60 + rng() * 1040, y: 60 + rng() * 640, w: 24 + rng() * 96, h: 24 + rng() * 96 });
    }
    // Keep the corners open.
    const grid = streetTown({ rects: rects.filter((r) => !(r.x < 140 && r.y < 140) && !(r.x + r.w > 1060 && r.y + r.h > 660)) });
    const from = { x: 61, y: 61 };
    const to = { x: 1139, y: 739 };
    const a = grid.findPath(from, to);
    const b = grid.findPath(from, to);
    expect(a).toEqual(b);
    if (a) expectAxisAligned(from, a);
    // Median of 20 corner-to-corner searches; a laptop under load still
    // clears this by a wide margin (≈5 ms warm on this world).
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      grid.findPath(from, to);
      times.push(performance.now() - t0);
    }
    times.sort((x, y) => x - y);
    expect(times[10]).toBeLessThan(40);
  });
});
