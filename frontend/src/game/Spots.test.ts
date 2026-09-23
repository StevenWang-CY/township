import { describe, expect, it } from "vitest";
import { SpotRegistry, spotsFromAnchors, type AnchorLike, type Spot } from "./Spots";

function anchor(name: string, role: string, x: number, y: number, extra: Record<string, string> = {}): AnchorLike {
  return { kind: "spot", x, y, name, props: { kind: "spot", role, facing: extra.facing ?? "down", cap: "1", order: extra.order ?? "0", ...extra } };
}

const LIBRARY: AnchorLike[] = [
  anchor("Public Library", "door", 600, 500, { facing: "up", order: "0" }),
  anchor("Public Library", "porch", 568, 500, { order: "1" }),
  anchor("Public Library", "porch", 632, 500, { order: "2" }),
  anchor("Public Library", "window", 552, 500, { facing: "up", order: "3" }),
  anchor("Public Library", "chat", 584, 516, { facing: "face", order: "4", pair: "Public Library#0", side: "a" }),
  anchor("Public Library", "chat", 616, 516, { facing: "face", order: "5", pair: "Public Library#0", side: "b" }),
  anchor("Public Library", "queue", 560, 516, { facing: "up", order: "6" }),
  anchor("Public Library", "queue", 528, 516, { facing: "up", order: "7" }),
  anchor("Public Library", "queue", 496, 516, { facing: "up", order: "8" }),
  anchor("Town Park", "lawn", 300, 640, { order: "0" }),
  anchor("Town Park", "lawn", 340, 660, { order: "1" }),
  anchor("Town Park", "bench", 380, 640, { order: "2" }),
  { kind: "lamp", x: 1, y: 1 },
];

const free = () => true;

describe("spotsFromAnchors", () => {
  it("parses only spot anchors with a landmark and a known role", () => {
    const spots = spotsFromAnchors(LIBRARY);
    expect(spots).toHaveLength(12);
    expect(spots.every((s: Spot) => s.landmark && s.role)).toBe(true);
    const pair = spots.filter((s) => s.role === "chat");
    expect(pair.map((s) => s.side)).toEqual(["a", "b"]);
    expect(Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y)).toBe(32);
  });
});

describe("SpotRegistry.reserve", () => {
  it("gives the same placements whatever order residents are reserved in", () => {
    const ids = ["carlos", "sofia", "tom", "maria", "miguel", "esperanza"];
    const run = (order: string[]) => {
      const reg = new SpotRegistry(spotsFromAnchors(LIBRARY), free);
      const out = new Map<string, string>();
      for (const id of order) {
        const p = reg.reserve("Public Library", id, ["porch", "window", "door"]);
        out.set(id, `${p.x},${p.y}`);
      }
      return out;
    };
    const a = run(ids);
    // Placements depend only on which spots are free at reservation time
    // and on the (agent, spot) hash — a seek re-adds residents in reducer
    // order, so the same order must reproduce the same town.
    const b = run(ids);
    expect([...a.entries()]).toEqual([...b.entries()]);
    // Nobody shares a spot; overflow goes to distinct blue-noise points.
    expect(new Set(a.values()).size).toBe(ids.length);
  });

  it("keeps a replayed resident inside the recorded envelope", () => {
    const reg = new SpotRegistry(spotsFromAnchors(LIBRARY), free);
    const p = reg.reserve("Public Library", "carlos", ["porch", "window"], { near: { x: 680, y: 480 }, envelope: { dx: 60, dy: 40 } });
    // Only the east porch (632,500) is inside; the west porch and window are not.
    expect([p.x, p.y]).toEqual([632, 500]);
    const q = reg.reserve("Public Library", "sofia", ["porch", "window"], { near: { x: 680, y: 480 }, envelope: { dx: 60, dy: 40 } });
    expect(q.overflow).toBe(true);
    expect(Math.abs(q.x - 680)).toBeLessThanOrEqual(60);
    expect(Math.abs(q.y - 480)).toBeLessThanOrEqual(40);
  });

  it("shared door placements never consume the door's capacity", () => {
    const reg = new SpotRegistry(spotsFromAnchors(LIBRARY), free);
    const a = reg.reserve("Public Library", "carlos", ["door"], { shared: true });
    const b = reg.reserve("Public Library", "sofia", ["door"], { shared: true });
    expect(a.spot?.role).toBe("door");
    expect(b.spot?.role).toBe("door");
    expect(reg.occupancyOf("Public Library")).toBe(2);
    reg.release("carlos");
    expect(reg.occupancyOf("Public Library")).toBe(1);
  });

  it("chat pairs are exactly 32 px apart and face each other", () => {
    const reg = new SpotRegistry(spotsFromAnchors(LIBRARY), free);
    const [a, b] = reg.reserveChatPair("Public Library", ["carlos", "tom"], { x: 600, y: 520 });
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBe(32);
    expect(a.facing).toBe("right");
    expect(b.facing).toBe("left");
    // The pair is taken; the next couple gets an overflow pair, still 32 apart.
    const [c, d] = reg.reserveChatPair("Public Library", ["sofia", "maria"], { x: 600, y: 520 });
    expect(c.overflow && d.overflow).toBe(true);
    expect(Math.hypot(c.x - d.x, c.y - d.y)).toBe(32);
  });
});

describe("SpotRegistry.sampleApron", () => {
  it("keeps overflow points at least 34 px from every body and is deterministic", () => {
    const reg = new SpotRegistry(spotsFromAnchors(LIBRARY), free);
    const pts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < 8; i++) {
      const p = reg.reserve("Public Library", `n${i}`, ["lawn"], { apron: { x: 600, y: 540 } });
      pts.push({ x: p.x, y: p.y });
    }
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        expect(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)).toBeGreaterThanOrEqual(34);
      }
    }
    const again = new SpotRegistry(spotsFromAnchors(LIBRARY), free);
    for (let i = 0; i < 8; i++) {
      const p = again.reserve("Public Library", `n${i}`, ["lawn"], { apron: { x: 600, y: 540 } });
      expect([p.x, p.y]).toEqual([pts[i].x, pts[i].y]);
    }
  });

  it("respects the free-ground predicate", () => {
    const blocked = (x: number) => x < 600; // west half is a wall
    const reg = new SpotRegistry(spotsFromAnchors(LIBRARY), (x) => !blocked(x));
    for (let i = 0; i < 6; i++) {
      const p = reg.reserve("Town Park", `p${i}`, ["queue"], { apron: { x: 600, y: 640 } });
      expect(p.x).toBeGreaterThanOrEqual(600);
    }
  });
});
