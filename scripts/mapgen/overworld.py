#!/usr/bin/env python3
"""Pixel overworld renderer for the District Atlas (one page per scenario).

Paints a storybook overworld — rolling multi-tone grass, forest clusters,
water, a ridgeline hint, connecting roads with dashes — in the towns' own
pixel language (every opaque color is quantized to the rpg-tileset palette,
matching ``moderntiles.py``). Town sites stay as clearly-marked flat
clearings; the frontend drops its vignettes/pins on the exported pixel
coordinates. Outputs, under ``frontend/public/assets/maps/<scenario>/``:

- ``overworld.png``          1100x700 terrain panel (@1x; 2px pixel grain)
- ``overworld@2x.png``       2200x1400 nearest-neighbour upscale
- ``overworld-clouds.png``   translucent cloud-shadow blobs (+ ``@2x``),
                             tileable on both axes so the frontend can
                             drift the layer freely
- ``overworld-sites.json``   per-town clearing coordinates (see README)

Scenario geography (site positions, highway band, river, ridgeline) is
declared in ``GEOGRAPHY`` below — the same pattern as the hand-tuned town
layouts; scenarios without an entry get a deterministic generic layout from
their ``scenarios/<id>/towns/*.json`` files alone.

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
from mapgen.moderntiles import _load_palette  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
MAPS_DIR = REPO_ROOT / "frontend/public/assets/maps"
PACKAGE_ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

#: exported panel size at 1x; painting happens at half resolution so every
#: overworld "pixel" is a crisp 2x2 block at 1x (4x4 at @2x)
OUT_W, OUT_H = 1100, 700
IW, IH = OUT_W // 2, OUT_H // 2

# ---------------------------------------------------------------------------
# scenario geography (1x pixel coordinates in the 1100x700 panel)
# ---------------------------------------------------------------------------

GEOGRAPHY: dict[str, dict] = {
    "nj11-2026": {
        # west-to-east like the real district: Dover / Randolph in the west,
        # Parsippany center, Montclair out east
        "sites": {
            "dover": (235, 330),
            "randolph": (330, 525),
            "parsippany": (630, 295),
            "montclair": (925, 435),
        },
        # I-80-like band sweeping W->E past Dover and Parsippany
        "highway": [(-40, 390), (180, 350), (420, 300), (630, 300), (860, 370), (1140, 430)],
        # the highway itself links Dover / Parsippany / Montclair; local tan
        # roads cover the south, plus spurs running off the page edges
        "roads": [("dover", "randolph"), ("randolph", "montclair")],
        "spurs": [("randolph", (150, 730)), ("montclair", (1140, 560)), ("parsippany", (660, -30))],
        # Highlands / Watchung ridgeline hint across the north
        "ridge": [(30, 130), (280, 95), (540, 125), (800, 80), (1070, 115)],
        "lakes": [(790, 205, 78, 40), (100, 560, 60, 32)],
        "river": None,
    },
    "millbrook-budget": {
        "sites": {
            "millbrook-village": (335, 285),
            "harlow-crossing": (755, 435),
        },
        "highway": None,
        "roads": [("millbrook-village", "harlow-crossing")],
        "spurs": [("millbrook-village", (-30, 210)), ("harlow-crossing", (1130, 620))],
        "ridge": [(40, 600), (300, 640), (620, 600), (900, 645), (1080, 610)],
        "lakes": [(915, 145, 56, 30)],
        # the Millbrook river runs top-to-bottom between the two towns
        "river": [(560, -20), (520, 130), (545, 300), (600, 470), (570, 720)],
    },
}

# Intended colors, sampled from the rpg tileset's own grass / tree / water /
# path tiles so the page speaks the exact same bright language as the towns
# (any near-miss still snaps to the palette at export).
K_TREE = (54, 74, 76)  # canopy outline used by the tileset's trees
GRASS = [(80, 193, 64), (100, 209, 76), (136, 222, 95)]
GRASS_SPECK = (158, 212, 72)
FLOWER = (238, 234, 222)
MEADOW = [(158, 212, 72), (192, 223, 89)]
MEADOW_EDGE = (132, 194, 59)
FOREST = [(61, 108, 67), (85, 141, 68), (85, 141, 68)]
FOREST_HI = (140, 189, 74)
RIDGE = (105, 192, 79)
RIDGE_SH = (85, 141, 68)
RIDGE_HI = (158, 212, 72)
RIDGE_DK = (61, 108, 67)
WATER = (120, 115, 215)  # the ai-town tileset's rivers really are indigo
WATER_DK = (121, 154, 255)
WATER_EDGE = (53, 47, 71)
WATER_SHORE = (121, 154, 255)
WATER_SPARK = (122, 181, 255)
ROAD_TAN = [(235, 185, 124), (237, 177, 120)]
ROAD_EDGE = (143, 87, 70)
ROAD_DASH = (250, 220, 164)
ASPHALT = [(88, 82, 76), (84, 78, 73)]
ASPHALT_EDGE = (45, 39, 34)
ASPHALT_DASH = (224, 212, 186)
BRIDGE = (152, 106, 62)
BRIDGE_DK = (100, 68, 40)
CLOUD = (24, 32, 52)


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
# tiny value-noise + geometry helpers
# ---------------------------------------------------------------------------


def _smooth_noise(rng: random.Random, w: int, h: int, cell: int) -> list[list[float]]:
    gw, gh = w // cell + 2, h // cell + 2
    g = [[rng.random() for _ in range(gw)] for _ in range(gh)]
    out = [[0.0] * w for _ in range(h)]
    for y in range(h):
        gy, fy = divmod(y, cell)
        ty = fy / cell
        ty = ty * ty * (3 - 2 * ty)
        row = out[y]
        g0, g1 = g[gy], g[gy + 1]
        for x in range(w):
            gx, fx = divmod(x, cell)
            tx = fx / cell
            tx = tx * tx * (3 - 2 * tx)
            a = g0[gx] + (g0[gx + 1] - g0[gx]) * tx
            b = g1[gx] + (g1[gx + 1] - g1[gx]) * tx
            row[x] = a + (b - a) * ty
    return out


def _rolling(rng: random.Random, w: int, h: int) -> list[list[float]]:
    n1 = _smooth_noise(rng, w, h, 56)
    n2 = _smooth_noise(rng, w, h, 20)
    return [
        [0.72 * n1[y][x] + 0.28 * n2[y][x] for x in range(w)]  # rolling + detail
        for y in range(h)
    ]


def _catmull_rom(points: list[tuple[float, float]], step: float = 1.0) -> list[tuple[float, float]]:
    """Sample a smooth curve through the waypoints, ~step px apart."""
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


# ---------------------------------------------------------------------------
# painter
# ---------------------------------------------------------------------------


class Overworld:
    """Half-resolution painter; grids of intended-color tuples + masks."""

    def __init__(self, scenario: str) -> None:
        self.scenario = scenario
        self.rng = random.Random(_stable_seed(f"overworld/{scenario}"))
        self.px: list[list[tuple[int, int, int]]] = [[GRASS[1]] * IW for _ in range(IH)]
        self.water: set[tuple[int, int]] = set()
        self.road: set[tuple[int, int]] = set()
        self.keepout: set[tuple[int, int]] = set()  # no forest here
        self.sites: list[dict] = []

    def inb(self, x: int, y: int) -> bool:
        return 0 <= x < IW and 0 <= y < IH

    def put(self, x: int, y: int, c: tuple[int, int, int]) -> None:
        if self.inb(x, y):
            self.px[y][x] = c

    # -- terrain layers ------------------------------------------------------

    def paint_grass(self) -> None:
        rng = self.rng
        field = _rolling(random.Random(rng.random()), IW, IH)
        for y in range(IH):
            for x in range(IW):
                n = field[y][x] + rng.uniform(-0.045, 0.045)  # dithered bands
                if n < 0.42:
                    c = GRASS[0]
                elif n < 0.68:
                    c = GRASS[1]
                else:
                    c = GRASS[2]
                if rng.random() < 0.012:
                    c = GRASS_SPECK
                elif rng.random() < 0.0016:
                    c = FLOWER
                self.px[y][x] = c

    def paint_ridge(self, polyline: list[tuple[float, float]]) -> None:
        """A hint of ridgeline: one continuous band (a union of overlapping
        hill lobes) shaded as a whole — light crest along the top contour,
        shade along the south face, soft outline around the union."""
        rng = self.rng
        pts = _catmull_rom([(x / 2, y / 2) for x, y in polyline], step=7)
        mask: set[tuple[int, int]] = set()
        for i, (bx, by) in enumerate(pts):
            w = 13 + 7 * math.sin(i * 0.7 + rng.random())
            h = 6 + 3 * math.sin(i * 1.3 + rng.random())
            for dy in range(-int(h) - 1, int(h) + 2):
                for dx in range(-int(w) - 1, int(w) + 2):
                    if (dx / w) ** 2 + (dy / h) ** 2 <= 1.0:
                        p = (int(bx + dx), int(by + dy))
                        if self.inb(*p) and p not in self.water:
                            mask.add(p)
        for x, y in mask:
            above = (x, y - 1) not in mask or (x, y - 2) not in mask
            below = (x, y + 1) not in mask or (x, y + 2) not in mask
            outline = any(
                (x + dx, y + dy) not in mask for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
            )
            if outline:
                c = RIDGE_DK
            elif above:
                c = RIDGE_HI
            elif below:
                c = RIDGE_SH
            else:
                c = RIDGE_SH if rng.random() < 0.12 else RIDGE
            self.px[y][x] = c
            self.keepout.add((x, y))
        # a wooded crest sells the ridge: small trees strung along the curve
        for i, (bx, by) in enumerate(pts):
            if i % 3:
                continue
            tx = int(bx + rng.uniform(-6, 6))
            ty = int(by + rng.uniform(-3, 2))
            if self.inb(tx, ty) and (tx, ty) not in self.water:
                self._tree(tx, ty, rng.randint(2, 4))

    def _fill_water(self, cells: set[tuple[int, int]]) -> None:
        rng = self.rng
        for x, y in cells:
            edge = any(
                (x + dx, y + dy) not in cells for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
            )
            near = any(
                (x + dx, y + dy) not in cells
                for dx in (-2, -1, 0, 1, 2)
                for dy in (-2, -1, 0, 1, 2)
            )
            if edge:
                c = WATER_EDGE
            elif near:
                c = WATER_SHORE
            else:
                c = WATER_DK if rng.random() < 0.1 else WATER
            self.put(x, y, c)
        self.water |= cells
        self.keepout |= cells
        # sparkle dashes on open water
        open_cells = [p for p in cells if all((p[0] + d, p[1]) in cells for d in (-3, 3))]
        rng.shuffle(open_cells)
        for x, y in open_cells[: max(4, len(open_cells) // 90)]:
            for d in range(rng.randint(2, 4)):
                self.put(x + d, y, WATER_SPARK)

    def paint_lake(self, cx: float, cy: float, rx: float, ry: float) -> None:
        rng = random.Random(self.rng.random())
        wob = _smooth_noise(rng, int(rx * 2 + 8), int(ry * 2 + 8), 9)
        cells = set()
        x0, y0 = int(cx / 2 - rx), int(cy / 2 - ry)
        for yy in range(int(ry * 2 + 1)):
            for xx in range(int(rx * 2 + 1)):
                dx = (xx - rx) / rx
                dy = (yy - ry) / ry
                if dx * dx + dy * dy <= 0.72 + 0.4 * wob[yy][xx]:
                    p = (x0 + xx, y0 + yy)
                    if self.inb(*p):
                        cells.add(p)
        self._fill_water(cells)

    def paint_river(self, polyline: list[tuple[float, float]]) -> None:
        rng = self.rng
        pts = _catmull_rom([(x / 2, y / 2) for x, y in polyline], step=1.0)
        cells = set()
        for i, (x, y) in enumerate(pts):
            r = 5.5 + 1.6 * math.sin(i / 26.0) + rng.uniform(-0.3, 0.3)
            ir = int(r + 1)
            for dy in range(-ir, ir + 1):
                for dx in range(-ir, ir + 1):
                    if dx * dx + dy * dy <= r * r:
                        p = (int(x + dx), int(y + dy))
                        if self.inb(*p):
                            cells.add(p)
        self._fill_water(cells)

    # -- roads ----------------------------------------------------------------

    def _stroke(
        self,
        pts: list[tuple[float, float]],
        half: float,
        fill: list[tuple[int, int, int]],
        edge: tuple[int, int, int],
        dash: tuple[int, int, int] | None,
        dash_period: int,
        bridge: bool = False,
    ) -> None:
        rng = self.rng
        band: set[tuple[int, int]] = set()
        center: list[tuple[int, int]] = []
        ir = int(half + 1)
        for x, y in pts:
            center.append((int(x), int(y)))
            for dy in range(-ir, ir + 1):
                for dx in range(-ir, ir + 1):
                    if dx * dx + dy * dy <= half * half:
                        p = (int(x + dx), int(y + dy))
                        if self.inb(*p):
                            band.add(p)
        deck = {p for p in band if p in self.water} if bridge else set()
        for x, y in band:
            over = (x, y) in deck
            is_edge = any(
                (x + dx, y + dy) not in band for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
            )
            if over:
                self.put(x, y, BRIDGE_DK if is_edge else BRIDGE)
            elif is_edge:
                self.put(x, y, edge)
            else:
                self.put(x, y, rng.choice(fill))
        self.road |= band
        self.keepout |= band
        if dash is not None:
            dist = 0.0
            last = pts[0]
            for x, y in pts[1:]:
                dist += math.dist(last, (x, y))
                last = (x, y)
                phase = dist % dash_period
                if phase < dash_period * 0.42 and (int(x), int(y)) not in deck:
                    if all(
                        (int(x) + dx, int(y) + dy) in band for dx in (-1, 0, 1) for dy in (-1, 0, 1)
                    ):
                        self.put(int(x), int(y), dash)

    def paint_highway(self, waypoints: list[tuple[float, float]]) -> None:
        pts = _catmull_rom([(x / 2, y / 2) for x, y in waypoints], step=1.0)
        self._stroke(pts, 4.2, ASPHALT, ASPHALT_EDGE, ASPHALT_DASH, dash_period=10)

    def paint_road(self, a: tuple[float, float], b: tuple[float, float]) -> None:
        rng = self.rng
        ax, ay = a[0] / 2, a[1] / 2
        bx, by = b[0] / 2, b[1] / 2
        # two perpendicular bows with opposite signs => a lazy S meander
        nx, ny = -(by - ay), bx - ax
        norm = math.hypot(nx, ny) or 1.0
        length = math.dist((ax, ay), (bx, by))
        s = rng.choice((-1, 1))
        way = [(ax, ay)]
        for f, sign in ((1 / 3, s), (2 / 3, -s)):
            bow = sign * rng.uniform(0.07, 0.15) * length
            way.append((ax + (bx - ax) * f + nx / norm * bow, ay + (by - ay) * f + ny / norm * bow))
        way.append((bx, by))
        pts = _catmull_rom(way, step=1.0)
        self._stroke(pts, 2.7, ROAD_TAN, ROAD_EDGE, ROAD_DASH, dash_period=11, bridge=True)

    # -- clearings + forest ----------------------------------------------------

    def paint_clearing(self, town_id: str, name: str, cx: float, cy: float) -> None:
        rng = self.rng
        x0, y0 = cx / 2, cy / 2
        rx, ry = 34, 23
        for dy in range(-ry - 2, ry + 3):
            for dx in range(-rx - 2, rx + 3):
                d = (dx / rx) ** 2 + (dy / ry) ** 2
                p = (int(x0 + dx), int(y0 + dy))
                if not self.inb(*p):
                    continue
                if d <= 1.0 + rng.uniform(-0.06, 0.02):
                    if p not in self.road:
                        if d > 0.86:
                            c = MEADOW_EDGE
                        else:
                            c = MEADOW[0] if rng.random() < 0.14 else GRASS[2]
                        self.put(*p, c)
                    self.keepout.add(p)
                elif d <= 1.22:
                    self.keepout.add(p)  # breathing room, no trees hard against it
        # faint dashed footpath ring marking the site
        steps = 64
        for i in range(steps):
            if (i // 4) % 2:
                continue
            th = i / steps * math.tau
            p = (int(x0 + math.cos(th) * (rx - 2)), int(y0 + math.sin(th) * (ry - 2)))
            if self.inb(*p) and p not in self.road:
                self.put(*p, ROAD_TAN[1])
        self.sites.append(
            {
                "town_id": town_id,
                "name": name,
                "x": int(cx),
                "y": int(cy),
                "clearing": {"rx": rx * 2, "ry": ry * 2},
            }
        )

    def _tree(self, x: int, y: int, r: int) -> None:
        rng = self.rng
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                d2 = dx * dx + dy * dy
                if d2 > r * r:
                    continue
                p = (x + dx, y + dy)
                if not self.inb(*p):
                    continue
                if d2 > (r - 0.8) ** 2:
                    c = K_TREE
                elif dx - dy < -r * 0.75:
                    c = FOREST_HI  # top-left light
                elif dy > r * 0.35:
                    c = FOREST[0]
                else:
                    c = FOREST[1] if rng.random() < 0.6 else FOREST[2]
                self.put(*p, c)
        self.put(x, y + r + 1, K_TREE)  # grounding shadow nub

    def paint_forests(self, clusters: int) -> None:
        rng = self.rng
        placed = 0
        attempts = 0
        while placed < clusters and attempts < clusters * 30:
            attempts += 1
            cx = rng.randint(18, IW - 18)
            cy = rng.randint(14, IH - 14)
            if any(
                (cx + dx, cy + dy) in self.keepout for dx in (-14, 0, 14) for dy in (-10, 0, 10)
            ):
                continue
            trees = []
            for _ in range(rng.randint(22, 38)):
                tx = int(cx + rng.gauss(0, 8))
                ty = int(cy + rng.gauss(0, 5))
                tr = rng.randint(3, 5)
                if self.inb(tx, ty) and not any(
                    (tx + dx, ty + dy) in self.keepout for dx in (-tr, 0, tr) for dy in (-tr, 0, tr)
                ):
                    trees.append((tx, ty, tr))
            if len(trees) < 5:
                continue
            for tx, ty, tr in sorted(trees, key=lambda t: t[1]):
                self._tree(tx, ty, tr)
            placed += 1
        # a few lone trees scattered on open grass
        for _ in range(26):
            tx = rng.randint(10, IW - 10)
            ty = rng.randint(8, IH - 8)
            tr = rng.randint(3, 4)
            if not any(
                (tx + dx, ty + dy) in self.keepout
                for dx in (-tr - 2, 0, tr + 2)
                for dy in (-tr - 2, 0, tr + 2)
            ):
                self._tree(tx, ty, tr)


# ---------------------------------------------------------------------------
# clouds + export
# ---------------------------------------------------------------------------


def _cloud_layer(scenario: str):
    """Translucent cloud-shadow blobs, tileable on both axes."""
    from PIL import Image

    rng = random.Random(_stable_seed(f"overworld-clouds/{scenario}"))
    alpha = [[0] * IW for _ in range(IH)]
    for _ in range(7):
        cx, cy = rng.randrange(IW), rng.randrange(IH)
        lobes = []
        for _ in range(rng.randint(3, 5)):
            lobes.append(
                (
                    cx + rng.uniform(-26, 26),
                    cy + rng.uniform(-10, 10),
                    rng.uniform(11, 22),
                    rng.uniform(6, 11),
                )
            )
        for lx, ly, lrx, lry in lobes:
            x0, x1 = int(lx - lrx - 3), int(lx + lrx + 4)
            y0, y1 = int(ly - lry - 3), int(ly + lry + 4)
            for y in range(y0, y1):
                for x in range(x0, x1):
                    d = ((x - lx) / lrx) ** 2 + ((y - ly) / lry) ** 2
                    if d > 1.25:
                        continue
                    wx, wy = x % IW, y % IH  # wrap => seamless drift
                    if d <= 0.85:
                        alpha[wy][wx] = max(alpha[wy][wx], 42)
                    elif rng.random() < (1.25 - d) * 1.9:  # dithered fringe
                        alpha[wy][wx] = max(alpha[wy][wx], 26)
    img = Image.new("RGBA", (IW, IH), (0, 0, 0, 0))
    for y in range(IH):
        for x in range(IW):
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
        # deterministic generic layout: towns on a gentle ring, chained roads
        rng = random.Random(_stable_seed(f"overworld-layout/{scenario}"))
        ids = sorted(towns)
        sites = {}
        for i, tid in enumerate(ids):
            th = math.tau * i / len(ids) + rng.uniform(-0.2, 0.2)
            sites[tid] = (
                OUT_W / 2 + math.cos(th) * OUT_W * 0.3,
                OUT_H / 2 + math.sin(th) * OUT_H * 0.28,
            )
        geo = {
            "sites": sites,
            "highway": None,
            "roads": [(ids[i], ids[(i + 1) % len(ids)]) for i in range(len(ids))]
            if len(ids) > 1
            else [],
            "ridge": None,
            "lakes": [(OUT_W * 0.82, OUT_H * 0.18, 64, 36)],
            "river": None,
        }

    o = Overworld(scenario)
    o.paint_grass()
    if geo.get("ridge"):
        o.paint_ridge(geo["ridge"])
    for cx, cy, rx, ry in geo.get("lakes") or []:
        o.paint_lake(cx, cy, rx / 2, ry / 2)
    if geo.get("river"):
        o.paint_river(geo["river"])
    if geo.get("highway"):
        o.paint_highway(geo["highway"])
    sites = geo["sites"]
    for a, b in geo.get("roads") or []:
        if a in sites and b in sites:
            o.paint_road(sites[a], sites[b])
    for town, edge_pt in geo.get("spurs") or []:
        if town in sites:
            o.paint_road(sites[town], edge_pt)
    for tid in sorted(towns):
        if tid in sites:
            cx, cy = sites[tid]
        else:  # town missing from the hand layout: park it on open ground
            idx = sorted(towns).index(tid)
            cx, cy = OUT_W * (0.2 + 0.6 * (idx % 3) / 2), OUT_H * (0.25 + 0.5 * (idx // 3))
        o.paint_clearing(tid, towns[tid], cx, cy)
    o.paint_forests(clusters=16 if geo.get("highway") else 18)

    # quantize intended colors to the rpg-tileset palette (cached per color)
    palette = _load_palette()
    qcache: dict[tuple[int, int, int], tuple[int, int, int]] = {}

    def q(c: tuple[int, int, int]) -> tuple[int, int, int]:
        if c not in qcache:
            r, g, b = c
            qcache[c] = min(
                palette, key=lambda p: (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2
            )
        return qcache[c]

    img = Image.new("RGB", (IW, IH))
    put = img.putpixel
    for y in range(IH):
        row = o.px[y]
        for x in range(IW):
            put((x, y), q(row[x]))

    out1 = _out_path(scenario, "overworld.png")
    out1.parent.mkdir(parents=True, exist_ok=True)
    img.resize((OUT_W, OUT_H), Image.NEAREST).save(out1)
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
        "sites": o.sites,
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
