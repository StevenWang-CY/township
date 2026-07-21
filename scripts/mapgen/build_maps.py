#!/usr/bin/env python3
"""Scenario-parameterized Tiled map builder for Township towns.

Reads a town JSON from ``scenarios/<id>/towns/<town>.json`` (landmarks in a
1200x800 px space = 75x50 tiles of 16 px) and emits
``frontend/public/assets/maps/<scenario>/<town>.tmj`` with the layer contract TownScene
binds to:

    tile layers   : ground, ground-detail, deco-below, buildings-base,
                    buildings-top
    object layers : collision (rects), anchors (points; properties
                    {kind: lamp|tree|flower|smoke|water-foam|windmill|label,
                     stamp: <registry stamp name, for trees>})

``buildings-top`` holds what agents walk BEHIND (roof rows, awnings).
Anchor sprites are placed by TownScene; the preview renderer approximates
them with registry stamps so previews look complete.

A town may ship a hand-tuned layout module under
``scripts/mapgen/layouts/<scenario>/<town>.py`` (hyphens become underscores),
exporting ``compose(m: MapCanvas)``. Without one, a generic interpreter
composes every landmark by type; another scenario can safely reuse the id.

Run:
    python3 -m scripts.mapgen.build_maps --scenario nj11-2026 --town dover
    python3 -m scripts.mapgen.build_maps --scenario nj11-2026 --all
"""

from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import random
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mapgen import moderntiles as M  # noqa: E402
from mapgen import tiles as R  # noqa: E402


def _stable_seed(label: str) -> int:
    """Return the same map seed regardless of PYTHONHASHSEED or platform."""
    return int.from_bytes(hashlib.sha256(label.encode("utf-8")).digest()[:8], "big")


from mapgen.tiles import Blob, TileStamp  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
MAPS_DIR = REPO_ROOT / "frontend/public/assets/maps"
PACKAGE_ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def _validated_id(value: str, *, label: str) -> str:
    if not isinstance(value, str) or PACKAGE_ID_RE.fullmatch(value) is None:
        raise ValueError(f"{label} must use lowercase letters, numbers, and single hyphens")
    return value


def _scenario_town_file(scenario: str, town_id: str) -> Path:
    scenario = _validated_id(scenario, label="scenario id")
    town_id = _validated_id(town_id, label="town id")
    scenarios_root = (REPO_ROOT / "scenarios").resolve()
    package = scenarios_root / scenario
    town_path = package / "towns" / f"{town_id}.json"
    if package.is_symlink() or town_path.is_symlink():
        raise ValueError("map inputs must not be symbolic links")
    resolved = town_path.resolve()
    if not resolved.is_relative_to(scenarios_root) or not resolved.is_file():
        raise ValueError("town map input is missing or outside the scenarios directory")
    return resolved


def _map_output_path(out_dir: Path, scenario: str, town_id: str) -> Path:
    root = Path(out_dir).resolve()
    scenario_dir = root / _validated_id(scenario, label="scenario id")
    if scenario_dir.is_symlink() or not scenario_dir.resolve().is_relative_to(root):
        raise ValueError("map output must stay inside the map directory")
    output = scenario_dir / f"{_validated_id(town_id, label='town id')}.tmj"
    if output.resolve().parent != scenario_dir.resolve():
        raise ValueError("map output must remain in its scenario namespace")
    return output


def _layout_module(scenario: str, town_id: str):
    scenario_module = scenario.replace("-", "_")
    town_module = town_id.replace("-", "_")
    layout_file = Path(__file__).parent / "layouts" / scenario_module / f"{town_module}.py"
    if not layout_file.is_file():
        return None
    return importlib.import_module(f"mapgen.layouts.{scenario_module}.{town_module}")


T = 16
MAP_W, MAP_H = 75, 50
LAYER_NAMES = ("ground", "ground-detail", "deco-below", "buildings-base", "buildings-top")


# ---------------------------------------------------------------------------
# small stamp algebra
# ---------------------------------------------------------------------------


def _cycle(seq, n: int) -> list:
    seq = list(seq)
    return [seq[i % len(seq)] for i in range(n)]


def pad_stamp(stamp: TileStamp, w: int, h: int, name: str = "") -> TileStamp:
    """Resize a rounded pad stamp (deck, stone pad) by repeating its
    interior rows/columns while keeping its border rows/columns."""
    rows = stamp.gids
    H, W = len(rows), len(rows[0])
    cols = [0] + _cycle(range(1, W - 1), max(0, w - 2)) + ([W - 1] if w > 1 else [])
    rws = [0] + _cycle(range(1, H - 1), max(0, h - 2)) + ([H - 1] if h > 1 else [])
    return TileStamp(
        name or f"{stamp.name}_{w}x{h}", tuple(tuple(rows[r][c] for c in cols) for r in rws)
    )


#: facade name -> (stamp, plain interior column indices, arch column span)
FACADES: dict[str, tuple[TileStamp, list[int], tuple[int, int] | None]] = {
    "brick": (R.FACADE_BRICK, [5, 6], (1, 4)),
    "cream": (R.FACADE_CREAM, [5, 6], (2, 4)),
    "stone_gray": (R.FACADE_STONE_GRAY, [1, 6], (2, 5)),
    "stone_large": (R.FACADE_STONE_LARGE, [1, 2, 3, 4], None),
    "stone_small": (R.FACADE_STONE_SMALL, [1, 2], None),
}

ROOFS: dict[str, TileStamp] = {
    "deck_dark": R.DECK_DARK,
    "deck_light": R.DECK_LIGHT,
    "stone": R.STONE_PAD_DARK,
}


def facade_wall(
    name: str, w: int, rows: list[int] | None = None, with_arch: bool = False
) -> TileStamp:
    """Compose a w-wide wall strip from a facade stamp's columns."""
    stamp, interior, arch = FACADES[name]
    W = stamp.w
    if with_arch and arch and w >= (arch[1] - arch[0] + 3):
        arch_cols = list(range(arch[0], arch[1] + 1))
        side = w - 2 - len(arch_cols)
        left = _cycle(interior, side // 2)
        right = _cycle(interior, side - side // 2)
        cols = [0] + left + arch_cols + right + [W - 1]
    else:
        cols = [0] + _cycle(interior, max(0, w - 2)) + ([W - 1] if w > 1 else [])
    row_idx = rows if rows is not None else list(range(stamp.h))
    return TileStamp(
        f"wall_{name}_{w}", tuple(tuple(stamp.gids[r][c] for c in cols) for r in row_idx)
    )


def awning_strip(w: int) -> TileStamp:
    """Striped awning sliced from the market stall's top rows."""
    rows = R.MARKET_STALL.gids
    W = len(rows[0])
    cols = [0] + _cycle([1, 2, 3, 4], max(0, w - 2)) + ([W - 1] if w > 1 else [])
    return TileStamp(f"awning_{w}", tuple(tuple(rows[r][c] for c in cols) for r in (0, 1)))


# ---------------------------------------------------------------------------
# canvas
# ---------------------------------------------------------------------------


@dataclass
class RoadSeg:
    orient: str  # "h" | "v"
    a0: int  # x0 (h) / y0 (v), inclusive
    a1: int  # x1 / y1, inclusive
    c: int  # top row (h) / left col (v)
    width: int = 3


@dataclass
class Landmark:
    name: str
    type: str
    x: int
    y: int
    w: int
    h: int
    raw: dict = field(default_factory=dict)


class MapCanvas:
    """75x50 tile canvas with the five Township layers plus collision and
    anchor emitters. All helper coordinates are tile-space."""

    def __init__(self, town_id: str, town: dict, seed: int = 7) -> None:
        self.town_id = town_id
        self.town = town
        self.w, self.h = MAP_W, MAP_H
        self.layers: dict[str, list[list[int]]] = {
            n: [[0] * self.w for _ in range(self.h)] for n in LAYER_NAMES
        }
        self.rng = random.Random(seed)
        self.collision: list[tuple[float, float, float, float]] = []
        self.anchors: list[dict] = []
        self.road_segs: list[RoadSeg] = []
        self.road_mask: set[tuple[int, int]] = set()
        self.paved: set[tuple[int, int]] = set()  # extra sidewalk cells
        self.reserved: set[tuple[int, int]] = set()  # no sidewalk/deco here
        self.landmarks: dict[str, Landmark] = {}
        for lm in town.get("landmarks", []):
            self.landmarks[lm["name"]] = Landmark(
                lm["name"],
                lm.get("type", "building"),
                round(lm["x"] / T),
                round(lm["y"] / T),
                max(1, round(lm["width"] / T)),
                max(1, round(lm["height"] / T)),
                lm,
            )

    # -- primitives ---------------------------------------------------------

    def inb(self, x: int, y: int) -> bool:
        return 0 <= x < self.w and 0 <= y < self.h

    def set(self, layer: str, x: int, y: int, g: int) -> None:
        if self.inb(x, y):
            self.layers[layer][y][x] = g

    def get(self, layer: str, x: int, y: int) -> int:
        return self.layers[layer][y][x] if self.inb(x, y) else -1

    def fill(self, layer: str, x: int, y: int, w: int, h: int, choices) -> None:
        choices = list(choices)
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.set(layer, xx, yy, self.rng.choice(choices))

    def stamp(self, layer: str, s: TileStamp, x: int, y: int) -> None:
        for r, c, g in s.cells():
            self.set(layer, x + c, y + r, g)

    def building_stamp(self, s: TileStamp, x: int, y: int, top_rows: int) -> None:
        """Stamp with its first ``top_rows`` rows in buildings-top."""
        for r, c, g in s.cells():
            layer = "buildings-top" if r < top_rows else "buildings-base"
            self.set(layer, x + c, y + r, g)

    def clear(self, layer: str, x: int, y: int, w: int, h: int) -> None:
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.set(layer, xx, yy, 0)

    # -- autotiling ---------------------------------------------------------

    def blob(
        self,
        layer: str,
        cells: set[tuple[int, int]],
        b: Blob,
        holes: bool = True,
        fringe: bool = False,
    ) -> None:
        """Paint an organic patch: fill + edges + convex corners inside the
        mask, inverse (hole) corners just outside concave bends. With
        ``fringe=True`` the blob's overhang tiles (``fringe_n`` …) are also
        scattered one cell OUTSIDE each edge, onto empty unreserved cells,
        softening the transition into the neighbour terrain."""
        rng = self.rng
        for x, y in cells:
            n = (x, y - 1) not in cells
            s = (x, y + 1) not in cells
            w = (x - 1, y) not in cells
            e = (x + 1, y) not in cells
            g = 0
            if n and w and b.nw:
                g = b.nw
            elif n and e and b.ne:
                g = b.ne
            elif s and w and b.sw:
                g = b.sw
            elif s and e and b.se:
                g = b.se
            elif n and b.n:
                g = rng.choice(b.n)
            elif s and b.s:
                g = rng.choice(b.s)
            elif w and b.w:
                g = rng.choice(b.w)
            elif e and b.e:
                g = rng.choice(b.e)
            else:
                g = rng.choice(b.fill)
            self.set(layer, x, y, g)
        if holes and b.hole_nw:
            # concave fillets on the outside of the mask
            checked: set[tuple[int, int]] = set()
            for x, y in cells:
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        p = (x + dx, y + dy)
                        if p in cells or p in checked or not self.inb(*p):
                            continue
                        checked.add(p)
                        px, py = p
                        nin = (px, py - 1) in cells
                        sin = (px, py + 1) in cells
                        win = (px - 1, py) in cells
                        ein = (px + 1, py) in cells
                        opts = []
                        if nin and win and (px - 1, py - 1) in cells:
                            opts.append(b.hole_nw)
                        if nin and ein and (px + 1, py - 1) in cells:
                            opts.append(b.hole_ne)
                        if sin and win and (px - 1, py + 1) in cells:
                            opts.append(b.hole_sw)
                        if sin and ein and (px + 1, py + 1) in cells:
                            opts.append(b.hole_se)
                        if len(opts) == 1 and self.get(layer, px, py) == 0:
                            self.set(layer, px, py, opts[0])
        if fringe:
            # overhang tiles just outside each edge (after the fillets, so
            # a filled concave corner is never overdrawn)
            for x, y in cells:
                for dx, dy, opts in (
                    (0, -1, b.fringe_n),
                    (0, 1, b.fringe_s),
                    (-1, 0, b.fringe_w),
                    (1, 0, b.fringe_e),
                ):
                    p = (x + dx, y + dy)
                    if not opts or p in cells or p in self.reserved or not self.inb(*p):
                        continue
                    if self.get(layer, *p) == 0:
                        self.set(layer, *p, rng.choice(opts))

    def blob_rect(
        self,
        layer: str,
        x: int,
        y: int,
        w: int,
        h: int,
        b: Blob,
        holes: bool = True,
        fringe: bool = False,
    ) -> None:
        self.blob(
            layer,
            {(xx, yy) for xx in range(x, x + w) for yy in range(y, y + h) if self.inb(xx, yy)},
            b,
            holes,
            fringe,
        )

    # -- collision / anchors ------------------------------------------------

    def collide(self, x: float, y: float, w: float, h: float) -> None:
        """Collision rect in TILE units (converted to px on export)."""
        self.collision.append((x * T, y * T, w * T, h * T))

    def anchor(self, kind: str, x: float, y: float, name: str = "", **props) -> None:
        """Point anchor. (x, y) tile coords of the sprite's bottom-center
        (fractions allowed)."""
        p = {"kind": kind, **props}
        self.anchors.append({"name": name, "x": (x + 0.5) * T, "y": (y + 1.0) * T, "props": p})

    def tree(self, x: int, y: int, stamp: str = "tree_light", collide: bool = True) -> None:
        self.anchor("tree", x, y, stamp=stamp)
        if collide:
            self.collide(x, y, 1, 1)

    def lamp(self, x: int, y: int) -> None:
        self.anchor("lamp", x, y)
        self.collide(x + 0.25, y + 0.25, 0.5, 0.75)

    # -- roads --------------------------------------------------------------

    def road_h(self, y: int, x0: int, x1: int, width: int = 3) -> None:
        self.road_segs.append(RoadSeg("h", x0, x1, y, width))
        for x in range(x0, x1 + 1):
            for yy in range(y, y + width):
                if self.inb(x, yy):
                    self.road_mask.add((x, yy))

    def road_v(self, x: int, y0: int, y1: int, width: int = 3) -> None:
        self.road_segs.append(RoadSeg("v", y0, y1, x, width))
        for y in range(y0, y1 + 1):
            for xx in range(x, x + width):
                if self.inb(xx, y):
                    self.road_mask.add((xx, y))

    def paint_roads(
        self, sidewalks: bool = True, dashes: bool = True, crosswalks: bool = True
    ) -> None:
        """Render the accumulated road network: sidewalk ring, asphalt blob,
        center dashes, crosswalks at junctions."""
        road = self.road_mask
        if sidewalks:
            ring: set[tuple[int, int]] = set()
            for x, y in road:
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        p = (x + dx, y + dy)
                        if p not in road and p not in self.reserved and self.inb(*p):
                            ring.add(p)
            ring |= {p for p in self.paved if p not in road}
            self.blob("ground-detail", ring, M.SIDEWALK, holes=False)
        self.blob("ground-detail", road, M.ASPHALT)
        if sidewalks:
            # The asphalt/sidewalk convex-corner tiles carry a rounded
            # transparent notch. Where that notch faces pavement instead of
            # grass it would show the ground layer's grass as single green
            # pinholes (slab corners, junction inside corners) — back those
            # cells with the matching pavement so the notch reads as curb.
            corner_gids = {M.mg("asp_nw"), M.mg("asp_ne"), M.mg("asp_sw"), M.mg("asp_se")}
            for x, y in road:
                if self.get("ground-detail", x, y) in corner_gids:
                    self.set("ground", x, y, self.rng.choice(M.SIDEWALK.fill))
            swk_corner = {
                M.mg("swk_nw"): (-1, -1),
                M.mg("swk_ne"): (1, -1),
                M.mg("swk_sw"): (-1, 1),
                M.mg("swk_se"): (1, 1),
            }
            for x, y in ring:
                d = swk_corner.get(self.get("ground-detail", x, y))
                if d and (x + d[0], y + d[1]) in road:
                    self.set("ground", x, y, self.rng.choice(M.ASPHALT.fill))

        junctions = self._junctions()
        if dashes:
            for seg in self.road_segs:
                if seg.width % 2 == 0:
                    continue
                mid = seg.c + seg.width // 2
                for a in range(seg.a0, seg.a1 + 1):
                    if a % 3 != 1:
                        continue
                    cell = (a, mid) if seg.orient == "h" else (mid, a)
                    if any(
                        jx0 - 1 <= cell[0] <= jx1 + 1 and jy0 - 1 <= cell[1] <= jy1 + 1
                        for jx0, jy0, jx1, jy1 in junctions
                    ):
                        continue
                    g = M.mg("dash_h") if seg.orient == "h" else M.mg("dash_v")
                    self.set("ground-detail", *cell, g)
        if crosswalks:
            for jx0, jy0, jx1, jy1 in junctions:
                # crosswalks only where streets actually cross: an L-bend
                # (two segments meeting end-to-end, 2 road arms) gets none
                arms = sum(
                    all(c in road for c in band)
                    for band in (
                        [(jx0 - 1, y) for y in range(jy0, jy1 + 1)],
                        [(jx1 + 1, y) for y in range(jy0, jy1 + 1)],
                        [(x, jy0 - 1) for x in range(jx0, jx1 + 1)],
                        [(x, jy1 + 1) for x in range(jx0, jx1 + 1)],
                    )
                )
                if arms < 3:
                    continue
                for x in (jx0 - 1, jx1 + 1):
                    band = [(x, y) for y in range(jy0, jy1 + 1)]
                    if all(c in road for c in band):
                        for c in band:
                            self.set("ground-detail", *c, M.mg("crosswalk_h"))
                for y in (jy0 - 1, jy1 + 1):
                    band = [(x, y) for x in range(jx0, jx1 + 1)]
                    if all(c in road for c in band):
                        for c in band:
                            self.set("ground-detail", *c, M.mg("crosswalk_v"))

    def _junctions(self) -> list[tuple[int, int, int, int]]:
        out = []
        hs = [s for s in self.road_segs if s.orient == "h"]
        vs = [s for s in self.road_segs if s.orient == "v"]
        for h in hs:
            for v in vs:
                if (
                    h.a0 <= v.c + v.width - 1
                    and v.c <= h.a1
                    and v.a0 <= h.c + h.width - 1
                    and h.c <= v.a1
                ):
                    out.append((v.c, h.c, v.c + v.width - 1, h.c + h.width - 1))
        return out

    # -- ground -------------------------------------------------------------

    def base_grass(self) -> None:
        self.fill("ground", 0, 0, self.w, self.h, R.GRASS.fill)

    def meadow(self, x: int, y: int, w: int, h: int) -> None:
        """Organic light-grass patch for tonal variation."""
        cells = set()
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                edge = min(xx - x, x + w - 1 - xx, yy - y, y + h - 1 - yy)
                if edge >= 1 or self.rng.random() < 0.55:
                    cells.add((xx, yy))
        self.blob("ground-detail", cells, R.GRASS_LIGHT, holes=False)

    def flowers(self, x: int, y: int, n: int = 5, spread: int = 3) -> None:
        for _ in range(n):
            fx = x + self.rng.randint(-spread, spread)
            fy = y + self.rng.randint(-spread, spread)
            if (
                self.inb(fx, fy)
                and self.get("deco-below", fx, fy) == 0
                and self.get("ground-detail", fx, fy) == 0
                and (fx, fy) not in self.reserved
            ):
                self.set("deco-below", fx, fy, self.rng.choice(R.FLOWERS_WHITE))

    def reserve(self, x: int, y: int, w: int, h: int) -> None:
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.reserved.add((xx, yy))

    def pave(self, x: int, y: int, w: int, h: int) -> None:
        """Mark a rect as plaza/forecourt: painted as one continuous piece
        with the road sidewalks during paint_roads()."""
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                if self.inb(xx, yy):
                    self.paved.add((xx, yy))


# ---------------------------------------------------------------------------
# building recipes (shared by layouts and the generic interpreter)
# ---------------------------------------------------------------------------


def storefront(
    m: MapCanvas,
    x: int,
    y: int,
    w: int,
    h: int,
    facade: str = "brick",
    roof: str = "deck_dark",
    door_dx: int | None = None,
    sign: int | None = None,
    awning: bool = False,
    window: bool = True,
) -> None:
    """Commercial building: flat roof pad + 3-row facade strip + door.
    Total footprint w x h, door on the south wall. h >= 6 reads best."""
    m.reserve(x, y - 1, w, h + 1)
    roof_h = max(2, h - 3)
    m.stamp("buildings-top", pad_stamp(ROOFS[roof], w, roof_h), x, y)
    wall = facade_wall(facade, w, rows=[3, 4, 5])
    m.stamp("buildings-base", wall, x, y + roof_h)
    dd = door_dx if door_dx is not None else (w - 2) // 2
    m.stamp("buildings-base", R.DOOR_WOOD, x + dd, y + roof_h + 1)
    if window:
        for wx in [x + 1] if w < 7 else [x + 1, x + w - 3]:
            if not (wx <= x + dd + 1 and x + dd <= wx + 1):
                m.stamp("buildings-base", M.WINDOW, wx, y + roof_h + 1)
    if awning:
        # hangs over the top of the shopfront, door row stays visible
        m.stamp("buildings-top", awning_strip(w), x, y + roof_h - 1)
    elif sign is not None:
        sx = x + w - 3 if dd <= (w - 2) // 2 else x + 1
        m.stamp("buildings-top", R.SIGNS_WALL[sign % len(R.SIGNS_WALL)], sx, y + roof_h)
    m.collide(x, y, w, h)


def grand(
    m: MapCanvas,
    x: int,
    y: int,
    w: int,
    h: int,
    facade: str = "stone_gray",
    roof: str = "stone",
    banners: bool = False,
    windows: bool = False,
    door: str = "wood",
) -> None:
    """Civic-scale building: full 6-row arched facade + roof rows above.
    Archless facades get a centered door stamp. h >= 6."""
    m.reserve(x, y - 1, w, h + 1)
    roof_h = h - 6
    if roof_h > 0:
        m.stamp("buildings-top", pad_stamp(ROOFS[roof], w, roof_h + 1), x, y)
    wall = facade_wall(facade, w, with_arch=True)
    m.building_stamp(wall, x, y + roof_h, top_rows=1)
    _, _, arch = FACADES[facade]
    if arch is None and door:
        ds = R.DOOR_METAL if door == "metal" else R.DOOR_WOOD
        m.stamp("buildings-base", ds, x + (w - 2) // 2, y + roof_h + 4)
    aw = (arch[1] - arch[0] + 1) if arch else 0
    if banners and w >= 7 and aw:
        lo = x + (w - aw) // 2 - 1
        m.stamp("buildings-base", R.BANNER_RED_A, lo, y + roof_h + 1)
        m.stamp("buildings-base", R.BANNER_RED_B, lo + aw + 1, y + roof_h + 1)
    if windows and w >= 8:
        m.stamp("buildings-base", M.WINDOW, x + 1, y + roof_h + 3)
        m.stamp("buildings-base", M.WINDOW, x + w - 3, y + roof_h + 3)
    m.collide(x, y, w, h)


def cottage(m: MapCanvas, x: int, y: int, w: int = 6, h: int = 8, roof: str = "deck_light") -> None:
    """Small cream house: light deck roof over the full arched cream facade.
    Footprint w x h, h >= 7; w >= 6 keeps the arch."""
    m.reserve(x, y - 1, w, h + 1)
    roof_h = max(2, h - 6)
    m.stamp("buildings-top", pad_stamp(ROOFS[roof], w, roof_h + 1), x, y)
    wall = facade_wall("cream", w, with_arch=True)
    m.building_stamp(wall, x, y + roof_h, top_rows=1)
    m.collide(x, y, w, h)


def apron(m: MapCanvas, x: int, y: int, w: int = 2, h: int = 1, material: str = "sidewalk") -> None:
    """Small doorstep pad in front of an entrance."""
    fillset = M.SIDEWALK.fill if material == "sidewalk" else R.PATH_TAN.fill
    m.fill("ground-detail", x, y, w, h, fillset)


def path(m: MapCanvas, cells: set[tuple[int, int]]) -> None:
    m.blob("ground-detail", cells, R.PATH_TAN)


def path_rect(m: MapCanvas, x: int, y: int, w: int, h: int) -> None:
    path(m, {(xx, yy) for xx in range(x, x + w) for yy in range(y, y + h)})


# ---------------------------------------------------------------------------
# generic landmark interpreter (fallback when no layout module exists)
# ---------------------------------------------------------------------------


def interpret_landmarks(m: MapCanvas) -> None:
    lms = list(m.landmarks.values())
    for lm in lms:
        if lm.type == "road":
            if lm.w >= lm.h:
                m.road_h(lm.y, lm.x, lm.x + lm.w - 1, width=min(3, max(2, lm.h)))
            else:
                m.road_v(lm.x, lm.y, lm.y + lm.h - 1, width=min(3, max(2, lm.w)))
    for lm in lms:
        x, y, w, h = lm.x, lm.y, min(lm.w, 10), min(lm.h, 9)
        if lm.type == "water":
            m.blob_rect("ground-detail", x, y, lm.w, lm.h, R.WATER_DEEP)
            m.collide(x, y, lm.w, lm.h)
        elif lm.type == "park":
            m.meadow(x, y, lm.w, lm.h)
            m.stamp("deco-below", R.WELL, x + w // 2 - 2, y + h // 2 - 2)
            m.collide(x + w // 2 - 2, y + h // 2 - 1, 4, 3)
            for _i in range(3):
                m.tree(
                    x + 1 + m.rng.randrange(max(1, lm.w - 4)),
                    y + 1 + m.rng.randrange(max(1, lm.h - 3)),
                    stamp=m.rng.choice(("tree_light", "tree_dark")),
                )
            m.flowers(x + w // 2, y + h - 2, n=6)
        elif lm.type == "church":
            grand(m, x, y + max(0, h - 8), min(w, 8), min(h, 8), facade="stone_gray")
        elif lm.type == "civic":
            grand(m, x, y, min(w, 9), min(h, 8), facade="stone_large", banners=True)
        elif lm.type == "transport":
            grand(m, x, y, min(w, 8), min(h, 7), facade="stone_small")
        elif lm.type == "housing":
            n = max(1, lm.w // 6)
            for i in range(n):
                cottage(m, x + i * 6, y, 5, min(6, h))
        elif lm.type in ("building", "commercial"):
            storefront(
                m,
                x,
                y,
                min(w, 9),
                max(5, min(h, 7)),
                facade=m.rng.choice(("brick", "cream")),
                sign=m.rng.randrange(5),
                awning=m.rng.random() < 0.5,
            )
    m.paint_roads()


# ---------------------------------------------------------------------------
# export
# ---------------------------------------------------------------------------


def to_tmj(m: MapCanvas) -> dict:
    layers = []
    lid = 1
    for name in LAYER_NAMES:
        data = [g for row in m.layers[name] for g in row]
        layers.append(
            {
                "id": lid,
                "name": name,
                "type": "tilelayer",
                "visible": True,
                "opacity": 1,
                "x": 0,
                "y": 0,
                "width": m.w,
                "height": m.h,
                "data": data,
            }
        )
        lid += 1
    oid = 1
    objs = []
    for x, y, w, h in m.collision:
        objs.append(
            {
                "id": oid,
                "name": "",
                "type": "",
                "rotation": 0,
                "visible": True,
                "x": round(x, 1),
                "y": round(y, 1),
                "width": round(w, 1),
                "height": round(h, 1),
            }
        )
        oid += 1
    layers.append(
        {
            "id": lid,
            "name": "collision",
            "type": "objectgroup",
            "visible": True,
            "opacity": 1,
            "x": 0,
            "y": 0,
            "draworder": "topdown",
            "objects": objs,
        }
    )
    lid += 1
    aobjs = []
    for a in m.anchors:
        props = [
            {"name": k, "type": "string", "value": str(v)} for k, v in sorted(a["props"].items())
        ]
        aobjs.append(
            {
                "id": oid,
                "name": a["name"],
                "type": "",
                "rotation": 0,
                "point": True,
                "visible": True,
                "x": round(a["x"], 1),
                "y": round(a["y"], 1),
                "width": 0,
                "height": 0,
                "properties": props,
            }
        )
        oid += 1
    layers.append(
        {
            "id": lid,
            "name": "anchors",
            "type": "objectgroup",
            "visible": True,
            "opacity": 1,
            "x": 0,
            "y": 0,
            "draworder": "topdown",
            "objects": aobjs,
        }
    )
    lid += 1

    return {
        "type": "map",
        "version": "1.10",
        "tiledversion": "1.10.2",
        "orientation": "orthogonal",
        "renderorder": "right-down",
        "compressionlevel": -1,
        "infinite": False,
        "width": m.w,
        "height": m.h,
        "tilewidth": T,
        "tileheight": T,
        "nextlayerid": lid,
        "nextobjectid": oid,
        "tilesets": [
            {
                "firstgid": 1,
                "name": "rpg-tileset",
                "image": "../../tilesets/rpg-tileset.png",
                "imagewidth": 1600,
                "imageheight": 1600,
                "tilewidth": T,
                "tileheight": T,
                "columns": 100,
                "tilecount": 10000,
                "margin": 0,
                "spacing": 0,
            },
            {**M.tileset_json_entry(), "image": "../../tilesets/township-modern.png"},
        ],
        "layers": layers,
    }


def build_town(scenario: str, town_id: str, out_dir: Path = MAPS_DIR) -> Path:
    town_path = _scenario_town_file(scenario, town_id)
    town = json.loads(town_path.read_text())
    m = MapCanvas(town_id, town, seed=_stable_seed(f"{scenario}/{town_id}"))
    m.base_grass()
    mod = _layout_module(scenario, town_id)
    if mod is not None and hasattr(mod, "compose"):
        mod.compose(m)
    else:
        interpret_landmarks(m)
    out = _map_output_path(out_dir, scenario, town_id)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(to_tmj(m), separators=(",", ":")))
    print(f"wrote {out}")
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--scenario", default="nj11-2026")
    ap.add_argument("--town")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--preview", action="store_true", help="also render the preview png(s)")
    args = ap.parse_args()
    try:
        scenario = _validated_id(args.scenario, label="scenario id")
        town = _validated_id(args.town, label="town id") if args.town else None
    except ValueError as exc:
        ap.error(str(exc))
    towns_dir = REPO_ROOT / "scenarios" / scenario / "towns"
    towns = [p.stem for p in sorted(towns_dir.glob("*.json"))] if args.all else [town]
    if not towns or towns == [None]:
        ap.error("pass --town <id> or --all")
    for t in towns:
        build_town(scenario, t)
        if args.preview:
            from mapgen import render_preview

            render_preview.render(t, scenario=scenario, labels=True)


if __name__ == "__main__":
    main()
