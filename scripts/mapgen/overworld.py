#!/usr/bin/env python3
"""Native-resolution tilemap overworld for the District Atlas (one per scenario).

The atlas interior is composed from the SAME material as the town maps —
the rpg-tileset registry (``tiles.py``: grass fills, GRASS_LIGHT meadows,
TREE_* stamps with their cast shadows, WATER_DEEP shoreline autotiles, the
cliff kit, wheat / tilled fields) plus the ``township-modern`` sheet (asphalt
road kit, sidewalks, street props) driven by the ``MapCanvas`` autotiler
from ``build_maps.py``. Nothing is painted free-hand; every pixel comes from
a tile.

v3: the canvas is 60x38 tiles = 960x608 px @1x — the exact size the atlas
panel shows it at, so one image pixel is one CSS pixel — and every town is
a real mini-town (``atlas_towns.py``): a 12x10 pad with a two-lane main
street, sidewalks, the town's set-piece built from the town recipes, and an
asphalt connector to the highway. Outputs, under
``frontend/public/assets/maps/<scenario>/``:

- ``overworld.png``          960x608 terrain panel (@1x)
- ``overworld@2x.png``       1920x1216 nearest-neighbour upscale
- ``overworld-clouds.png``   translucent cloud-shadow blobs (+ ``@2x``),
                             tileable on both axes so the frontend can
                             drift the layer freely
- ``overworld-sites.json``   v2 site records: pad rect, walk loop, centre

Scenario geography (pads, highway course, river, ridge, lakes, fields) is
declared in ``GEOGRAPHY`` below in TILE coordinates; scenarios without an
entry get a deterministic generic layout from ``scenarios/<id>/towns``.

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
from mapgen import atlas_towns as AT  # noqa: E402
from mapgen import moderntiles as M  # noqa: E402
from mapgen import tiles as R  # noqa: E402
from mapgen.atlas_towns import PAD_H, PAD_W, Pad  # noqa: E402
from mapgen.build_maps import MapCanvas  # noqa: E402
from mapgen.render_preview import tile_img  # noqa: E402
from mapgen.tiles import TileStamp  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
MAPS_DIR = REPO_ROOT / "frontend/public/assets/maps"
PACKAGE_ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

T = 16
#: overworld canvas in tiles; exported panel is OW_W*16 x OW_H*16 @1x
OW_W, OW_H = 60, 38
OUT_W, OUT_H = OW_W * T, OW_H * T
SITES_VERSION = 2

# ---------------------------------------------------------------------------
# scenario geography (TILE coordinates in the 60x38 canvas)
# ---------------------------------------------------------------------------
#
# Vertical budget (nj11): ridge rows 0-5 · north pads rows 6-15 · their
# nameplates 16-18 · highway band 19-23 · south pads 25-34 · nameplates
# 35-37. Pads are the top-left of a 12x10 block (see atlas_towns.Pad);
# ``connector`` names the street end that bends toward the highway, the
# other end is the gate the tan district roads leave from ("town:w").

GEOGRAPHY: dict[str, dict] = {
    "nj11-2026": {
        # west-to-east like the real district: Dover NW, Randolph SW,
        # Parsippany north-centre, Montclair east
        "pads": {
            "dover": (4, 6),
            "parsippany": (27, 6),
            "randolph": (13, 25),
            "montclair": (43, 25),
        },
        "connector": {"dover": "e", "parsippany": "w", "randolph": "w", "montclair": "w"},
        # I-80-like asphalt band sweeping W->E between the two rows of towns
        "highway": [(-3, 21.6), (10, 21.2), (24, 21.0), (40, 21.0), (52, 21.5), (63, 22.4)],
        # tan district roads; "town:side" resolves to that street end's gate
        "paths": [
            ["dover:w", (1.5, 16.0), (2.5, 27.0), (10.5, 30.0)],
            ["dover:w", (-3.0, 13.5)],
            ["randolph:e", (33.0, 33.5), (40.5, 32.5)],
            ["montclair:e", (58.0, 34.0), (63.0, 35.5)],
            ["parsippany:e", (43.5, 16.5), (52.0, 15.5), (63.0, 13.5)],
        ],
        # Highlands ridge hint: cliff-kit band along the north edge
        "ridge": True,
        # Lake Parsippany lobe lapping the pad's NE corner; a pond in the SW
        "lakes": [(41.5, 8.5, 5.0, 3.1), (5.5, 32.5, 3.8, 2.2)],
        "fields": [("wheat", 29, 27, 6, 4), ("tilled", 55, 8, 4, 4)],
        "river": None,
        "forest_clusters": 11,
        "lone_trees": 14,
        "tree_mood": ("tree_light", "tree_dark"),
    },
    "millbrook-budget": {
        "pads": {
            "millbrook-village": (15, 7),
            "harlow-crossing": (37, 24),
        },
        "connector": {"millbrook-village": "e", "harlow-crossing": "w"},
        "highway": None,
        # Main road crosses the Stillwater on a stone bridge right off the
        # village's Main Street, then bends south to the Crossing.
        "paths": [
            ["millbrook-village:e", (36.0, 14.5), (36.5, 24.0), "harlow-crossing:w"],
            ["millbrook-village:w", (8.0, 14.5), (-3.0, 12.5)],
            ["harlow-crossing:e", (54.0, 33.0), (63.0, 34.5)],
        ],
        "ridge": False,
        "lakes": [(52.0, 7.5, 4.2, 2.8)],
        "fields": [("wheat", 4, 22, 5, 4), ("tilled", 50, 19, 5, 3)],
        # the Stillwater river runs top-to-bottom between the two towns
        "river": [
            (31.0, -3.0),
            (29.5, 7.0),
            (30.5, 15.0),
            (32.5, 23.0),
            (30.0, 31.0),
            (31.5, 41.0),
        ],
        "bridge_y": 14,
        "forest_clusters": 12,
        "lone_trees": 14,
        "tree_mood": ("tree_dark", "tree_dark", "tree_light"),
    },
}


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


def _grow(cells: set[tuple[int, int]], r: int) -> set[tuple[int, int]]:
    out = set()
    for x, y in cells:
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                out.add((x + dx, y + dy))
    return out


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
FIELD_BLOBS = {"wheat": R.WHEAT, "tilled": R.FIELD_TILLED}


class Overworld:
    """Composes the page onto a MapCanvas + a y-sorted stamp list."""

    def __init__(self, scenario: str, geo: dict, towns: dict[str, str]) -> None:
        self.scenario = scenario
        self.geo = geo
        self.towns = towns
        self.rng = random.Random(_stable_seed(f"overworld-v3/{scenario}"))
        self.m = MapCanvas(
            "overworld", {"landmarks": []}, seed=_stable_seed(scenario), w=OW_W, h=OW_H
        )
        #: stamps composited alpha-over at export, y-sorted like the scene
        self.stamps: list[tuple[TileStamp, int, int]] = []
        self.keepout: set[tuple[int, int]] = set()  # no trunks/props here
        self.clear_rects: list[tuple[int, int, int, int]] = []  # keep FULLY clear
        #: cells no tree canopy may cover (roads that must stay readable)
        self.no_canopy: set[tuple[int, int]] = set()
        self.water: set[tuple[int, int]] = set()
        self.highway: set[tuple[int, int]] = set()
        self.hw_center: dict[int, int] = {}
        self.pads: dict[str, Pad] = {}
        self.sites: list[dict] = []

    # -- helpers -------------------------------------------------------------

    def place(self, stamp: TileStamp, x: int, y: int) -> None:
        """Queue a stamp whose TOP-LEFT tile is (x, y)."""
        self.stamps.append((stamp, x, y))

    def _stamp_ok(self, stamp: TileStamp, x: int, y: int) -> bool:
        """Trunk footprint (bottom-center 2x2) must sit on open ground and
        the whole stamp must stay off the town pads and the canvas edge
        below (canopy may overhang other features slightly)."""
        if y + stamp.h > OW_H + 1 or x < -2 or x + stamp.w > OW_W + 2:
            return False
        for rx0, ry0, rx1, ry1 in self.clear_rects:
            if x + stamp.w > rx0 and x < rx1 and y + stamp.h > ry0 and y < ry1:
                return False
        if self.no_canopy and any((x + c, y + r) in self.no_canopy for r, c, _g in stamp.cells()):
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
        self.keepout.add((cx, cy))
        return True

    def _road_cells(self) -> set[tuple[int, int]]:
        return set(self.m.road_mask)

    # -- terrain -------------------------------------------------------------

    def paint_base(self) -> None:
        m, rng = self.m, self.rng
        m.base_grass()
        # rolling multi-tone meadows: organic light-grass patches w/ fringe
        for _ in range(14):
            cx = rng.uniform(3, OW_W - 3)
            cy = rng.uniform(3, OW_H - 3)
            rx = rng.uniform(2.5, 6.0)
            ry = rng.uniform(1.6, 3.6)
            cells = {c for c in _ellipse_mask(rng, cx, cy, rx, ry, wobble=0.25) if m.inb(*c)}
            m.blob("ground-detail", cells, R.GRASS_LIGHT, holes=False, fringe=True)

    def paint_ridge(self) -> None:
        """Cliff-kit ridgeline along the north edge: an occasional plateau
        row, grass lip, rock face, rock base easing into the meadow. Kept to
        rows 0-5 so the northern towns sit at the foot of the hills."""
        m, rng = self.m, self.rng
        kit = R.CLIFF_GRASS
        depth: list[int] = []
        d = 0
        run = 0
        for _x in range(OW_W):
            if run <= 0:
                d = 1 - d
                run = rng.randint(7, 14)
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
                m.reserved.add((x, y))
        # a wooded crest sells the ridge: small trees strung along the top
        for x in range(1, OW_W - 1, 3):
            if rng.random() < 0.6:
                tx = x + rng.randint(-1, 1)
                name = rng.choice(("tree_small", "tree_round_small", "tree_dark"))
                stamp = BIG_TREES.get(name) or SMALL_TREES[name]
                ty = depth[max(0, min(OW_W - 1, tx))] - 1
                self.place(stamp, tx - stamp.w // 2, ty - stamp.h + 1)

    def _smooth(self, cells: set[tuple[int, int]], rounds: int = 2) -> set[tuple[int, int]]:
        """Majority-filter a mask so the shoreline autotiles get clean
        2+-cell runs instead of single-cell jags."""
        for _ in range(rounds):
            candidates = cells | _grow(cells, 1)
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

    def _add_water(self, cells: set[tuple[int, int]], bank: bool) -> None:
        m = self.m
        cells = {c for c in cells if m.inb(*c)} - self.keepout
        if bank:
            edge = {c for c in _grow(cells, 2) if m.inb(*c)} - cells
            edge = {c for c in edge if m.get("ground-detail", *c) == 0}
            m.blob("ground-detail", edge, R.GRASS_LIGHT, holes=False)
        m.blob("ground-detail", cells, R.WATER_DEEP)
        self.water |= cells
        m.reserved |= cells
        self.keepout |= _grow(cells, 1)

    def paint_lakes(self) -> None:
        rng = self.rng
        for cx, cy, rx, ry in self.geo.get("lakes") or []:
            self._add_water(self._smooth(_ellipse_mask(rng, cx, cy, rx, ry, wobble=0.12)), True)

    def paint_river(self) -> None:
        course = self.geo.get("river")
        if not course:
            return
        pts = _catmull_rom(course, step=0.4)
        bridge_y = self.geo.get("bridge_y")
        cells: set[tuple[int, int]] = set()
        for i, (x, y) in enumerate(pts):
            r = 2.0 + 0.5 * math.sin(i / 30.0)
            if bridge_y is not None and abs(y - bridge_y) < 4:
                r = min(r, 1.6)  # narrows at the ford so the bridge spans it
            cells |= _stroke_mask([(x, y)], r)
        self._add_water(self._smooth(cells, rounds=1), False)

    def paint_fields(self) -> None:
        """Wheat / tilled patches on the open meadow (never on a pad)."""
        m = self.m
        for kind, x, y, w, h in self.geo.get("fields") or []:
            cells = {
                (xx, yy)
                for xx in range(x, x + w)
                for yy in range(y, y + h)
                if m.inb(xx, yy) and (xx, yy) not in self.keepout
            }
            if kind == "wheat":  # clip the corners so the fillets round it off
                cells -= {(x, y), (x + w - 1, y), (x, y + h - 1), (x + w - 1, y + h - 1)}
            m.blob("ground-detail", cells, FIELD_BLOBS[kind], fringe=True)
            self.keepout |= _grow(cells, 1)

    # -- roads ---------------------------------------------------------------

    def plan_highway(self) -> None:
        """I-80 band: a mostly-horizontal asphalt sweep. The centerline is
        quantized per COLUMN with 1-row steps at least 4 columns apart, so
        the asphalt autotiles produce the same clean edges + rounded corner
        tiles a town street bend gets — no ragged diagonal staircase. Only
        the mask is built here; ``paint_roads`` renders it with the towns'
        streets as one asphalt union."""
        way = self.geo.get("highway")
        if not way:
            return
        pts = _catmull_rom(way, step=0.25)
        want: dict[int, float] = {}
        for x, y in pts:
            want.setdefault(int(round(x)), y)
        xs = sorted(x for x in want if -1 <= x <= OW_W)
        cy = int(round(want[xs[0]]))
        steps_ago = 99
        for x in xs:
            target = want[x]
            if steps_ago >= 4 and abs(target - cy) >= 0.6:
                cy += 1 if target > cy else -1
                steps_ago = 0
            else:
                steps_ago += 1
            self.hw_center[x] = cy
        band: set[tuple[int, int]] = set()
        for x, yc in self.hw_center.items():
            for dy in (-2, -1, 0, 1, 2):
                if self.m.inb(x, yc + dy):
                    band.add((x, yc + dy))
        band -= self.water
        self.highway = band
        self.m.road_mask |= band
        self.keepout |= _grow(band, 1)
        self.no_canopy |= band

    def paint_roads(self) -> None:
        """Render the asphalt union (highway + streets + connectors) with
        the towns' sidewalk rings. The highway keeps bare grass shoulders:
        its border cells are reserved for the duration of the paint unless
        a street leg also touches them."""
        m = self.m
        streets = m.road_mask - self.highway
        shoulder = {
            c
            for c in _grow(self.highway, 1) - m.road_mask
            if m.inb(*c) and not any(n in streets for n in _grow({c}, 1))
        }
        added = shoulder - m.reserved
        m.reserved |= added
        m.paint_roads(sidewalks=True, dashes=False, crosswalks=False)
        m.reserved -= added
        # center dashes between the highway's lanes, skipping step columns
        for x, yc in self.hw_center.items():
            if x % 3 != 1 or not m.inb(x, yc) or (x, yc) not in self.highway:
                continue
            if self.hw_center.get(x - 1) != yc or self.hw_center.get(x + 1) != yc:
                continue
            if (x, yc - 1) in streets or (x, yc + 1) in streets:
                continue  # a connector joins here
            m.set("ground-detail", x, yc, M.mg("dash_h"))
        self.keepout |= _grow(m.road_mask, 1)
        self.no_canopy |= m.road_mask - self.highway  # streets + connector legs

    def _resolve(self, p) -> tuple[float, float]:
        if isinstance(p, str):
            tid, _, side = p.partition(":")
            return AT.gate(self.pads[tid], side or "w")
        return float(p[0]), float(p[1])

    def paint_paths(self) -> None:
        """Tan district roads as ONE union mask => real junction joins.
        They start at a street's free end and stop flush at any asphalt."""
        m = self.m
        union: set[tuple[int, int]] = set()
        for way in self.geo.get("paths") or []:
            pts = _catmull_rom([self._resolve(p) for p in way], step=0.4)
            union |= _stroke_mask(pts, 1.5)
        union = {c for c in union if m.inb(*c)}
        union -= m.road_mask
        for pad in self.pads.values():
            union -= pad.cells()
        # paths never wade: drop water overlap except the bridge crossing
        by = self.geo.get("bridge_y")
        wet = union & self.water
        if by is not None:
            wet = {c for c in wet if abs(c[1] - by) > 1}
        union -= wet
        m.blob("ground-detail", union, R.PATH_TAN, fringe=True)
        self.keepout |= _grow(union, 1)

    def paint_bridge(self) -> None:
        """Stone bridge where the main road crosses the river."""
        by = self.geo.get("bridge_y")
        if by is None or not self.water:
            return
        crossing = sorted(x for x, y in self.water if y == by and (x, y) not in self.m.road_mask)
        crossing = [
            x for x in crossing if self.m.get("ground-detail", x, by) in set(R.PATH_TAN.fill)
        ] or crossing
        if not crossing:
            return
        cx = (crossing[0] + crossing[-1]) // 2
        x0 = cx - R.BRIDGE_STONE.w // 2
        y0 = by - 1
        self.place(R.BRIDGE_STONE, x0, y0)
        for dy in range(R.BRIDGE_STONE.h):
            for dx in range(R.BRIDGE_STONE.w):
                self.keepout.add((x0 + dx, y0 + dy))

    # -- towns -----------------------------------------------------------------

    def plan_towns(self) -> None:
        connectors = self.geo.get("connector") or {}
        for tid in sorted(self.towns):
            pad = self.pads[tid]
            side = connectors.get(tid, "e")
            AT.plan_town(self, self.scenario, tid, pad, side)
            self.keepout |= pad.cells(1)
            self.clear_rects.append((pad.x - 1, pad.y - 2, pad.x1 + 1, pad.y1 + 1))
            cx, cy = pad.x + pad.w / 2, pad.y + pad.h / 2
            self.sites.append(
                {
                    "id": tid,
                    "town_id": tid,
                    "name": self.towns[tid],
                    "x": int(cx * T),
                    "y": int(cy * T),
                    "pad": pad.as_dict(),
                    "walk": AT.walk_loop(pad),
                    "connector": side,
                }
            )

    def dress_towns(self) -> None:
        for tid in sorted(self.towns):
            AT.dress_town(self, self.scenario, tid, self.pads[tid])

    # -- forest + dressing -----------------------------------------------------

    def paint_forests(self) -> None:
        rng = self.rng
        mood = self.geo.get("tree_mood", ("tree_light", "tree_dark"))
        clusters = self.geo.get("forest_clusters", 10)
        placed = 0
        attempts = 0
        while placed < clusters and attempts < clusters * 40:
            attempts += 1
            cx = rng.randint(3, OW_W - 4)
            cy = rng.randint(6, OW_H - 1)
            near_edge = cx < 8 or cx > OW_W - 9 or cy > OW_H - 7 or cy < 10
            if rng.random() > (0.9 if near_edge else 0.42):
                continue
            if (cx, cy) in self.keepout:
                continue
            n = rng.randint(4, 7)
            got = 0
            for _ in range(n * 3):
                if got >= n:
                    break
                tx = int(cx + rng.gauss(0, 3.2))
                ty = int(cy + rng.gauss(0, 2.4))
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
        for _ in range(self.geo.get("lone_trees", 12)):
            tx = rng.randint(2, OW_W - 3)
            ty = rng.randint(7, OW_H - 1)
            name = rng.choice((*mood, "tree_small", "tree_round_small", "tree_fruit_a"))
            self.try_tree(name, tx, ty)

    def paint_dressing(self) -> None:
        """Rock / fern / flower accents, in small clusters like the towns."""
        m, rng = self.m, self.rng
        rocks = (R.ROCK_BIG, R.ROCK_MED, R.ROCK_SMALL, R.STONES_SMALL, R.LOG, R.STUMP_WIDE)

        def free(stamp: TileStamp, x: int, y: int) -> bool:
            return self._stamp_ok(stamp, x, y) and not any(
                (x + dx, y + dy) in self.keepout for dx in range(stamp.w) for dy in range(stamp.h)
            )

        for _ in range(6):
            stamp = rng.choice(rocks)
            x = rng.randint(2, OW_W - 5)
            y = rng.randint(7, OW_H - 5)
            if free(stamp, x, y):
                self.place(stamp, x, y)
                for dy in range(stamp.h):
                    for dx in range(stamp.w):
                        self.keepout.add((x + dx, y + dy))
        for _ in range(8):
            stamp = rng.choice((R.FERN, R.FLOWER_PATCH, R.SNOWDROP, R.BUSH_ROUND))
            x = rng.randint(2, OW_W - 3)
            y = rng.randint(7, OW_H - 3)
            if free(stamp, x, y):
                self.place(stamp, x, y)
        # scattered single white flowers on open grass (deco tile layer)
        for _ in range(70):
            x = rng.randint(1, OW_W - 2)
            y = rng.randint(6, OW_H - 2)
            if (x, y) not in self.keepout and m.get("ground-detail", x, y) == 0:
                m.set("deco-below", x, y, rng.choice(R.FLOWERS_WHITE))

    # -- compose + export ------------------------------------------------------

    def compose(self) -> None:
        self.paint_base()
        if self.geo.get("ridge"):
            self.paint_ridge()
        self.paint_lakes()
        self.paint_river()
        self.plan_highway()
        self.plan_towns()
        self.paint_roads()
        self.paint_paths()
        self.paint_bridge()
        self.paint_fields()
        self.dress_towns()
        self.paint_forests()
        self.paint_dressing()

    def render_png(self):
        from PIL import Image

        canvas = Image.new("RGBA", (OUT_W, OUT_H))

        def draw_layer(name: str) -> None:
            grid = self.m.layers[name]
            for y in range(OW_H):
                row = grid[y]
                for x in range(OW_W):
                    raw = row[x]
                    if not raw:
                        continue
                    img = tile_img(raw)
                    if img is not None:
                        canvas.alpha_composite(img, (x * T, y * T))

        for layer in ("ground", "ground-detail", "deco-below", "buildings-base"):
            draw_layer(layer)
        # stamps painter-sorted by their baseline, like the scene depth sort
        for stamp, x, y in sorted(self.stamps, key=lambda s: s[2] + s[0].h):
            for r, c, g in stamp.cells():
                px, py = (x + c) * T, (y + r) * T
                if 0 <= px < OUT_W and 0 <= py < OUT_H:
                    img = tile_img(g)
                    if img is not None:
                        canvas.alpha_composite(img, (px, py))
        draw_layer("buildings-top")
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
    rng = random.Random(_stable_seed(f"overworld-clouds-v3/{scenario}"))
    alpha = [[0] * cw for _ in range(ch)]
    for _ in range(5):
        cx, cy = rng.randrange(cw), rng.randrange(ch)
        for _ in range(rng.randint(3, 5)):
            lx = cx + rng.uniform(-16, 16)
            ly = cy + rng.uniform(-7, 7)
            lrx = rng.uniform(8, 15)
            lry = rng.uniform(4, 8)
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


def _generic_geography(scenario: str, towns: dict[str, str]) -> dict:
    """Deterministic layout for a scenario without a GEOGRAPHY entry: pads
    on a gentle ring, a tan road chaining them, one lake."""
    rng = random.Random(_stable_seed(f"overworld-layout/{scenario}"))
    ids = sorted(towns)
    pads: dict[str, tuple[int, int]] = {}
    connector: dict[str, str] = {}
    for i, tid in enumerate(ids):
        th = math.tau * i / max(1, len(ids)) + rng.uniform(-0.2, 0.2)
        cx = OW_W / 2 + math.cos(th) * OW_W * 0.28
        cy = OW_H / 2 + math.sin(th) * OW_H * 0.26
        x = int(min(OW_W - PAD_W - 2, max(2, cx - PAD_W / 2)))
        y = int(min(OW_H - PAD_H - 3, max(1, cy - PAD_H / 2)))
        pads[tid] = (x, y)
        connector[tid] = "e" if x + PAD_W / 2 < OW_W / 2 else "w"
    paths = []
    for i in range(len(ids)):
        a, b = ids[i], ids[(i + 1) % len(ids)]
        if a == b:
            break
        paths.append([f"{a}:{'w' if connector[a] == 'e' else 'e'}", f"{b}:{connector[b]}"])
    return {
        "pads": pads,
        "connector": connector,
        "highway": None,
        "paths": paths,
        "ridge": False,
        "lakes": [(OW_W * 0.5, OW_H * 0.14, 4.5, 2.4)],
        "fields": [],
        "river": None,
        "forest_clusters": 10,
        "lone_trees": 12,
        "tree_mood": ("tree_light", "tree_dark"),
    }


def compose_overworld(scenario: str) -> Overworld:
    """Build (but do not write) a scenario's overworld — also the test seam."""
    scenario = _validated_id(scenario, label="scenario id")
    town_files = _town_files(scenario)
    if not town_files:
        raise ValueError(f"scenario {scenario!r} has no towns")
    towns = {p.stem: json.loads(p.read_text()).get("name", p.stem) for p in town_files}

    geo = GEOGRAPHY.get(scenario)
    if geo is None:
        geo = _generic_geography(scenario, towns)
    geo = {**geo, "pads": dict(geo["pads"]), "connector": dict(geo.get("connector") or {})}
    missing = [tid for tid in towns if tid not in geo["pads"]]
    for i, tid in enumerate(missing):  # park unknown towns on open ground
        geo["pads"][tid] = (
            int(min(OW_W - PAD_W - 2, 3 + (OW_W - PAD_W - 6) * (i % 3) / 2)),
            int(min(OW_H - PAD_H - 3, 8 + 16 * (i // 3))),
        )
        geo["connector"].setdefault(tid, "e")

    o = Overworld(scenario, geo, towns)
    o.pads = {tid: Pad(int(px), int(py)) for tid, (px, py) in geo["pads"].items() if tid in towns}
    o.compose()
    return o


def render(scenario: str) -> Path:
    from PIL import Image

    o = compose_overworld(scenario)
    scenario = o.scenario
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
        "version": SITES_VERSION,
        "scenario": scenario,
        "image": {
            "path": "overworld.png",
            "path2x": "overworld@2x.png",
            "width": OUT_W,
            "height": OUT_H,
            "tile": T,
        },
        "clouds": {
            "path": "overworld-clouds.png",
            "path2x": "overworld-clouds@2x.png",
            "tileable": True,
        },
        "sites": sorted(o.sites, key=lambda s: s["id"]),
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
