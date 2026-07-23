#!/usr/bin/env python3
"""True-tilemap overworld renderer for the District Atlas (one per scenario).

v2: the atlas interior is composed from the SAME material as the town maps —
the rpg-tileset registry (``tiles.py``: grass fills, GRASS_LIGHT fringe
blobs, TREE_* stamps with their cast shadows, WATER_DEEP shoreline
autotiles, the bright-grass cliff kit) plus the ``township-modern`` sheet
(asphalt road kit with center dashes, tan PATH_TAN autotiles) driven by the
``MapCanvas`` blob autotiler from ``build_maps.py``. Nothing is painted
free-hand; every pixel comes from a tile, so the page is indistinguishable
in material from a town screenshot.

Canvas: 100x64 tiles of 16 px = 1600x1024 @1x. Outputs, under
``frontend/public/assets/maps/<scenario>/``:

- ``overworld.png``          1600x1024 terrain panel (@1x)
- ``overworld@2x.png``       3200x2048 nearest-neighbour upscale
- ``overworld-clouds.png``   translucent cloud-shadow blobs (+ ``@2x``),
                             tileable on both axes so the frontend can
                             drift the layer freely
- ``overworld-sites.json``   per-town clearing coordinates (see README)

Scenario geography (site positions, highway course, river, ridgeline,
lakes) is declared in ``GEOGRAPHY`` below in TILE coordinates — the same
hand-tuned-layout pattern as the towns; scenarios without an entry get a
deterministic generic layout from their ``scenarios/<id>/towns/*.json``.

Run:
    python3 -m scripts.mapgen.overworld --scenario nj11-2026
    python3 -m scripts.mapgen.overworld --all
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mapgen import moderntiles as M  # noqa: E402
from mapgen import tiles as R  # noqa: E402
from mapgen.build_maps import MapCanvas  # noqa: E402
from mapgen.render_preview import tile_img  # noqa: E402
from mapgen.tiles import TileStamp  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
MAPS_DIR = REPO_ROOT / "frontend/public/assets/maps"
PACKAGE_ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

T = 16
#: overworld canvas in tiles; exported panel is OW_W*16 x OW_H*16 @1x
OW_W, OW_H = 100, 64
OUT_W, OUT_H = OW_W * T, OW_H * T

# ---------------------------------------------------------------------------
# scenario geography (TILE coordinates in the 100x64 canvas)
# ---------------------------------------------------------------------------

GEOGRAPHY: dict[str, dict] = {
    "nj11-2026": {
        # west-to-east like the real district: Dover / Randolph west,
        # Parsippany center, Montclair east
        "sites": {
            "dover": (20, 26),
            "randolph": (30, 48),
            "parsippany": (57, 23),
            "montclair": (84, 45),
        },
        # I-80-like asphalt band sweeping W->E with two gentle curves,
        # passing just south of Dover and Parsippany
        "highway": [(-4, 39), (14, 36), (36, 31), (58, 30), (78, 35), (104, 42)],
        # tan connector paths; each entry is a waypoint list, entries that
        # are strings resolve to site centers. Shared waypoints => real
        # junction joins from the union-mask autotile.
        "paths": [
            ["dover", (24.0, 38.0), "randolph"],
            ["randolph", (48.0, 53.0), (63.0, 50.0), "montclair"],
            ["parsippany", (61.0, 38.0), (63.0, 50.0)],  # T-junction into the above
            ["randolph", (14.0, 56.0), (-3.0, 58.0)],  # spur off the west edge
            ["montclair", (95.0, 51.0), (104.0, 54.0)],  # spur off the east edge
        ],
        # Watchung / Highlands ridge hint: cliff-kit band along the north
        "ridge": True,
        "lakes": [(72.0, 16.0, 8.0, 4.5), (10.0, 55.0, 6.0, 3.5)],
        "river": None,
        "forest_clusters": 19,
        "tree_mood": ("tree_light", "tree_dark"),
    },
    "millbrook-budget": {
        "sites": {
            "millbrook-village": (28, 24),
            "harlow-crossing": (70, 42),
        },
        "highway": None,
        # Main road crosses the Stillwater on a stone bridge: the middle
        # leg is kept horizontal so the bridge deck lines up.
        "paths": [
            ["millbrook-village", (40.0, 33.0), (60.0, 33.0), "harlow-crossing"],
            ["millbrook-village", (14.0, 18.0), (-3.0, 16.0)],  # west spur
            ["harlow-crossing", (88.0, 48.0), (104.0, 50.0)],  # east spur
        ],
        "ridge": False,
        "lakes": [(87.0, 13.0, 5.5, 3.8)],
        # the Stillwater river runs top-to-bottom between the two towns
        "river": [
            (52.0, -4.0),
            (48.0, 12.0),
            (51.0, 26.0),
            (55.0, 40.0),
            (49.0, 58.0),
            (52.0, 68.0),
        ],
        "bridge_y": 33,
        "forest_clusters": 21,
        "tree_mood": ("tree_dark", "tree_dark", "tree_light"),
    },
}

#: clearing disc (kept clear for the frontend's markers), in tiles
CLEAR_RX, CLEAR_RY = 4.0, 3.0


def _stable_seed(label: str) -> int:
    return int.from_bytes(hashlib.sha256(label.encode("utf-8")).digest()[:8], "big")


def _validated_id(value: str, *, label: str) -> str:
    if not isinstance(value, str) or PACKAGE_ID_RE.fullmatch(value) is None:
        raise ValueError(f"{label} must use lowercase letters, numbers, and single hyphens")
    return value


def _out_path(scenario: str, filename: str) -> Path:
    root = MAPS_DIR.resolve()
    scenario_dir = root / _validated_id(scenario, label="scenario id")
    if scenario_dir.is_symlink() or not scenario_dir.resolve().is_relative_to(root):
        raise ValueError("overworld outputs must stay inside the map directory")
    path = scenario_dir / filename
    if path.resolve().parent != scenario_dir.resolve():
        raise ValueError("overworld outputs must stay inside their scenario namespace")
    return path


def _town_files(scenario: str) -> list[Path]:
    scenarios_root = (REPO_ROOT / "scenarios").resolve()
    towns_dir = scenarios_root / _validated_id(scenario, label="scenario id") / "towns"
    if towns_dir.is_symlink() or not towns_dir.resolve().is_relative_to(scenarios_root):
        raise ValueError("scenario towns directory is missing or unsafe")
    return sorted(p for p in towns_dir.glob("*.json") if not p.is_symlink())


# ---------------------------------------------------------------------------
# geometry helpers
# ---------------------------------------------------------------------------


def _catmull_rom(points: list[tuple[float, float]], step: float = 0.4) -> list[tuple[float, float]]:
    """Sample a smooth curve through the waypoints, ~step tiles apart."""
    if len(points) < 2:
        return list(points)
    pts = [points[0], *points, points[-1]]
    out: list[tuple[float, float]] = []
    for i in range(len(pts) - 3):
        p0, p1, p2, p3 = pts[i], pts[i + 1], pts[i + 2], pts[i + 3]
        seg = max(2, int(math.dist(p1, p2) / step))
        for j in range(seg):
            t = j / seg
            t2, t3 = t * t, t * t * t
            out.append(
                (
                    0.5
                    * (
                        2 * p1[0]
                        + (-p0[0] + p2[0]) * t
                        + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2
                        + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3
                    ),
                    0.5
                    * (
                        2 * p1[1]
                        + (-p0[1] + p2[1]) * t
                        + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2
                        + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3
                    ),
                )
            )
    out.append(points[-1])
    return out


def _stroke_mask(pts: list[tuple[float, float]], half: float) -> set[tuple[int, int]]:
    cells: set[tuple[int, int]] = set()
    ir = int(half + 1)
    for x, y in pts:
        for dy in range(-ir, ir + 1):
            for dx in range(-ir, ir + 1):
                if dx * dx + dy * dy <= half * half:
                    cells.add((int(x + dx), int(y + dy)))
    return cells


def _ellipse_mask(
    rng: random.Random, cx: float, cy: float, rx: float, ry: float, wobble: float = 0.14
) -> set[tuple[int, int]]:
    """Organic ellipse: radius modulated by a smooth random ring."""
    n = 16
    ring = [1.0 + rng.uniform(-wobble, wobble) for _ in range(n)]
    cells: set[tuple[int, int]] = set()
    for yy in range(int(cy - ry - 2), int(cy + ry + 3)):
        for xx in range(int(cx - rx - 2), int(cx + rx + 3)):
            dx = (xx - cx) / rx
            dy = (yy - cy) / ry
            d = math.hypot(dx, dy)
            if d < 1e-6:
                cells.add((xx, yy))
                continue
            th = math.atan2(dy, dx) / math.tau * n
            i0 = int(math.floor(th)) % n
            f = th - math.floor(th)
            r = ring[i0] * (1 - f) + ring[(i0 + 1) % n] * f
            if d <= r:
                cells.add((xx, yy))
    return cells


# ---------------------------------------------------------------------------
# overworld composer
# ---------------------------------------------------------------------------

BIG_TREES = {
    "tree_light": R.TREE_LIGHT,
    "tree_dark": R.TREE_DARK,
    "tree_fruit_a": R.TREE_FRUIT_A,
    "tree_fruit_b": R.TREE_FRUIT_B,
    "tree_fruit_c": R.TREE_FRUIT_C,
}
SMALL_TREES = {
    "tree_small": R.TREE_SMALL,
    "tree_round_small": R.TREE_ROUND_SMALL,
}


class Overworld:
    """Composes the page onto a MapCanvas + a y-sorted stamp list."""

    def __init__(self, scenario: str, geo: dict, towns: dict[str, str]) -> None:
        self.scenario = scenario
        self.geo = geo
        self.towns = towns
        self.rng = random.Random(_stable_seed(f"overworld-v2/{scenario}"))
        self.m = MapCanvas(
            "overworld", {"landmarks": []}, seed=_stable_seed(scenario), w=OW_W, h=OW_H
        )
        #: stamps composited alpha-over at export, y-sorted like the scene
        self.stamps: list[tuple[TileStamp, int, int]] = []
        self.keepout: set[tuple[int, int]] = set()  # no trunks/props here
        self.clear_rects: list[tuple[int, int, int, int]] = []  # keep FULLY clear
        self.water: set[tuple[int, int]] = set()
        self.road: set[tuple[int, int]] = set()
        self.sites: list[dict] = []

    # -- helpers -------------------------------------------------------------

    def _grow(self, cells: set[tuple[int, int]], r: int) -> set[tuple[int, int]]:
        out = set()
        for x, y in cells:
            for dy in range(-r, r + 1):
                for dx in range(-r, r + 1):
                    out.add((x + dx, y + dy))
        return out

    def place(self, stamp: TileStamp, x: int, y: int) -> None:
        """Queue a stamp whose TOP-LEFT tile is (x, y)."""
        self.stamps.append((stamp, x, y))

    def _stamp_ok(self, stamp: TileStamp, x: int, y: int) -> bool:
        """Trunk footprint (bottom-center 2x2) must sit on open ground and
        the whole stamp must stay off the marker clearings and the canvas
        edge below (canopy may overhang other features slightly)."""
        if y + stamp.h > OW_H + 1 or x < -2 or x + stamp.w > OW_W + 2:
            return False
        for rx0, ry0, rx1, ry1 in self.clear_rects:
            if x + stamp.w > rx0 and x < rx1 and y + stamp.h > ry0 and y < ry1:
                return False
        cx = x + stamp.w // 2
        for dy in (stamp.h - 2, stamp.h - 1):
            for dx in (-1, 0):
                if (cx + dx, y + dy) in self.keepout:
                    return False
        return True

    def try_tree(self, name: str, cx: int, cy: int) -> bool:
        """Place a tree stamp by its trunk position (bottom-center)."""
        stamp = BIG_TREES.get(name) or SMALL_TREES[name]
        x, y = cx - stamp.w // 2, cy - stamp.h + 1
        if not self._stamp_ok(stamp, x, y):
            return False
        self.place(stamp, x, y)
        # keep later trunks from stacking exactly here
        self.keepout.add((cx, cy))
        return True

    # -- terrain -------------------------------------------------------------

    def paint_base(self) -> None:
        m, rng = self.m, self.rng
        m.base_grass()
        # rolling multi-tone meadows: organic light-grass patches w/ fringe
        for _ in range(26):
            cx = rng.uniform(4, OW_W - 4)
            cy = rng.uniform(4, OW_H - 4)
            rx = rng.uniform(3.0, 8.0)
            ry = rng.uniform(2.0, 5.0)
            cells = {c for c in _ellipse_mask(rng, cx, cy, rx, ry, wobble=0.25) if m.inb(*c)}
            m.blob("ground-detail", cells, R.GRASS_LIGHT, holes=False, fringe=True)

    def paint_ridge(self) -> None:
        """Cliff-kit ridgeline band across the north: bright plateau grass
        on top, grass lip, rock face, rock base easing into the meadow."""
        m, rng = self.m, self.rng
        kit = R.CLIFF_GRASS
        # plateau depth per column: long gentle 1-row steps, 3..6 rows.
        # Cliff tiles go on ground-detail so their transparent pixels show
        # grass beneath, exactly like the example map's plateau.
        depth: list[int] = []
        d = 4
        run = 0
        for _x in range(OW_W):
            if run <= 0:
                d = max(3, min(6, d + rng.choice((-1, 1))))
                run = rng.randint(12, 22)
            run -= 1
            depth.append(d)
        for x in range(OW_W):
            p = depth[x]
            for y in range(p):
                m.set("ground-detail", x, y, rng.choice(R.CLIFF_PLATEAU_FILL))
            m.set("ground-detail", x, p, rng.choice(kit["lip"]))
            m.set("ground-detail", x, p + 1, rng.choice(kit["face_upper"]))
            m.set("ground-detail", x, p + 2, rng.choice(kit["face_lower"]))
            m.set("ground-detail", x, p + 3, rng.choice(kit["face_base"]))
            m.set("ground-detail", x, p + 4, rng.choice(kit["bottom_edge"]))
            for y in range(p + 6):
                self.keepout.add((x, y))
        # a wooded crest sells the ridge: small trees strung along the top
        for x in range(2, OW_W - 2, 3):
            if rng.random() < 0.62:
                tx = x + rng.randint(-1, 1)
                name = rng.choice(("tree_small", "tree_round_small", "tree_dark"))
                stamp = BIG_TREES.get(name) or SMALL_TREES[name]
                ty = rng.randint(0, max(0, depth[max(0, min(OW_W - 1, tx))] - 1))
                self.place(stamp, tx - stamp.w // 2, ty - stamp.h + 1)

    def _smooth(self, cells: set[tuple[int, int]], rounds: int = 2) -> set[tuple[int, int]]:
        """Majority-filter a mask so the shoreline autotiles get clean
        2+-cell runs instead of single-cell jags."""
        for _ in range(rounds):
            candidates = cells | self._grow(cells, 1)
            nxt = set()
            for x, y in candidates:
                n = sum(
                    (x + dx, y + dy) in cells
                    for dx in (-1, 0, 1)
                    for dy in (-1, 0, 1)
                    if (dx, dy) != (0, 0)
                )
                if (x, y) in cells:
                    if n >= 3:
                        nxt.add((x, y))
                elif n >= 6:
                    nxt.add((x, y))
            cells = nxt
        return cells

    def paint_lakes(self) -> None:
        m, rng = self.m, self.rng
        for cx, cy, rx, ry in self.geo.get("lakes") or []:
            cells = self._smooth(
                {c for c in _ellipse_mask(rng, cx, cy, rx, ry, wobble=0.12) if m.inb(*c)}
                - self.keepout  # never carve into the cliff band
            )
            # light-grass bank easing the lake into the meadow
            bank = {c for c in self._grow(cells, 2) if m.inb(*c)} - cells
            bank = {c for c in bank if m.get("ground-detail", *c) == 0}
            m.blob("ground-detail", bank, R.GRASS_LIGHT, holes=False)
            m.blob("ground-detail", cells, R.WATER_DEEP)
            self.water |= cells
            self.keepout |= self._grow(cells, 1)

    def paint_river(self) -> None:
        m = self.m
        course = self.geo.get("river")
        if not course:
            return
        pts = _catmull_rom(course, step=0.4)
        bridge_y = self.geo.get("bridge_y")
        cells: set[tuple[int, int]] = set()
        for i, (x, y) in enumerate(pts):
            r = 2.4 + 0.7 * math.sin(i / 40.0)
            if bridge_y is not None and abs(y - bridge_y) < 5:
                r = min(r, 1.8)  # narrows at the ford so the bridge spans it
            cells |= _stroke_mask([(x, y)], r)
        cells = self._smooth({c for c in cells if m.inb(*c)}, rounds=1)
        m.blob("ground-detail", cells, R.WATER_DEEP)
        self.water |= cells
        self.keepout |= self._grow(cells, 1)

    # -- roads ---------------------------------------------------------------

    def paint_highway(self) -> None:
        """I-80 band: a mostly-horizontal asphalt sweep. The centerline is
        quantized per COLUMN with 1-row steps at least 3 columns apart, so
        the asphalt autotiles produce the same clean edges + rounded corner
        tiles a town street bend gets — no ragged diagonal staircase."""
        m = self.m
        way = self.geo.get("highway")
        if not way:
            return
        pts = _catmull_rom(way, step=0.25)
        # smooth centerline y per column
        want: dict[int, float] = {}
        for x, y in pts:
            xi = int(round(x))
            want.setdefault(xi, y)
        xs = sorted(x for x in want if -1 <= x <= OW_W)
        center: dict[int, int] = {}
        cy = int(round(want[xs[0]]))
        steps_ago = 99
        for x in xs:
            target = want[x]
            if steps_ago >= 4 and abs(target - cy) >= 0.6:
                cy += 1 if target > cy else -1
                steps_ago = 0
            else:
                steps_ago += 1
            center[x] = cy
        band: set[tuple[int, int]] = set()
        for x, yc in center.items():
            for dy in (-2, -1, 0, 1, 2):
                if m.inb(x, yc + dy):
                    band.add((x, yc + dy))
        band -= self.water
        m.blob("ground-detail", band, M.ASPHALT)
        self.road |= band
        self.keepout |= self._grow(band, 2)
        # center dashes between the two lanes, skipping step columns
        for x, yc in center.items():
            if x % 3 != 1 or not m.inb(x, yc):
                continue
            if center.get(x - 1) != yc or center.get(x + 1) != yc:
                continue
            m.set("ground-detail", x, yc, M.mg("dash_h"))

    def _resolve(self, p) -> tuple[float, float]:
        if isinstance(p, str):
            x, y = self.geo["sites"][p]
            return float(x), float(y)
        return float(p[0]), float(p[1])

    def paint_paths(self) -> None:
        """Tan connector roads as ONE union mask => real junction joins."""
        m = self.m
        union: set[tuple[int, int]] = set()
        for way in self.geo.get("paths") or []:
            pts = _catmull_rom([self._resolve(p) for p in way], step=0.4)
            union |= _stroke_mask(pts, 1.5)
        union = {c for c in union if m.inb(*c)}
        union -= self.road  # stop clean at the asphalt edge (junction)
        # paths never wade: drop water overlap except the bridge crossing
        by = self.geo.get("bridge_y")
        wet = union & self.water
        if by is not None:
            wet = {c for c in wet if abs(c[1] - by) > 2}
        union -= wet
        m.blob("ground-detail", union, R.PATH_TAN, fringe=True)
        self.road |= union
        self.keepout |= self._grow(union, 2)

    def paint_bridge(self) -> None:
        """Stone bridge where the main road crosses the river."""
        by = self.geo.get("bridge_y")
        if by is None or not self.water:
            return
        crossing = sorted(x for x, y in (self.road & self.water) if abs(y - by) <= 2)
        if not crossing:
            return
        cx = (crossing[0] + crossing[-1]) // 2
        x0 = cx - R.BRIDGE_STONE.w // 2
        y0 = by - 1
        self.place(R.BRIDGE_STONE, x0, y0)
        for dy in range(R.BRIDGE_STONE.h):
            for dx in range(R.BRIDGE_STONE.w):
                self.keepout.add((x0 + dx, y0 + dy))

    # -- town clearings --------------------------------------------------------

    def _cobble_pad(self, w: int, h: int) -> TileStamp:
        """COBBLE_PAD's edge tuples are ORDERED rim sequences (a scalloped
        outline), so the random blob autotiler mangles them; compose the pad
        as a stamp instead, cycling the rims in order like ``pad_stamp``."""
        b = R.COBBLE_PAD
        rng = self.rng

        def cyc(seq: tuple[int, ...], n: int) -> list[int]:
            return [seq[i % len(seq)] for i in range(n)]

        rows = [[b.nw, *cyc(b.n, w - 2), b.ne]]
        west = cyc(b.w, h - 2)
        east = cyc(b.e, h - 2)
        for r in range(h - 2):
            rows.append([west[r], *(rng.choice(b.fill) for _ in range(w - 2)), east[r]])
        rows.append([b.sw, *cyc(b.s, w - 2), b.se])
        return TileStamp(f"plaza_pad_{w}x{h}", tuple(tuple(r) for r in rows))

    def paint_clearings(self) -> None:
        m = self.m
        pw, ph = int(CLEAR_RX * 2), int(CLEAR_RY * 2)  # ~8x6 tiles
        for tid in sorted(self.towns):
            cx, cy = self.geo["sites"][tid]
            # subtle tan apron easing the plaza into the meadow
            apron_cells = set()
            for yy in range(int(cy - ph / 2 - 2), int(cy + ph / 2 + 2)):
                for xx in range(int(cx - pw / 2 - 2), int(cx + pw / 2 + 2)):
                    dx = (xx - cx) / (pw / 2 + 1.6)
                    dy = (yy - cy) / (ph / 2 + 1.4)
                    if abs(dx) ** 3.0 + abs(dy) ** 3.0 <= 1.0:
                        apron_cells.add((xx, yy))
            apron = {c for c in apron_cells if m.inb(*c) and c not in self.water}
            m.blob("ground-detail", apron, R.PATH_TAN, fringe=True)
            # plaza-cobble pad (~8x6 tiles), kept CLEAR for the marker
            m.stamp("ground-detail", self._cobble_pad(pw, ph), int(cx - pw / 2), int(cy - ph / 2))
            self.keepout |= self._grow(apron, 1)
            pad = 2
            self.clear_rects.append(
                (
                    int(cx - CLEAR_RX) - pad,
                    int(cy - CLEAR_RY) - pad,
                    int(cx + CLEAR_RX) + pad + 1,
                    int(cy + CLEAR_RY) + pad + 1,
                )
            )
            self.sites.append(
                {
                    "town_id": tid,
                    "name": self.towns[tid],
                    "x": int(cx * T),
                    "y": int(cy * T),
                    "clearing": {"rx": int(CLEAR_RX * T), "ry": int(CLEAR_RY * T)},
                }
            )

    # -- forest + dressing -----------------------------------------------------

    def paint_forests(self) -> None:
        rng = self.rng
        mood = self.geo.get("tree_mood", ("tree_light", "tree_dark"))
        clusters = self.geo.get("forest_clusters", 15)
        placed = 0
        attempts = 0
        while placed < clusters and attempts < clusters * 40:
            attempts += 1
            cx = rng.randint(4, OW_W - 5)
            cy = rng.randint(8, OW_H - 2)
            near_edge = cx < 14 or cx > OW_W - 15 or cy > OW_H - 12 or cy < 16
            if rng.random() > (0.9 if near_edge else 0.42):
                continue
            if (cx, cy) in self.keepout:
                continue
            n = rng.randint(5, 9)
            got = 0
            for _ in range(n * 3):
                if got >= n:
                    break
                tx = int(cx + rng.gauss(0, 4.5))
                ty = int(cy + rng.gauss(0, 3.2))
                roll = rng.random()
                if roll < 0.72:
                    name = rng.choice(mood)
                elif roll < 0.86:
                    name = rng.choice(("tree_fruit_a", "tree_fruit_b", "tree_fruit_c"))
                else:
                    name = rng.choice(("tree_small", "tree_round_small"))
                if self.try_tree(name, tx, ty):
                    got += 1
            if got >= 3:
                placed += 1
        # lone trees breathing on the open meadow
        for _ in range(30):
            tx = rng.randint(3, OW_W - 4)
            ty = rng.randint(9, OW_H - 2)
            name = rng.choice((*mood, "tree_small", "tree_round_small", "tree_fruit_a"))
            self.try_tree(name, tx, ty)

    def paint_dressing(self) -> None:
        """Rock / fern / flower accents, in small clusters like the towns."""
        m, rng = self.m, self.rng
        rocks = (R.ROCK_BIG, R.ROCK_MED, R.ROCK_SMALL, R.STONES_SMALL, R.LOG, R.STUMP_WIDE)
        for _ in range(9):
            stamp = rng.choice(rocks)
            x = rng.randint(3, OW_W - 6)
            y = rng.randint(9, OW_H - 6)
            if self._stamp_ok(stamp, x, y) and not any(
                (x + dx, y + dy) in self.keepout for dx in range(stamp.w) for dy in range(stamp.h)
            ):
                self.place(stamp, x, y)
                for dy in range(stamp.h):
                    for dx in range(stamp.w):
                        self.keepout.add((x + dx, y + dy))
        for _ in range(12):
            stamp = rng.choice((R.FERN, R.FLOWER_PATCH, R.SNOWDROP, R.BUSH_ROUND))
            x = rng.randint(3, OW_W - 4)
            y = rng.randint(9, OW_H - 4)
            if self._stamp_ok(stamp, x, y) and not any(
                (x + dx, y + dy) in self.keepout for dx in range(stamp.w) for dy in range(stamp.h)
            ):
                self.place(stamp, x, y)
        # scattered single white flowers on open grass (deco tile layer)
        for _ in range(120):
            x = rng.randint(1, OW_W - 2)
            y = rng.randint(7, OW_H - 2)
            if (x, y) not in self.keepout and m.get("ground-detail", x, y) == 0:
                m.set("deco-below", x, y, rng.choice(R.FLOWERS_WHITE))

    # -- compose + export ------------------------------------------------------

    def compose(self) -> None:
        self.paint_base()
        if self.geo.get("ridge"):
            self.paint_ridge()
        self.paint_lakes()
        self.paint_river()
        self.paint_highway()
        self.paint_paths()
        self.paint_clearings()
        self.paint_bridge()
        self.paint_forests()
        self.paint_dressing()

    def render_png(self):
        from PIL import Image

        canvas = Image.new("RGBA", (OUT_W, OUT_H))
        for layer in ("ground", "ground-detail", "deco-below"):
            grid = self.m.layers[layer]
            for y in range(OW_H):
                row = grid[y]
                for x in range(OW_W):
                    raw = row[x]
                    if not raw:
                        continue
                    img = tile_img(raw)
                    if img is not None:
                        canvas.alpha_composite(img, (x * T, y * T))
        # stamps painter-sorted by their baseline, like the scene depth sort
        for stamp, x, y in sorted(self.stamps, key=lambda s: s[2] + s[0].h):
            for r, c, g in stamp.cells():
                px, py = (x + c) * T, (y + r) * T
                if 0 <= px < OUT_W and 0 <= py < OUT_H:
                    img = tile_img(g)
                    if img is not None:
                        canvas.alpha_composite(img, (px, py))
        return canvas.convert("RGB")


# ---------------------------------------------------------------------------
# clouds + export
# ---------------------------------------------------------------------------

CLOUD = (24, 32, 52)


def _cloud_layer(scenario: str):
    """Translucent cloud-shadow blobs, tileable on both axes; painted at
    quarter resolution so shadows share the page's chunky pixel grain."""
    from PIL import Image

    cw, ch = OUT_W // 4, OUT_H // 4
    rng = random.Random(_stable_seed(f"overworld-clouds-v2/{scenario}"))
    alpha = [[0] * cw for _ in range(ch)]
    for _ in range(8):
        cx, cy = rng.randrange(cw), rng.randrange(ch)
        for _ in range(rng.randint(3, 5)):
            lx = cx + rng.uniform(-22, 22)
            ly = cy + rng.uniform(-9, 9)
            lrx = rng.uniform(10, 20)
            lry = rng.uniform(5, 10)
            for y in range(int(ly - lry - 3), int(ly + lry + 4)):
                for x in range(int(lx - lrx - 3), int(lx + lrx + 4)):
                    d = ((x - lx) / lrx) ** 2 + ((y - ly) / lry) ** 2
                    if d > 1.25:
                        continue
                    wx, wy = x % cw, y % ch  # wrap => seamless drift
                    if d <= 0.85:
                        alpha[wy][wx] = max(alpha[wy][wx], 42)
                    elif rng.random() < (1.25 - d) * 1.9:  # dithered fringe
                        alpha[wy][wx] = max(alpha[wy][wx], 26)
    img = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    for y in range(ch):
        for x in range(cw):
            a = alpha[y][x]
            if a:
                img.putpixel((x, y), (*CLOUD, a))
    return img


def render(scenario: str) -> Path:
    from PIL import Image

    scenario = _validated_id(scenario, label="scenario id")
    town_files = _town_files(scenario)
    if not town_files:
        raise ValueError(f"scenario {scenario!r} has no towns")
    towns = {p.stem: json.loads(p.read_text()).get("name", p.stem) for p in town_files}

    geo = GEOGRAPHY.get(scenario)
    if geo is None:
        # deterministic generic layout: towns on a gentle ring, chained paths
        rng = random.Random(_stable_seed(f"overworld-layout/{scenario}"))
        ids = sorted(towns)
        sites = {}
        for i, tid in enumerate(ids):
            th = math.tau * i / len(ids) + rng.uniform(-0.2, 0.2)
            sites[tid] = (
                OW_W / 2 + math.cos(th) * OW_W * 0.3,
                OW_H / 2 + math.sin(th) * OW_H * 0.28,
            )
        geo = {
            "sites": sites,
            "highway": None,
            "paths": [[ids[i], ids[(i + 1) % len(ids)]] for i in range(len(ids))]
            if len(ids) > 1
            else [],
            "ridge": False,
            "lakes": [(OW_W * 0.82, OW_H * 0.18, 6.0, 3.5)],
            "river": None,
        }
    missing = [tid for tid in towns if tid not in geo["sites"]]
    for i, tid in enumerate(missing):  # park unknown towns on open ground
        geo["sites"][tid] = (
            OW_W * (0.2 + 0.6 * (i % 3) / 2),
            OW_H * (0.25 + 0.5 * (i // 3)),
        )

    o = Overworld(scenario, geo, towns)
    o.compose()
    img = o.render_png()

    out1 = _out_path(scenario, "overworld.png")
    out1.parent.mkdir(parents=True, exist_ok=True)
    img.save(out1)
    img.resize((OUT_W * 2, OUT_H * 2), Image.NEAREST).save(_out_path(scenario, "overworld@2x.png"))

    clouds = _cloud_layer(scenario)
    clouds.resize((OUT_W, OUT_H), Image.NEAREST).save(_out_path(scenario, "overworld-clouds.png"))
    clouds.resize((OUT_W * 2, OUT_H * 2), Image.NEAREST).save(
        _out_path(scenario, "overworld-clouds@2x.png")
    )

    sites_doc = {
        "version": 1,
        "scenario": scenario,
        "image": {
            "path": "overworld.png",
            "path2x": "overworld@2x.png",
            "width": OUT_W,
            "height": OUT_H,
        },
        "clouds": {
            "path": "overworld-clouds.png",
            "path2x": "overworld-clouds@2x.png",
            "tileable": True,
        },
        "sites": sorted(o.sites, key=lambda s: s["town_id"]),
    }
    sites_path = _out_path(scenario, "overworld-sites.json")
    sites_path.write_text(json.dumps(sites_doc, indent=2) + "\n")
    for p in (out1, sites_path):
        print(f"wrote {p}")
    return out1


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--scenario", default="nj11-2026")
    ap.add_argument("--all", action="store_true", help="render every scenario package")
    args = ap.parse_args()
    if args.all:
        for pkg in sorted((REPO_ROOT / "scenarios").iterdir()):
            if pkg.is_dir() and PACKAGE_ID_RE.fullmatch(pkg.name) and (pkg / "towns").is_dir():
                render(pkg.name)
    else:
        try:
            render(args.scenario)
        except ValueError as exc:
            ap.error(str(exc))


if __name__ == "__main__":
    main()
