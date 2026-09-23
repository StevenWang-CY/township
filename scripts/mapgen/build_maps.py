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

Every landmark also gets authored standing ``spot`` anchors (door, porch,
window, chat pair, bench seat, table, stall, platform, lawn, queue) so the
runtime can spread a crowd over a landmark instead of piling residents on
one door — see ``emit_spot_anchors`` for the contract.

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
import math
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

#: Legacy deck-roof names map onto shingle colorways so every layout
#: inherits the pitched-roof language without editing each call site.
SHINGLE_ALIASES = {"deck_dark": "slate", "deck_light": "cedar"}


def roof_stamp(name: str, w: int, h: int) -> TileStamp:
    """A building roof: pitched shingles by colorway (``terracotta`` /
    ``slate`` / ``cedar``, with the legacy deck names aliased onto
    colorways), or the flat ``stone`` pad kept for civic buildings."""
    if name == "stone":
        return pad_stamp(R.STONE_PAD_DARK, w, h)
    return M.shingle_stamp(SHINGLE_ALIASES.get(name, name), w, h)


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
    """Tile canvas (75x50 for towns by default) with the five Township
    layers plus collision and anchor emitters. All helper coordinates are
    tile-space. The overworld renderer reuses it at a larger size."""

    def __init__(
        self, town_id: str, town: dict, seed: int = 7, w: int = MAP_W, h: int = MAP_H
    ) -> None:
        self.town_id = town_id
        self.town = town
        self.w, self.h = w, h
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
        #: Dwellings (cottages, row houses): each gets yard-sign anchors on
        #: its lawn so residents' stances can show on their own front yard.
        self.homes: list[dict] = []
        #: Landmark name → building fronts (door + wall row), in registration
        #: order, so the civic post-pass can dress a polling place and the
        #: spot pass can place doorstep spots without re-deriving geometry.
        #: A landmark may own several fronts (a housing block's cottages).
        self.fronts: dict[str, list[dict]] = {}
        #: Standing spots authored by layout helpers (bench seats, patio
        #: tables, stall counters, platform edges). They are only validated
        #: and emitted by ``emit_spot_anchors`` once every prop is placed,
        #: so a seat stamped early never ends up under a later planter.
        self.spot_requests: list[dict] = []
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

    def collided(self, px: float, py: float) -> bool:
        """True when a collision rect covers the pixel (px, py)."""
        return any(rx <= px < rx + rw and ry <= py < ry + rh for rx, ry, rw, rh in self.collision)

    def on_street(self, x: int, y: int) -> bool:
        """True when tile (x, y) lies on a street (a road segment). The rest
        of ``road_mask`` — parking lots, bus bays, a cul-de-sac bulb — is
        off-street asphalt an office or a shop row genuinely fronts onto."""
        for seg in self.road_segs:
            along, across = (x, y) if seg.orient == "h" else (y, x)
            if seg.a0 <= along <= seg.a1 and seg.c <= across < seg.c + seg.width:
                return True
        return False

    def cell_free(self, x: int, y: int) -> bool:
        """Can a resident stand on tile (x, y)? In bounds, not on a street,
        not a reserved (building / rail / river) cell, no collision rect
        over the cell's centre pixel, and no prop or building tile on it.
        Painted ground-detail (sidewalk, path, deck, stone floor, even a
        parking lot's asphalt) is fine — it is the street itself, where a
        crowd would block traffic, that is off limits."""
        if not self.inb(x, y) or (x, y) in self.reserved or self.on_street(x, y):
            return False
        if self.collided((x + 0.5) * T, (y + 0.5) * T):
            return False
        return not (
            self.get("deco-below", x, y)
            or self.get("buildings-base", x, y)
            or self.get("buildings-top", x, y)
        )

    def spot(self, role: str, x: float, y: float, facing: str, landmark: str = "", **props) -> None:
        """Queue a standing spot for ``emit_spot_anchors`` (validated then).
        (x, y) tile coords of the resident's feet cell, fractions allowed;
        an empty ``landmark`` resolves to the nearest landmark at emission."""
        self.spot_requests.append(
            {"role": role, "x": x, "y": y, "facing": facing, "landmark": landmark, **props}
        )

    def tree(self, x: int, y: int, stamp: str = "tree_light", collide: bool = True) -> None:
        self.anchor("tree", x, y, stamp=stamp)
        if collide:
            self.collide(x, y, 1, 1)

    def lamp(self, x: int, y: int) -> None:
        self.anchor("lamp", x, y)
        self.collide(x + 0.25, y + 0.25, 0.5, 0.75)

    def register_front(
        self,
        landmark: str | None,
        x: int,
        y: int,
        w: int,
        h: int,
        door_x: int,
        door_y: int,
        wall_row: int,
        door_w: int = 2,
    ) -> None:
        """Remember a building's front so ``emit_civic_anchors`` can place
        banners beside its door and a polling station on its apron, and
        ``emit_spot_anchors`` can seat residents on its doorstep. A landmark
        that spans several buildings registers each of them; ``door_w`` is
        the door stamp's width (the diner's glass door is a single tile)."""
        if not landmark:
            return
        self.fronts.setdefault(landmark, []).append(
            {
                "x": x,
                "y": y,
                "w": w,
                "h": h,
                "door_x": door_x,
                "door_y": door_y,
                "door_w": door_w,
                "wall_row": wall_row,
            }
        )

    def chimney(self, x: int, y: int, mode: str = "hearth") -> None:
        """A chimney stack in the row above a shingle ridge plus a smoke
        anchor. ``mode="hearth"`` smoke only rises at dawn and dusk (when a
        home is warm); ``"always"`` is the factory stack."""
        if not self.inb(x, y) or y < 0:
            return
        if self.get("buildings-top", x, y) == 0:
            self.set("buildings-top", x, y, M.mg("chimney"))
        self.anchor("smoke", x, y - 0.35, mode=mode)

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
    landmark: str | None = None,
    yard: bool = False,
    chimney: bool = True,
) -> None:
    """Commercial building: flat roof pad + 3-row facade strip + door.
    Total footprint w x h, door on the south wall. h >= 6 reads best.
    ``landmark`` registers the front for the civic post-pass; ``yard``
    marks the building as a dwelling (row houses) that gets yard signs."""
    m.reserve(x, y - 1, w, h + 1)
    roof_h = max(2, h - 3)
    m.stamp("buildings-top", roof_stamp(roof, w, roof_h), x, y)
    wall = facade_wall(facade, w, rows=[3, 4, 5])
    m.stamp("buildings-base", wall, x, y + roof_h)
    dd = door_dx if door_dx is not None else (w - 2) // 2
    # top_rows=1: the door art has transparent margins on its top row, so
    # overlay it on buildings-top and keep the wall tile behind it
    m.building_stamp(R.DOOR_WOOD, x + dd, y + roof_h + 1, top_rows=1)
    if window:
        for wx in [x + 1] if w < 7 else [x + 1, x + w - 3]:
            if not (wx <= x + dd + 1 and x + dd <= wx + 1):
                m.stamp("buildings-base", M.WINDOW, wx, y + roof_h + 1)
    elif w >= 4:
        # Plain fronts still get a small window each side of the door so
        # every shop ignites at dusk.
        for wx in (x + 1, x + w - 2):
            if wx < x + dd or wx > x + dd + 1:
                m.stamp("buildings-base", M.SMALL_WINDOW, wx, y + roof_h + 1)
    if chimney and roof != "stone" and w >= 5:
        m.chimney(x + w - 2, y - 1)
    m.register_front(landmark, x, y, w, h, x + dd, y + h - 1, y + roof_h)
    if yard and landmark:
        m.homes.append({"x": x, "y": y, "w": w, "h": h, "landmark": landmark})
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
    landmark: str | None = None,
) -> None:
    """Civic-scale building: full 6-row arched facade + roof rows above.
    Archless facades get a centered door stamp. h >= 6. ``landmark``
    registers the front (door + wall row) for the civic post-pass."""
    m.reserve(x, y - 1, w, h + 1)
    roof_h = h - 6
    if roof_h > 0:
        m.stamp("buildings-top", roof_stamp(roof, w, roof_h + 1), x, y)
    wall = facade_wall(facade, w, with_arch=True)
    m.building_stamp(wall, x, y + roof_h, top_rows=1)
    _, _, arch = FACADES[facade]
    if arch is None and door:
        ds = R.DOOR_METAL if door == "metal" else R.DOOR_WOOD
        m.building_stamp(ds, x + (w - 2) // 2, y + roof_h + 4, top_rows=1)
    aw = (arch[1] - arch[0] + 1) if arch else 0
    if banners and w >= 7 and aw:
        lo = x + (w - aw) // 2 - 1
        m.stamp("buildings-base", R.BANNER_RED_A, lo, y + roof_h + 1)
        m.stamp("buildings-base", R.BANNER_RED_B, lo + aw + 1, y + roof_h + 1)
    if windows and w >= 8:
        m.stamp("buildings-base", M.WINDOW, x + 1, y + roof_h + 3)
        m.stamp("buildings-base", M.WINDOW, x + w - 3, y + roof_h + 3)
    m.collide(x, y, w, h)
    door_x = x + (w - aw) // 2 if arch else x + (w - 2) // 2
    m.register_front(landmark, x, y, w, h, door_x, y + h - 1, y + roof_h + 1)


def cottage(
    m: MapCanvas,
    x: int,
    y: int,
    w: int = 6,
    h: int = 8,
    roof: str = "deck_light",
    landmark: str | None = None,
    chimney: bool = True,
) -> None:
    """Colonial house: pitched shingle roof over a cream clapboard front —
    paired shutter windows upstairs, centered door below. Footprint w x h,
    h >= 6, w >= 6 keeps the paired windows. Every cottage is a dwelling:
    it gets a hearth chimney and yard-sign anchors on its lawn."""
    m.reserve(x, y - 1, w, h + 1)
    roof_h = max(2, h - 4)
    m.stamp("buildings-top", roof_stamp(roof, w, roof_h), x, y)
    m.stamp("buildings-base", facade_wall("cream", w, rows=[2, 3, 4, 5]), x, y + roof_h)
    for wx in [x + 1, x + w - 3] if w >= 6 else [x + (w - 2) // 2]:
        m.stamp("buildings-base", M.SHUTTER_WINDOW, wx, y + roof_h)
    m.building_stamp(R.DOOR_WOOD, x + (w - 2) // 2, y + roof_h + 2, top_rows=1)
    m.collide(x, y, w, h)
    if chimney:
        m.chimney(x + w - 2, y - 1)
    m.register_front(landmark, x, y, w, h, x + (w - 2) // 2, y + h - 1, y + roof_h)
    m.homes.append({"x": x, "y": y, "w": w, "h": h, "landmark": landmark or ""})


def church(
    m: MapCanvas,
    x: int,
    y: int,
    w: int,
    h: int,
    variant: str = "clapboard",
    roof: str = "slate",
    garden: bool = False,
    landmark: str | None = None,
) -> None:
    """Small-town church: gabled slate-shingle nave, centered steeple with a
    louvered belfry, flared slate cap and gold cross finial, arched double
    door at the tower base, lancet windows flanking. ``variant`` picks the
    wall material: white ``clapboard`` or gray ``stone``. Footprint w x h
    with w >= 6 and h >= 7 (2 steeple rows + gabled roof + 3 wall courses)."""
    if w < 6 or h < 7:
        raise ValueError("church needs w >= 6 and h >= 7")
    v = M.CHURCH_VARIANTS[variant]
    m.reserve(x, y - 1, w, h + 1)
    roof_h = h - 5
    cx = x + (w - 2) // 2
    # steeple: spire + belfry above the ridge line
    m.stamp(
        "buildings-top", TileStamp("ch_spire", ((M.mg("ch_spire_l"), M.mg("ch_spire_r")),)), cx, y
    )
    m.set("buildings-top", cx, y + 1, M.mg(f"ch_{v}_belfry_l"))
    m.set("buildings-top", cx + 1, y + 1, M.mg(f"ch_{v}_belfry_r"))
    # gabled nave roof, tower shaft punching through it
    m.stamp("buildings-top", roof_stamp(roof, w, roof_h), x, y + 2)
    for r in range(roof_h):
        m.set("buildings-top", cx, y + 2 + r, M.mg(f"ch_{v}_tower_l"))
        m.set("buildings-top", cx + 1, y + 2 + r, M.mg(f"ch_{v}_tower_r"))
    # walls: two courses + a foundation course that grounds the building
    wy = y + 2 + roof_h
    for r, kind in enumerate(("wall", "wall", "wallb")):
        for c in range(w):
            side = "l" if c == 0 else ("r" if c == w - 1 else "m")
            m.set("buildings-base", x + c, wy + r, M.mg(f"ch_{v}_{kind}_{side}"))
    # lancet windows flanking the entrance
    for lx in (x + 1, x + w - 2):
        m.set("buildings-base", lx, wy, M.mg(f"ch_{v}_lan_t"))
        m.set("buildings-base", lx, wy + 1, M.mg(f"ch_{v}_lan_b"))
    # arched double door at the tower base
    m.set("buildings-base", cx, wy + 1, M.mg(f"ch_{v}_door_tl"))
    m.set("buildings-base", cx + 1, wy + 1, M.mg(f"ch_{v}_door_tr"))
    m.set("buildings-base", cx, wy + 2, M.mg(f"ch_{v}_door_bl"))
    m.set("buildings-base", cx + 1, wy + 2, M.mg(f"ch_{v}_door_br"))
    m.collide(x, y, w, h)
    m.register_front(landmark, x, y, w, h, cx, y + h - 1, wy)
    if garden:  # modest side garden off the east wall
        gx, gy = x + w + 1, y + h - 2
        if m.inb(gx + 1, gy + 1):
            m.stamp("deco-below", R.BUSH_ROUND, gx, gy)
            m.flowers(gx + 1, gy + 1, n=4, spread=1)


def diner(
    m: MapCanvas,
    x: int,
    y: int,
    w: int,
    h: int = 6,
    door_dx: int | None = None,
    landmark: str | None = None,
) -> None:
    """Roadside chrome diner: rounded chrome band + DINER letterboard +
    big glass window band + stainless walls with a glass door. Footprint
    w x h, w >= 4, h >= 5."""
    m.reserve(x, y - 1, w, h + 1)
    for r, kind in enumerate(["roof", "sign", "window"] + ["wall"] * (h - 3)):
        layer = "buildings-top" if r < 2 else "buildings-base"
        for c, g in enumerate(M.diner_row(kind, w)):
            m.set(layer, x + c, y + r, g)
    dd = door_dx if door_dx is not None else (w - 1) // 2
    m.stamp("buildings-base", M.DINER_DOOR, x + dd, y + h - 2)
    m.collide(x, y, w, h)
    m.register_front(landmark, x, y, w, h, x + dd, y + h - 1, y + 3, door_w=1)


def apron(m: MapCanvas, x: int, y: int, w: int = 2, h: int = 1, material: str = "sidewalk") -> None:
    """Small doorstep pad in front of an entrance."""
    fillset = M.SIDEWALK.fill if material == "sidewalk" else R.PATH_TAN.fill
    m.fill("ground-detail", x, y, w, h, fillset)


def path(m: MapCanvas, cells: set[tuple[int, int]]) -> None:
    m.blob("ground-detail", cells, R.PATH_TAN)


def path_rect(m: MapCanvas, x: int, y: int, w: int, h: int) -> None:
    path(m, {(xx, yy) for xx in range(x, x + w) for yy in range(y, y + h)})


def noticeboard(m: MapCanvas, x: int, y: int, landmark: str = "") -> None:
    """A 2x2 notice-board kiosk (top-left at x, y) on deco-below. The board
    row blocks movement; the runtime pins each round's headlines to it."""
    m.stamp("deco-below", M.NOTICE_BOARD, x, y)
    m.collide(x + 0.1, y + 0.6, 1.8, 1.2)
    m.anchor("noticeboard", x + 0.5, y + 1, name=landmark)


def bench(m: MapCanvas, x: int, y: int, landmark: str = "") -> None:
    """A park bench (1x1 ``bench_h`` on deco-below at x, y) with a seat spot
    on either side; the seats face south like the bench art. A seat whose
    cell turns out blocked is dropped at emission rather than moved."""
    m.set("deco-below", x, y, M.mg("bench_h"))
    m.collide(x, y, 1, 1)
    for sx in (x - 1, x + 1):
        m.spot("bench", sx, y, "down", landmark, exact=True)


def patio(
    m: MapCanvas,
    x: int,
    y: int,
    w: int,
    h: int,
    stools: tuple[tuple[int, int], ...],
    landmark: str = "",
    floor: bool = True,
    blocks: tuple[tuple[float, float, float, float], ...] | None = None,
) -> None:
    """Outdoor seating: an optional stone-floor pad ``w x h`` at (x, y), 2x2
    stools at the given offsets from (x, y), collision blocks (offsets;
    default: the top row of each stool, which is how the sites were laid
    out) and a ``table`` spot per stool on its open side — south of it
    facing up, else east of it facing left."""
    if floor:
        m.fill("ground-detail", x, y, w, h, R.STONE_FLOOR_FILL)
    for sx, sy in stools:
        m.stamp("deco-below", R.STOOL, x + sx, y + sy)
    for bx, by, bw, bh in blocks if blocks is not None else [(sx, sy, 2, 1) for sx, sy in stools]:
        m.collide(x + bx, y + by, bw, bh)
    for sx, sy in stools:
        ax, ay = x + sx, y + sy
        m.spot(
            "table",
            ax,
            ay + 2,
            "up",
            landmark,
            alternatives=((ax + 1, ay + 2, "up"), (ax + 2, ay, "left"), (ax + 2, ay + 1, "left")),
        )


def market_stall(m: MapCanvas, x: int, y: int, landmark: str = "") -> None:
    """The 6x3 striped market stall (top-left at x, y): the counter rows
    block movement and two customer spots stand at the counter facing it."""
    m.stamp("deco-below", R.MARKET_STALL, x, y)
    m.collide(x, y + 1, 6, 2)
    m.spot("stall", x + 1.5, y + 3, "up", landmark)
    m.spot("stall", x + 3.5, y + 3, "up", landmark)


def platform(
    m: MapCanvas, x: int, y: int, w: int, h: int, landmark: str = "", edge: str = "s"
) -> None:
    """A light-deck platform pad ``w x h`` (station platform, swimming dock)
    with waiting spots on every second cell of the row (or column) along
    ``edge`` — the side that meets the tracks or the water — facing out
    over it. Cells taken by lamps, benches or railings are skipped."""
    m.stamp("ground-detail", pad_stamp(R.DECK_LIGHT, w, h), x, y)
    if edge in ("n", "s"):
        row = y if edge == "n" else y + h - 1
        cells = [(cx, row) for cx in range(x, x + w, 2)]
    else:
        col = x if edge == "w" else x + w - 1
        cells = [(col, cy) for cy in range(y, y + h, 2)]
    facing = {"n": "up", "s": "down", "w": "left", "e": "right"}[edge]
    for cx, cy in cells:
        m.spot("platform", cx, cy, facing, landmark, exact=True)


def _grass_gids() -> set[int]:
    out: set[int] = set(R.GRASS_LIGHT.fill)
    for value in R.GRASS_LIGHT.edge_tiles().values():
        if isinstance(value, int):
            if value:
                out.add(value)
        else:
            out.update(g for g in value if g)
    return out


def cell_is_lawn(m: MapCanvas, cx: int, cy: int, lawn: set[int]) -> bool:
    """Open grass: not road or plaza, no prop or building tile, and the
    ground-detail either bare or one of the light-meadow ``lawn`` gids.
    (Collision is not checked here — pair with ``MapCanvas.cell_free``.)"""
    if not m.inb(cx, cy) or (cx, cy) in m.road_mask or (cx, cy) in m.paved:
        return False
    if m.get("deco-below", cx, cy) or m.get("buildings-base", cx, cy):
        return False
    if m.get("buildings-top", cx, cy):
        return False
    detail = m.get("ground-detail", cx, cy)
    return detail == 0 or detail in lawn


def polling_landmarks(m: MapCanvas) -> list[Landmark]:
    """Landmarks that host the election: those the town JSON marks with
    ``"role": "polling_place"``, falling back to ``civic``-typed ones, then
    to names matching "town hall" / "municipal"."""
    polling = [
        lm for lm in m.landmarks.values() if str(lm.raw.get("role", "")).lower() == "polling_place"
    ]
    if not polling:
        polling = [lm for lm in m.landmarks.values() if lm.type == "civic"]
    if not polling:
        polling = [
            lm for lm in m.landmarks.values() if re.search(r"town hall|municipal", lm.name, re.I)
        ]
    return polling


def emit_civic_anchors(m: MapCanvas) -> None:
    """Post-pass after a layout: the election's furniture, derived from
    scenario data rather than hand-placed.

    * ``pollplace`` (+ two facade ``banner`` anchors and a ``bunting`` span)
      at every landmark whose town JSON declares ``"role": "polling_place"``
      (falling back to a ``civic``-typed landmark, then a name matching
      "town hall" / "municipal").
    * ``yardsign`` — two lawn cells beside every dwelling, so residents'
      stances can show on their own front yards. Grass only, never on a
      path or sidewalk; a stable ``seat`` index survives rebuilds.
    * ``brazier`` — one in the first park, for the results night.
    """
    lawn = _grass_gids()

    def free_lawn(cx: int, cy: int) -> bool:
        return cell_is_lawn(m, cx, cy, lawn)

    seat = 0
    for home in m.homes:
        x, y, w, h = home["x"], home["y"], home["w"], home["h"]
        candidates = [
            (x - 1, y + h - 1),
            (x + w, y + h - 1),
            (x - 1, y + h - 2),
            (x + w, y + h - 2),
            (x, y + h),
            (x + w - 1, y + h),
        ]
        # Two signs on a detached house's lawn; one in front of a narrow row
        # house, so an attached terrace doesn't become a picket line.
        limit = 2 if w >= 6 else 1
        placed = 0
        for cx, cy in candidates:
            if placed >= limit:
                break
            if not free_lawn(cx, cy):
                continue
            m.anchor("yardsign", cx, cy, seat=str(seat), home=home["landmark"])
            m.collide(cx + 0.3, cy + 0.45, 0.4, 0.5)
            seat += 1
            placed += 1

    for lm in polling_landmarks(m)[:1]:
        fronts = m.fronts.get(lm.name)
        if not fronts:
            print(f"  ! polling place {lm.name!r} has no registered building front; skipped")
            continue
        front = fronts[0]
        dx, dy, wall = front["door_x"], front["door_y"], front["wall_row"]
        m.anchor("pollplace", dx + 0.5, dy + 1, name=lm.name)
        for bx in (dx - 1, dx + 2):
            if front["x"] <= bx < front["x"] + front["w"]:
                m.anchor("banner", bx, wall + 1, name=lm.name, mount="facade")
        m.anchor(
            "bunting",
            front["x"] + front["w"] / 2 - 0.5,
            wall,
            name=lm.name,
            span=str(front["w"]),
        )

    parks = [lm for lm in m.landmarks.values() if lm.type == "park"]
    for lm in parks[:1]:
        cx, cy = lm.x + lm.w // 2, lm.y + lm.h // 2
        for ox, oy in ((0, 2), (2, 2), (-2, 2), (0, -2), (3, 0), (-3, 0), (0, 3)):
            if free_lawn(cx + ox, cy + oy) and (cx + ox, cy + oy) not in m.reserved:
                m.set("deco-below", cx + ox, cy + oy, M.mg("brazier"))
                m.collide(cx + ox + 0.25, cy + oy + 0.4, 0.5, 0.5)
                m.anchor("brazier", cx + ox, cy + oy, name=lm.name)
                break


# ---------------------------------------------------------------------------
# standing spots (the crowd's authored places to be)
# ---------------------------------------------------------------------------

#: Column shifts tried when a spot's cell is blocked: the cell itself, then
#: one column either side, then two — after that the spot is dropped.
_SPOT_SHIFTS = (0, 1, -1, 2, -2)
#: Anchor kinds that put a prop sprite on their cell (some, like flowers,
#: without a collision rect) — nobody should stand inside them.
_PROP_ANCHOR_KINDS = {"tree", "lamp", "flower", "windmill", "noticeboard", "brazier", "yardsign"}
#: Top-left gids of the facade windows residents can loiter under.
_WINDOW_TL = {M.WINDOW.gids[0][0], M.SHUTTER_WINDOW.gids[0][0], M.SMALL_WINDOW.gids[0][0]}
#: Landmark types whose open ground gets scattered lawn spots.
_LAWN_TYPES = ("park", "plaza", "green")
#: Poisson-disc parameters for lawn spots: minimum separation (tiles), how
#: many a park gets at most, and the floor below which the search ring
#: grows past the landmark rect (a lake's rect is mostly water).
_LAWN_SEPARATION = 2.0
_LAWN_MAX = 8
_LAWN_MIN = 4
#: Cells in a polling queue, at a two-tile pitch.
_QUEUE_LEN = 5
#: A street landmark at least this long (tiles) gets a chat pair per quarter.
_LONG_STREET = 30


def _spot_cells(x: float, y: float) -> list[tuple[int, int]]:
    """Tiles under a resident standing at (x, y): a half-tile x (a spot
    centred under a two-tile door) straddles two cells."""
    cy = math.floor(y)
    return sorted({(math.floor(x), cy), (math.floor(x + 0.5), cy)})


def nearest_landmark(m: MapCanvas, cx: int, cy: int) -> str:
    """Name of the non-road landmark whose rect is closest to tile (cx, cy)
    (Manhattan distance to the rect; zero inside it)."""
    best, best_d = "", None
    for lm in m.landmarks.values():
        if lm.type == "road":
            continue
        d = max(0, lm.x - cx, cx - (lm.x + lm.w - 1)) + max(0, lm.y - cy, cy - (lm.y + lm.h - 1))
        if best_d is None or d < best_d:
            best, best_d = lm.name, d
    return best


def _window_columns(m: MapCanvas, front: dict) -> list[int]:
    """Columns of every facade window on a registered front (left column
    of each window stamp), found from the buildings-base gids so a recipe
    change never desynchronises the spots from the art."""
    cols: list[int] = []
    for r in range(front["y"], front["y"] + front["h"]):
        for c in range(front["x"], front["x"] + front["w"]):
            if m.get("buildings-base", c, r) in _WINDOW_TL and c not in cols:
                cols.append(c)
    return sorted(cols)


class _SpotPlacer:
    """Validates candidate spots against the finished canvas and records the
    ones that fit, in emission order, so ``order`` is stable per landmark.
    Everyday spots never share a cell; polling-queue cells are ``shared``
    because the line only forms on decision day."""

    def __init__(self, m: MapCanvas) -> None:
        self.m = m
        self.taken: set[tuple[int, int]] = set()
        self.props: set[tuple[int, int]] = {
            (int(a["x"] // T), int(round(a["y"] / T)) - 1)
            for a in m.anchors
            if a["props"].get("kind") in _PROP_ANCHOR_KINDS
        }
        self.placed: list[dict] = []

    def free(self, x: float, y: float, shared: bool = False) -> bool:
        return all(
            self.m.cell_free(*c) and c not in self.props and (shared or c not in self.taken)
            for c in _spot_cells(x, y)
        )

    def emit(self, landmark: str, role: str, x: float, y: float, facing: str, **props) -> None:
        self.taken.update(_spot_cells(x, y))
        self.placed.append(
            {"landmark": landmark, "role": role, "x": x, "y": y, "facing": facing, **props}
        )

    def put(
        self,
        landmark: str,
        role: str,
        x: float,
        y: float,
        facing: str,
        shifts: tuple[int, ...] = _SPOT_SHIFTS,
        **props,
    ) -> bool:
        """Place one spot, sliding along the row when its cell is blocked."""
        for dx in shifts:
            if self.free(x + dx, y):
                self.emit(landmark, role, x + dx, y, facing, **props)
                return True
        return False

    def pair(
        self, landmark: str, pair_id: str, x: int, y: int, shifts: tuple[int, ...] = _SPOT_SHIFTS
    ) -> bool:
        """A chat pair: two residents at (x-1, y) and (x+1, y) — 32 px apart,
        turned to face each other — with the cell between them kept clear."""
        for dx in shifts:
            cx = x + dx
            if self.free(cx - 1, y) and self.free(cx + 1, y) and self.free(cx, y):
                self.emit(landmark, "chat", cx - 1, y, "face", pair=pair_id, side="a")
                self.emit(landmark, "chat", cx + 1, y, "face", pair=pair_id, side="b")
                self.taken.add((cx, y))
                return True
        return False

    def pair_near(self, landmark: str, pair_id: str, x: int, y: int, radius: int = 6) -> bool:
        """Ring search outward from (x, y) for the first cell that fits a
        chat pair (top-to-bottom, left-to-right within each ring)."""
        for r in range(radius + 1):
            for oy in range(-r, r + 1):
                for ox in range(-r, r + 1):
                    if max(abs(ox), abs(oy)) != r:
                        continue
                    if self.pair(landmark, pair_id, x + ox, y + oy, shifts=(0,)):
                        return True
        return False

    def queue_run(self, start: tuple[int, int], step: tuple[int, int]) -> list[tuple[int, int]]:
        """Up to ``_QUEUE_LEN`` cells from ``start`` at a two-tile pitch. A
        blocked cell slides along its row like any spot; the run stops at a
        street or the tracks (a line never snakes across asphalt) and keeps
        every member at least two tiles from the previous one."""
        cells: list[tuple[int, int]] = []
        for i in range(_QUEUE_LEN):
            cx, cy = start[0] + step[0] * i, start[1] + step[1] * i
            if not self.m.inb(cx, cy) or self.m.on_street(cx, cy) or (cx, cy) in self.m.reserved:
                break
            for dx in _SPOT_SHIFTS:
                c = (cx + dx, cy)
                if c in cells or not self.free(*c, shared=True):
                    continue
                if cells and abs(c[0] - cells[-1][0]) + abs(c[1] - cells[-1][1]) < 2:
                    continue
                cells.append(c)
                break
        return cells


def _lawn_spots(m: MapCanvas, placer: _SpotPlacer, lm: Landmark, lawn: set[int]) -> None:
    """Poisson-disc (dart-throwing) sample of open grass inside a park's
    rect, seeded by the landmark name so rebuilds keep the same spots.
    When the rect itself offers too few cells — Lake Parsippany's rect is
    the water — the search grows one ring at a time onto the shore."""
    rng = random.Random(_stable_seed(lm.name))
    accepted: list[tuple[int, int]] = []
    x0, y0, x1, y1 = lm.x, lm.y, lm.x + lm.w - 1, lm.y + lm.h - 1
    for margin in range(4):
        ring = [
            (cx, cy)
            for cy in range(y0 - margin, y1 + margin + 1)
            for cx in range(x0 - margin, x1 + margin + 1)
            if (
                margin == 0
                or not (x0 - margin < cx < x1 + margin and y0 - margin < cy < y1 + margin)
            )
            and cell_is_lawn(m, cx, cy, lawn)
            and placer.free(cx, cy)
        ]
        rng.shuffle(ring)
        for cell in ring:
            if len(accepted) >= _LAWN_MAX:
                break
            if all(math.dist(cell, a) >= _LAWN_SEPARATION for a in accepted):
                accepted.append(cell)
                placer.emit(lm.name, "lawn", cell[0], cell[1], "down")
        if len(accepted) >= _LAWN_MIN:
            break


def emit_spot_anchors(m: MapCanvas) -> None:
    """Post-pass after the civic furniture: every landmark's authored
    standing spots, emitted as ``spot`` anchors so the runtime never piles
    a crowd on one door. Properties (all strings): ``role``, ``facing``
    (up/down/left/right, or ``face`` for a chat pair), ``cap`` (residents
    per spot), ``order`` (stable, unique per landmark; a queue's order is
    its rank from the door) and, for chat pairs, ``pair`` + ``side``.

    * ``bench`` / ``table`` / ``stall`` / ``platform`` — requested by the
      layout helpers of the same name, validated here once every prop is
      down (precise cells first, before anything with a fallback).
    * ``door`` (centred on the door, facing it), ``porch`` (either side of
      the door, facing out), ``window`` (under each facade window) and a
      ``chat`` pair two rows out — for every registered building front.
    * ``chat`` pairs near the centre-bottom of landmarks that have no
      front (parks, water, a bridge, a street — its pairs land on the
      sidewalk, one per quarter of a long street, because routines do
      send residents to "the corner"), searched outward until a clear
      pair of cells is found.
    * ``lawn`` — Poisson-disc scattered over a park's open grass.
    * ``queue`` — the polling place's decision-day line: a two-tile-pitch
      run beside the door, along whichever of left / right / down-the-walk
      fits the most residents; ``order`` 0 is the head of the line.

    A blocked cell slides up to two columns either way, then the spot is
    dropped; a landmark without a front keeps its chat pair and parks keep
    lawn spots, so every routine destination has somewhere to stand.
    """
    placer = _SpotPlacer(m)
    lawn = _grass_gids()

    for req in m.spot_requests:
        landmark = req["landmark"] or nearest_landmark(
            m, math.floor(req["x"]), math.floor(req["y"])
        )
        candidates = [(req["x"], req["y"], req["facing"]), *req.get("alternatives", ())]
        shifts = (0,) if req.get("exact") or req.get("alternatives") else _SPOT_SHIFTS
        for x, y, facing in candidates:
            if placer.put(landmark, req["role"], x, y, facing, shifts=shifts):
                break

    # Doorstep roles, one role at a time across every front rather than one
    # front at a time: in an attached row of narrow shops a porch that slid
    # sideways would otherwise take the next shop's door cell, and a door
    # matters more than a neighbour's porch.
    fronts = [
        (name, i, front) for name, fronts in m.fronts.items() for i, front in enumerate(fronts)
    ]
    for name, _, front in fronts:
        dx, dy, dw = front["door_x"], front["door_y"], front["door_w"]
        placer.put(name, "door", dx + dw / 2 - 0.5, dy + 1, "up")
    for name, _, front in fronts:
        dx, dy, dw = front["door_x"], front["door_y"], front["door_w"]
        placer.put(name, "porch", dx - 1.5, dy + 1, "down")
        placer.put(name, "porch", dx + dw + 0.5, dy + 1, "down")
    for name, _, front in fronts:
        for wx in _window_columns(m, front):
            placer.put(name, "window", wx, front["door_y"] + 1, "up", shifts=(0,))
    for name, i, front in fronts:
        dx, dy = front["door_x"], front["door_y"]
        pair_id = f"{name}#{i}"
        if not placer.pair(name, pair_id, dx, dy + 2):
            placer.pair_near(name, pair_id, dx, dy + 2)

    for lm in m.landmarks.values():
        if lm.name in m.fronts:
            continue
        cx, cy = lm.x + lm.w // 2, lm.y + lm.h // 2 + 1
        centres = [(cx, cy)]
        if lm.type == "road" and max(lm.w, lm.h) >= _LONG_STREET:
            if lm.w >= lm.h:
                centres = [(lm.x + lm.w * k // 4, cy) for k in (1, 2, 3)]
            else:
                centres = [(cx, lm.y + lm.h * k // 4 + 1) for k in (1, 2, 3)]
        for i, (px, py) in enumerate(centres):
            placer.pair_near(lm.name, f"{lm.name}#{i}", px, py)

    for lm in m.landmarks.values():
        if lm.type in _LAWN_TYPES:
            _lawn_spots(m, placer, lm, lawn)

    for lm in polling_landmarks(m)[:1]:
        fronts = m.fronts.get(lm.name)
        if not fronts:
            continue
        dx, dy, dw = fronts[0]["door_x"], fronts[0]["door_y"], fronts[0]["door_w"]
        runs = (
            placer.queue_run((dx, dy + 2), (0, 2)),  # down the walk
            placer.queue_run((dx - 1, dy + 1), (-2, 0)),  # left along the apron
            placer.queue_run((dx + dw, dy + 1), (2, 0)),  # right along the apron
        )
        for cx, cy in max(runs, key=len):
            placer.emit(lm.name, "queue", cx, cy, "up")

    # Number spots per landmark. The queue is ranked first so its order
    # reads 0.. from the door; everything else follows in emission order.
    counts: dict[str, int] = {}
    ranked = [s for s in placer.placed if s["role"] == "queue"] + [
        s for s in placer.placed if s["role"] != "queue"
    ]
    for s in ranked:
        s["order"] = counts.get(s["landmark"], 0)
        counts[s["landmark"]] = s["order"] + 1
    for s in placer.placed:
        props = {
            "role": s["role"],
            "facing": s["facing"],
            "cap": "1",
            "order": str(s["order"]),
        }
        if "pair" in s:
            props["pair"] = s["pair"]
            props["side"] = s["side"]
        # Feet 0.85 of the way down the cell, not on its bottom edge: an
        # anchor on the boundary samples the NEXT tile row (the street in
        # front of an apron) when the runtime classifies the ground.
        m.anchor("spot", s["x"], s["y"] - 0.15, name=s["landmark"], **props)


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
            noticeboard(m, x + 1, y + h - 3, landmark=lm.name)
            for _i in range(3):
                m.tree(
                    x + 1 + m.rng.randrange(max(1, lm.w - 4)),
                    y + 1 + m.rng.randrange(max(1, lm.h - 3)),
                    stamp=m.rng.choice(("tree_light", "tree_dark")),
                )
            m.flowers(x + w // 2, y + h - 2, n=6)
        elif lm.type == "church":
            church(
                m,
                x,
                y + max(0, h - 8),
                max(6, min(w, 8)),
                max(7, min(h, 8)),
                garden=True,
                landmark=lm.name,
            )
        elif lm.type == "civic":
            grand(m, x, y, min(w, 9), min(h, 8), facade="stone_large", landmark=lm.name)
        elif lm.type == "transport":
            grand(m, x, y, min(w, 8), min(h, 7), facade="stone_small", landmark=lm.name)
        elif lm.type == "housing":
            n = max(1, lm.w // 6)
            for i in range(n):
                cottage(m, x + i * 6, y, 5, min(6, h), landmark=lm.name)
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
                landmark=lm.name,
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
    emit_civic_anchors(m)
    emit_spot_anchors(m)
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
