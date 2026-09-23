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
        #: Lane polylines and stop lines derived from the road network by
        #: ``emit_traffic`` (the frontend's TrafficLayer drives cars on them).
        self.traffic: list[dict] = []
        #: Building footprints (x, y, w, h) queued by ``shadow_rect`` at the
        #: end of every recipe; ``emit_building_shadows`` paints them once
        #: the standing spots are known, so a shadow never takes a doorstep.
        self.shadow_requests: list[tuple[int, int, int, int]] = []
        #: Deferred ground-detail writes ``(x, y, gid)`` — stall stripes,
        #: porch decks — flushed after the road/sidewalk blobs so they are
        #: not poured over (``flush_markings``; ``paint_roads`` flushes too).
        self.markings: list[tuple[int, int, int, bool]] = []
        self.roads_painted = False
        #: Cells taken by emitted ``spot`` anchors (filled by
        #: ``emit_spot_anchors``); later dressing passes keep off them.
        self.spot_cells: set[tuple[int, int]] = set()
        #: Cells of the map-edge exit gaps (filled by ``emit_edge_ring``).
        self.exit_gaps: set[tuple[int, int]] = set()
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

    def signal_anchor(self, tx: int, ty: int, axis: str) -> None:
        """A ``signal`` anchor at the CENTRE of head tile (tx, ty): the
        runtime swaps that tile between ``signal_red`` / ``signal_green``,
        looking it up at ``floor(x / T)``, ``floor(y / T)``; ``axis`` is the
        traffic axis (``h`` / ``v``) whose cars the head governs."""
        self.anchors.append(
            {
                "name": "",
                "x": (tx + 0.5) * T,
                "y": (ty + 0.5) * T,
                "props": {"kind": "signal", "axis": axis},
            }
        )

    def apron_cells(self) -> set[tuple[int, int]]:
        """Door aprons of every registered front: the cells directly under
        each door, where the door / porch spots will stand."""
        cells: set[tuple[int, int]] = set()
        for fronts in self.fronts.values():
            for f in fronts:
                for dx in range(f["door_x"] - 2, f["door_x"] + f["door_w"] + 2):
                    cells.add((dx, f["door_y"] + 1))
        return cells

    def authored_cells(self) -> set[tuple[int, int]]:
        """Cells the layout has promised to residents: queued spot requests
        (with their alternatives) plus every door apron."""
        cells = self.apron_cells()
        for req in self.spot_requests:
            for x, y, _facing in [(req["x"], req["y"], ""), *req.get("alternatives", ())]:
                cells.update(_spot_cells(x, y))
        return cells

    def placeable(
        self, x: int, y: int, keep: set[tuple[int, int]] | None = None, street_only: bool = True
    ) -> bool:
        """May a new prop tile go on (x, y)? In bounds, off the street (or,
        with ``street_only=False``, off every asphalt cell), not reserved,
        not under a collision rect, nothing on deco-below / the building
        layers, and not one of the ``keep`` cells (authored spots, aprons,
        exit gaps)."""
        if not self.inb(x, y) or (x, y) in self.reserved:
            return False
        if self.on_street(x, y) or (not street_only and (x, y) in self.road_mask):
            return False
        if keep and (x, y) in keep:
            return False
        if self.collided((x + 0.5) * T, (y + 0.5) * T):
            return False
        return not (
            self.get("deco-below", x, y)
            or self.get("buildings-base", x, y)
            or self.get("buildings-top", x, y)
        )

    def flush_markings(self) -> None:
        """Write the deferred ground-detail markings (idempotent). A
        ``soft`` marking only lands on a still-bare cell."""
        for x, y, g, soft in self.markings:
            if soft and self.get("ground-detail", x, y):
                continue
            self.set("ground-detail", x, y, g)
        self.markings = []

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
            # Curb returns: at every convex sidewalk corner that turns
            # toward asphalt (the four crooks of a junction, a lot mouth)
            # the quarter-arc ``curb_*`` overlay draws the corner's curb
            # line on deco-below; the corner tile and its backing stay.
            curb_for = {
                M.mg("swk_nw"): M.mg("curb_nw"),
                M.mg("swk_ne"): M.mg("curb_ne"),
                M.mg("swk_sw"): M.mg("curb_sw"),
                M.mg("swk_se"): M.mg("curb_se"),
            }
            keep = self.authored_cells()
            for x, y in ring:
                g = self.get("ground-detail", x, y)
                d = swk_corner.get(g)
                if not d or (x + d[0], y + d[1]) not in road or (x, y) in keep:
                    continue
                if self.get("deco-below", x, y) == 0 and (x, y) not in self.reserved:
                    self.set("deco-below", x, y, curb_for[g])

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
            for _j, side, band in self.crosswalk_bands():
                g = M.mg("crosswalk_h") if side in ("w", "e") else M.mg("crosswalk_v")
                for c in band:
                    self.set("ground-detail", *c, g)
        self.roads_painted = True
        self.flush_markings()

    def crosswalk_bands(self) -> list[tuple[tuple[int, int, int, int], str, list[tuple[int, int]]]]:
        """Crosswalk bands at every real crossing: ``(junction, side, cells)``
        where side is the junction edge the band sits on (w/e bands cross
        the horizontal street, n/s bands cross the vertical one). An L-bend
        (two segments meeting end-to-end, only 2 road arms) gets none."""
        road = self.road_mask
        out = []
        for jx0, jy0, jx1, jy1 in self._junctions():
            bands = {
                "w": [(jx0 - 1, y) for y in range(jy0, jy1 + 1)],
                "e": [(jx1 + 1, y) for y in range(jy0, jy1 + 1)],
                "n": [(x, jy0 - 1) for x in range(jx0, jx1 + 1)],
                "s": [(x, jy1 + 1) for x in range(jx0, jx1 + 1)],
            }
            live = {k: b for k, b in bands.items() if all(c in road for c in b)}
            if len(live) < 3:
                continue
            for side in ("w", "e", "n", "s"):
                if side in live:
                    out.append(((jx0, jy0, jx1, jy1), side, live[side]))
        return out

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

    def shade(self, x: int, y: int, w: int, h: int) -> None:
        """Cooler ``GRASS_DARK`` lawn (tree shade, the strip behind a
        building): a rect painted only over open grass, with the blob's
        edges and hole fillets softening it back into the base grass."""
        self.shade_cells(
            {(xx, yy) for yy in range(y, y + h) for xx in range(x, x + w) if self.inb(xx, yy)}
        )

    def shade_cells(self, cells: set[tuple[int, int]]) -> None:
        """Paint ``GRASS_DARK`` over the open-grass members of ``cells``
        (base grass or light meadow, off roads and plazas). Every patch of
        shade already on the map joins the autotile mask, so patches pour
        together instead of drawing edges against each other, and cells
        beyond the map border count as shade so the outer edge of a band
        along the border stays seamless."""
        lawn = _grass_gids()
        dark = _dark_grass_gids()
        keep = {
            c
            for c in cells
            if self.inb(*c)
            and c not in self.road_mask
            and c not in self.paved
            and (self.get("ground-detail", *c) == 0 or self.get("ground-detail", *c) in lawn)
        }
        if not keep:
            return
        mask = set(keep)
        for y in range(self.h):
            for x in range(self.w):
                if self.layers["ground-detail"][y][x] in dark:
                    mask.add((x, y))
        for x, y in list(mask):
            if x in (0, self.w - 1) or y in (0, self.h - 1):
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        if not self.inb(x + dx, y + dy):
                            mask.add((x + dx, y + dy))
        self.blob("ground-detail", mask, M.GRASS_DARK)

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
        m.homes.append({"x": x, "y": y, "w": w, "h": h, "landmark": landmark, "door_x": x + dd})
    if awning:
        # hangs over the top of the shopfront, door row stays visible
        m.stamp("buildings-top", awning_strip(w), x, y + roof_h - 1)
    elif sign is not None:
        sx = x + w - 3 if dd <= (w - 2) // 2 else x + 1
        m.stamp("buildings-top", R.SIGNS_WALL[sign % len(R.SIGNS_WALL)], sx, y + roof_h)
    m.collide(x, y, w, h)
    shadow_rect(m, x, y, w, h)


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
    shadow_rect(m, x, y, w, h)


def cottage(
    m: MapCanvas,
    x: int,
    y: int,
    w: int = 6,
    h: int = 8,
    roof: str = "deck_light",
    landmark: str | None = None,
    chimney: bool = True,
    deck: bool | None = None,
) -> None:
    """Colonial house: pitched shingle roof over a cream clapboard front —
    paired shutter windows upstairs, centered door below. Footprint w x h,
    h >= 6, w >= 6 keeps the paired windows. Every cottage is a dwelling:
    it gets a hearth chimney and yard-sign anchors on its lawn. From w >= 5
    a house-number plaque hangs beside the door and one window carries an
    AC unit; from w >= 6 (``deck`` unless overridden) a plank porch deck
    with a step runs along the front."""
    m.reserve(x, y - 1, w, h + 1)
    roof_h = max(2, h - 4)
    m.stamp("buildings-top", roof_stamp(roof, w, roof_h), x, y)
    m.stamp("buildings-base", facade_wall("cream", w, rows=[2, 3, 4, 5]), x, y + roof_h)
    for wx in [x + 1, x + w - 3] if w >= 6 else [x + (w - 2) // 2]:
        m.stamp("buildings-base", M.SHUTTER_WINDOW, wx, y + roof_h)
    dx = x + (w - 2) // 2
    m.building_stamp(R.DOOR_WOOD, dx, y + roof_h + 2, top_rows=1)
    if w >= 5:
        # transparent overlays ride buildings-top so the wall tile stays
        # behind them (the sign-tile trick); the plaque hangs right of the
        # door's top row, the AC unit sits in the right window's lower sash
        m.set("buildings-top", dx + 2, y + roof_h + 2, M.mg("house_num"))
        m.set("buildings-top", x + w - 3 if w >= 6 else dx + 1, y + roof_h + 1, M.mg("ac_window"))
    m.collide(x, y, w, h)
    if chimney:
        m.chimney(x + w - 2, y - 1)
    m.register_front(landmark, x, y, w, h, dx, y + h - 1, y + roof_h)
    m.homes.append({"x": x, "y": y, "w": w, "h": h, "landmark": landmark or "", "door_x": dx})
    if deck or (deck is None and w >= 6):
        porch(m, x, y + h, w, door_x=dx)
    shadow_rect(m, x, y, w, h)


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
    shadow_rect(m, x, y, w, h)
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
    shadow_rect(m, x, y, w, h)


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


# ---------------------------------------------------------------------------
# Map II — vehicles, lots and cast shadows
# ---------------------------------------------------------------------------


def _blob_gids(b: Blob) -> set[int]:
    out: set[int] = set(b.fill)
    for value in b.edge_tiles().values():
        if isinstance(value, int):
            if value:
                out.add(value)
        else:
            out.update(g for g in value if g)
    return out


def _dark_grass_gids() -> set[int]:
    return _blob_gids(M.GRASS_DARK)


def _water_gids() -> set[int]:
    out = _blob_gids(R.WATER_DEEP) | _blob_gids(R.WATER_SHALLOW) | set(R.WATER_LAKE_FILL)
    out.update(R.STREAM_V)
    for s in (R.POND_GRASS, R.POND_STONE, R.POND_TERRACOTTA, R.POND_STONE_OUTLET_S):
        out.update(g for _, _, g in s.cells())
    return out


def _pavement_gids() -> set[int]:
    """Ground-detail gids a resident walks on as pavement: sidewalk, tan
    path, cobbles, plank decks and trodden dirt."""
    out = _blob_gids(M.SIDEWALK) | _blob_gids(R.PATH_TAN) | _blob_gids(R.COBBLE_PAD)
    out |= _blob_gids(M.WORN)
    out.update(R.COBBLE_FILL)
    out.update(R.PLAZA_COBBLE_FILL)
    out.update(R.STONE_FLOOR_FILL)
    out.update(R.PLANKS_LIGHT)
    out.update(R.PLANKS_DARK)
    for s in (R.DECK_LIGHT, R.DECK_DARK, R.STONE_FLOOR_PAD):
        out.update(g for _, _, g in s.cells())
    return out


#: Vehicle stamps by (kind, orient); ``h`` faces east, ``v`` faces south.
_VEHICLES: dict[tuple[str, str], TileStamp | dict[str, TileStamp]] = {
    ("car", "h"): M.CAR_H,
    ("car", "v"): M.CAR_V,
    ("pickup", "h"): M.PICKUP_H,
    ("pickup", "v"): M.PICKUP_V,
    ("bus", "h"): M.BUS_H,
    ("bus", "v"): M.BUS_V,
    ("schoolbus", "h"): M.SCHOOLBUS_H,
}


def vehicle(
    m: MapCanvas,
    kind: str,
    x: int,
    y: int,
    orient: str = "h",
    color: str | None = None,
    facing: str | None = None,
) -> bool:
    """Park one vehicle with its top-left tile at (x, y): the stamp goes on
    deco-below (a car is a low prop residents walk in front of) and its
    footprint is collided. ``kind`` is ``car`` / ``pickup`` / ``bus`` /
    ``schoolbus`` (the school bus only exists horizontally); ``orient``
    ``h`` faces east and ``v`` faces south unless ``facing`` turns it the
    other way (``w`` / ``n``, a mirrored stamp). ``color`` picks a car's
    paint, random when omitted. Nothing is placed — and False returned —
    when a footprint cell is a street, reserved, already dressed, under a
    collision rect or promised to a standing spot."""
    try:
        stamp = _VEHICLES[(kind, orient)]
    except KeyError as exc:
        raise ValueError(f"no {kind!r} vehicle with orient {orient!r}") from exc
    if isinstance(stamp, dict):
        stamp = stamp[color or m.rng.choice(M.CAR_COLORS)]
    rows = [list(r) for r in stamp.gids]
    if facing == "w" and orient == "h":
        rows = [[g | R.FLIP_H if g else 0 for g in reversed(r)] for r in rows]
    elif facing == "n" and orient == "v":
        rows = [[g | R.FLIP_V if g else 0 for g in r] for r in reversed(rows)]
    w, h = len(rows[0]), len(rows)
    keep = m.authored_cells()
    if not all(m.placeable(x + c, y + r, keep) for r in range(h) for c in range(w)):
        return False
    for r, row in enumerate(rows):
        for c, g in enumerate(row):
            if g:
                m.set("deco-below", x + c, y + r, g)
    m.collide(x, y, w, h)
    return True


def park_stalls(
    m: MapCanvas,
    x: int,
    y: int,
    w: int,
    h: int,
    orient: str = "h",
    landmark: str = "",
    fill: float = 0.7,
    surface: str = "concrete",
    curb: str = "n",
) -> int:
    """A parking lot ``w x h`` at (x, y). ``surface="concrete"`` paves it so
    it pours with the sidewalks (``m.pave``); ``"asphalt"`` adds it to the
    road mask instead (the curbed ring wraps it — give it a driveway).
    With ``orient="h"`` the stalls are 2x1 (cars facing east / west),
    stacked at a one-cell pitch in columns of ``[2 stalls][aisle][2
    stalls]``; with ``"v"`` they are 1x2 in rows of the same rhythm. Each
    stall is filled with probability ``fill`` (seeded by the town rng) by a
    random-colour car — one in eight a pickup — nosed in either way. An
    asphalt lot with vertical stalls gets stall stripes on the closed end
    of each stall — ``curb`` names the side (``n`` / ``s``) the first row
    of stalls backs onto; the second row backs onto the other — deferred
    until the lot is painted. A bike rack takes the south-east corner and,
    on a concrete lot with a ``landmark``, a waiting spot stands beside it
    (a spot never goes on asphalt). Returns the number of vehicles parked."""
    if orient not in ("h", "v"):
        raise ValueError("park_stalls orient must be 'h' or 'v'")
    if curb not in ("n", "s"):
        raise ValueError("park_stalls curb must be 'n' or 's'")
    if surface == "asphalt":
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                if m.inb(xx, yy):
                    m.road_mask.add((xx, yy))
    else:
        m.pave(x, y, w, h)
    rack = (x + w - 1, y + h - 1)
    stalls: list[tuple[int, int, int, int, bool]] = []  # x, y, w, h, curb_side_first
    if orient == "h":
        gx = x
        while gx < x + w:
            for sx, first in ((gx, True), (gx + 3, False)):
                if sx + 1 < x + w:
                    stalls.extend((sx, yy, 2, 1, first) for yy in range(y, y + h))
            gx += 5
    else:
        gy = y
        while gy < y + h:
            for sy, first in ((gy, True), (gy + 3, False)):
                if sy + 1 < y + h:
                    stalls.extend((xx, sy, 1, 2, first) for xx in range(x, x + w))
            gy += 5
    parked = 0
    stripe = M.mg("parking_stall")
    for sx, sy, sw, sh, first in stalls:
        if rack[0] in range(sx, sx + sw) and rack[1] in range(sy, sy + sh):
            continue
        if surface == "asphalt" and orient == "v":
            north = first == (curb == "n")
            mark = (sx, sy, stripe) if north else (sx, sy + 1, stripe | R.FLIP_V)
            if m.roads_painted:
                m.set("ground-detail", *mark)
            else:
                m.markings.append((*mark, False))
        if m.rng.random() >= fill:
            continue
        kind = "pickup" if m.rng.random() < 0.12 else "car"
        facing = None
        if m.rng.random() < 0.5:
            facing = "w" if orient == "h" else "n"
        if vehicle(m, kind, sx, sy, orient, facing=facing):
            parked += 1
    if m.placeable(*rack):
        m.stamp("deco-below", M.BIKE_RACK, *rack)
        m.collide(rack[0], rack[1], 1, 1)
        if landmark and surface != "asphalt":
            m.spot("bench", rack[0] - 1, rack[1], "up", landmark, exact=True)
    return parked


def shadow_rect(m: MapCanvas, x: int, y: int, w: int, h: int) -> None:
    """Queue the cast shadow of a ``w x h`` building at (x, y) — one row
    along its south face and one column down its east side, light from the
    north-west. Every recipe calls this last; ``emit_building_shadows``
    paints the queue once the standing spots exist, so a shadow never lands
    on a doorstep, a street, water, another building or a prop."""
    m.shadow_requests.append((x, y, w, h))


def emit_building_shadows(m: MapCanvas) -> None:
    """Paint the queued building shadows onto empty deco-below cells:
    ``sh_full`` along the south row (``y + h``) and the east column
    (``x + w``), ``sh_fade_w`` (dithered west edge) at the west end of a
    south run and mirrored at its east end, ``sh_fade_n`` at the top of the
    column and mirrored at its foot, and a full tile where row and column
    meet. Runs break around anything already there — a spot cell, a door
    apron, a road, a planter — and end softly on both sides of the break."""
    keep = m.spot_cells | m.authored_cells() | m.exit_gaps
    # cells under prop sprites (yard signs, trees, lamps): a sign's lawn
    # cell must stay bare, and a shadow under a trunk is wasted anyway
    keep |= {
        (int(a["x"] // T), int(round(a["y"] / T)) - 1)
        for a in m.anchors
        if a["props"].get("kind") in _PROP_ANCHOR_KINDS
    }
    water = _water_gids()
    full, fade_n, fade_w = M.mg("sh_full"), M.mg("sh_fade_n"), M.mg("sh_fade_w")

    def free(c: tuple[int, int]) -> bool:
        return (
            m.inb(*c)
            and c not in keep
            and c not in m.reserved
            and not m.on_street(*c)
            and m.get("deco-below", *c) == 0
            and m.get("buildings-base", *c) == 0
            and m.get("buildings-top", *c) == 0
            and m.get("ground-detail", *c) not in water
        )

    for x, y, w, h in m.shadow_requests:
        column = [(x + w, yy) for yy in range(y, y + h)]
        row = [(xx, y + h) for xx in range(x, x + w)]
        corner = (x + w, y + h)
        cells = {c for c in column + row + [corner] if free(c)}
        if corner in cells and (x + w - 1, y + h) not in cells and (x + w, y + h - 1) not in cells:
            cells.discard(corner)  # a lone corner square reads as dirt
        for cx, cy in cells:
            if (cx, cy) == corner:
                if (cx - 1, cy) in cells and (cx, cy - 1) in cells:
                    g = full
                elif (cx, cy - 1) in cells:
                    g = fade_n | R.FLIP_V
                else:
                    g = fade_w | R.FLIP_H
            elif cx == x + w:
                if (cx, cy - 1) not in cells:
                    g = fade_n
                elif (cx, cy + 1) not in cells:
                    g = fade_n | R.FLIP_V
                else:
                    g = full
            elif (cx - 1, cy) not in cells:
                g = fade_w
            elif (cx + 1, cy) not in cells:
                g = fade_w | R.FLIP_H
            else:
                g = full
            m.set("deco-below", cx, cy, g)


# ---------------------------------------------------------------------------
# Map II — suburb and street vocabulary
# ---------------------------------------------------------------------------

_CURB_GIDS = frozenset(M.mg(n) for n in ("curb_nw", "curb_ne", "curb_sw", "curb_se"))


def _post_free(m: MapCanvas, x: int, y: int, keep: set[tuple[int, int]]) -> bool:
    """A sign / pole post may stand here: placeable; or only a curb-return
    overlay is in the way (the post takes the corner); or the cell is a
    building's reserved back row that is still bare, uncollided grass or
    pavement (the one-row strip between a sidewalk and the roof behind
    it is exactly where a corner post stands)."""
    if m.placeable(x, y, keep):
        return True
    if not m.inb(x, y) or m.on_street(x, y) or (x, y) in keep:
        return False
    if m.collided((x + 0.5) * T, (y + 0.5) * T):
        return False
    if m.get("buildings-base", x, y) or m.get("buildings-top", x, y):
        return False
    deco = m.get("deco-below", x, y)
    if deco and deco not in _CURB_GIDS:
        return False
    ground = m.get("ground-detail", x, y)
    return ground == 0 or ground in _grass_gids() | _dark_grass_gids() | _pavement_gids()


def _head_free(m: MapCanvas, x: int, y: int) -> bool:
    """The tall tile of a 1x2 street prop may hang here: in bounds, not
    over a street, and nothing drawn on the cell yet (a head over a wall,
    a prop or another head would read as clutter) — a curb-return arc on a
    junction crook is the one overlay a head may hang over."""
    return (
        m.inb(x, y)
        and not m.on_street(x, y)
        and m.get("buildings-top", x, y) == 0
        and m.get("buildings-base", x, y) == 0
        and m.get("deco-below", x, y) in _CURB_GIDS | {0}
    )


def _tall_prop(m: MapCanvas, x: int, y: int, top: int, base: int) -> bool:
    """Stand a 1x2 prop with its post on (x, y) (deco-below, collided) and
    its head on the row above (buildings-top, so walkers pass beneath)."""
    if not (_post_free(m, x, y, m.authored_cells()) and _head_free(m, x, y - 1)):
        return False
    m.set("deco-below", x, y, base)
    m.set("buildings-top", x, y - 1, top)
    m.collide(x + 0.35, y + 0.3, 0.3, 0.7)
    return True


def porch(m: MapCanvas, x: int, y: int, w: int, door_x: int | None = None) -> None:
    """A one-row plank porch deck along row ``y`` (a house's apron row),
    inset one cell from either end of the ``w``-wide front so the lawn
    corners stay free for yard signs, with a two-tile stone step below the
    door. Both are deferred ground-detail markings, so a walk or lane
    poured later does not erase them; the step is only laid on bare grass."""
    dx = door_x if door_x is not None else x + (w - 2) // 2
    for xx in range(x + 1, x + w - 1):
        if m.inb(xx, y) and not m.on_street(xx, y) and (xx, y) not in m.reserved:
            m.markings.append((xx, y, m.rng.choice(R.PLANKS_LIGHT), False))
    for sx in (dx, dx + 1):
        if m.inb(sx, y + 1) and not m.on_street(sx, y + 1):
            m.markings.append((sx, y + 1, M.mg("steps"), True))


def garage(m: MapCanvas, x: int, y: int, roof: str = "cedar", door_dx: int = 0, h: int = 3) -> None:
    """A detached 3-wide clapboard garage: a shingle roof (one eave row on
    the 3-tall box, ridge + eave when ``h`` is 4) over cream walls holding
    the 2x2 panelled ``GARAGE_DOOR`` (``door_dx`` 0 or 1 picks the bay).
    No front is registered — nobody loiters at a garage door."""
    w = 3
    if h not in (3, 4) or door_dx not in (0, 1):
        raise ValueError("garage: h must be 3 or 4 and door_dx 0 or 1")
    cw = SHINGLE_ALIASES.get(roof, roof)
    m.reserve(x, y - 1, w, h + 1)
    if h == 4:
        m.stamp("buildings-top", roof_stamp(cw, w, 2), x, y)
    else:
        for c, side in enumerate(("l", "m", "r")):
            m.set("buildings-top", x + c, y, M.mg(f"shg_{cw}_eave_{side}"))
    wall_y = y + h - 2
    m.stamp("buildings-base", facade_wall("cream", w, rows=[4, 5]), x, wall_y)
    m.stamp("buildings-base", M.GARAGE_DOOR, x + door_dx, wall_y)
    m.collide(x, y, w, h)
    shadow_rect(m, x, y, w, h)


def shed(m: MapCanvas, x: int, y: int) -> None:
    """The 2x2 cedar-roofed garden shed: roof row on buildings-top, wall
    row on buildings-base, footprint collided and shadowed."""
    m.reserve(x, y - 1, 2, 3)
    m.building_stamp(M.SHED, x, y, top_rows=1)
    m.collide(x, y, 2, 2)
    shadow_rect(m, x, y, 2, 2)


def driveway(
    m: MapCanvas,
    x: int,
    y: int,
    w: int,
    h: int,
    car: bool = True,
    car_at: tuple[int, int] | None = None,
) -> bool:
    """A concrete driveway ``w x h`` poured with the sidewalks, usually
    running from a garage door to the street. With ``car`` a car is parked
    on it six times in ten (seeded), lengthwise, at ``car_at`` (default: the
    driveway's top-left, the garage end). Returns whether a car was parked."""
    m.pave(x, y, w, h)
    if not car or m.rng.random() >= 0.6:
        return False
    cx, cy = car_at if car_at else (x, y)
    orient = "v" if h >= w else "h"
    facing = None
    if m.rng.random() < 0.5:
        facing = "n" if orient == "v" else "w"
    return vehicle(m, "car", cx, cy, orient, facing=facing)


def hedge_line(m: MapCanvas, x0: int, y0: int, x1: int, y1: int) -> None:
    """A clipped hedge along a straight line (horizontal or vertical,
    inclusive ends) from the ``HEDGE`` kit: end caps, straight runs, a
    mulch bed on bare grass beneath, and one collision rect per run. Cells
    that are taken (a street, a prop, a doorstep) break the hedge into
    separate capped runs."""
    if x0 != x1 and y0 != y1:
        raise ValueError("hedge_line is straight only")
    horizontal = y0 == y1
    if horizontal:
        cells = [(xx, y0) for xx in range(min(x0, x1), max(x0, x1) + 1)]
    else:
        cells = [(x0, yy) for yy in range(min(y0, y1), max(y0, y1) + 1)]
    keep = m.authored_cells()
    runs: list[list[tuple[int, int]]] = []
    for c in cells:
        if m.placeable(*c, keep):
            if runs and runs[-1] and runs[-1][-1] in ((c[0] - 1, c[1]), (c[0], c[1] - 1)):
                runs[-1].append(c)
            else:
                runs.append([c])
        else:
            runs.append([])
    mulch = (M.mg("mulch_a"), M.mg("mulch_b"))
    for run in runs:
        if not run:
            continue
        for i, (cx, cy) in enumerate(run):
            if len(run) == 1:
                piece = "h" if horizontal else "v"
            elif i == 0:
                piece = "end_w" if horizontal else "end_n"
            elif i == len(run) - 1:
                piece = "end_e" if horizontal else "end_s"
            else:
                piece = "h" if horizontal else "v"
            m.stamp("deco-below", M.HEDGE[piece], cx, cy)
            if m.get("ground-detail", cx, cy) == 0:
                m.set("ground-detail", cx, cy, m.rng.choice(mulch))
        (ax, ay), (bx, by) = run[0], run[-1]
        m.collide(ax, ay, bx - ax + 1, by - ay + 1)


def poles(m: MapCanvas, cells: list[tuple[int, int]], pitch: int = 6) -> int:
    """Utility poles every ``pitch`` cells along ``cells`` (an ordered run
    of verge / sidewalk cells; the post stands ON the cell, the crossarm on
    the row above) with wires strung between consecutive aligned poles on
    buildings-top, so they cross above walkers and never over a street. A
    pole whose post or crossarm cell is taken is skipped; a wire cell that
    is taken leaves a gap. Returns the number of poles raised."""
    placed: list[tuple[int, int]] = []
    keep = m.authored_cells()
    for i in range(0, len(cells), pitch):
        x, y = cells[i]
        if not (_post_free(m, x, y, keep) and _head_free(m, x, y - 1)):
            continue
        m.set("deco-below", x, y, M.mg("pole_base"))
        m.set("buildings-top", x, y - 1, M.mg("pole_top"))
        m.collide(x + 0.35, y + 0.3, 0.3, 0.7)
        placed.append((x, y))
    wire_h, wire_v = M.mg("wire_h"), M.mg("wire_v")
    for (ax, ay), (bx, by) in zip(placed, placed[1:], strict=False):
        if ay == by:
            wires = [(xx, ay - 1) for xx in range(min(ax, bx) + 1, max(ax, bx))]
            g = wire_h
        elif ax == bx:
            wires = [(ax, yy) for yy in range(min(ay, by), max(ay, by) - 1)]
            g = wire_v
        else:
            continue
        for wx, wy in wires:
            if _head_free(m, wx, wy):
                m.set("buildings-top", wx, wy, g)
    return len(placed)


def signal(m: MapCanvas, jx0: int, jy0: int, jx1: int, jy1: int) -> int:
    """Traffic signals on the four sidewalk corners of the junction whose
    asphalt rect is (jx0, jy0)-(jx1, jy1) inclusive. Each head is the top
    tile of the 1x2 ``SIGNAL`` stamp (buildings-top; the pole below it on
    deco-below, collided) placed so neither tile hangs over the street: the
    north heads stand one row up from the crook, the south heads on it. A
    ``signal`` anchor sits at each head's centre — ``axis`` is the traffic
    it governs, the driver's near-right head: SW and NE for the east-west
    street, NW and SE for the north-south one — which is what makes
    ``emit_traffic`` mark the junction's stop lines signal-controlled.
    Returns the number of heads placed."""
    heads = (
        (jx0 - 1, jy0 - 2, "v"),
        (jx1 + 1, jy0 - 2, "h"),
        (jx0 - 1, jy1 + 1, "h"),
        (jx1 + 1, jy1 + 1, "v"),
    )
    n = 0
    for hx, hy, axis in heads:
        if _tall_prop(m, hx, hy + 1, M.mg("signal_red"), M.mg("signal_pole")):
            m.signal_anchor(hx, hy, axis)
            n += 1
    return n


def stop_sign(m: MapCanvas, x: int, y: int) -> bool:
    """A stop sign with its post on (x, y) — a junction crook, on the
    approaching driver's right — and the sign face on the row above."""
    return _tall_prop(m, x, y, M.mg("stop_top"), M.mg("sign_post"))


def street_blade(m: MapCanvas, x: int, y: int) -> bool:
    """A street-name blade on a post at (x, y)."""
    return _tall_prop(m, x, y, M.mg("blade_top"), M.mg("sign_post"))


def road_sign(m: MapCanvas, x: int, y: int, text: str) -> bool:
    """A blank green destination sign with its post on (x, y) plus a
    ``roadsign`` anchor carrying ``text`` (the runtime letters a pixel-font
    chip over it)."""
    if not _tall_prop(m, x, y, M.mg("exit_sign_t"), M.mg("exit_sign_b")):
        return False
    m.anchor("roadsign", x, y, name=text, text=text)
    return True


def bus_shelter(m: MapCanvas, x: int, y: int, landmark: str = "") -> bool:
    """The 3x2 glass bus shelter with its top-left at (x, y): roof row on
    buildings-top, bench row on deco-below, footprint collided, and three
    waiting spots on the row in front facing the street side (``bench``
    role, precise cells)."""
    keep = m.authored_cells()
    if not all(m.placeable(x + c, y + r, keep) for r in range(2) for c in range(3)):
        return False
    m.building_stamp(M.SHELTER, x, y, top_rows=1)
    m.collide(x, y, 3, 2)
    for sx in range(x, x + 3):
        m.spot("bench", sx, y + 2, "up", landmark, exact=True)
    return True


# ---------------------------------------------------------------------------
# Map II — ground tones, desire lines and the edge ring
# ---------------------------------------------------------------------------


def _line4(a: tuple[int, int], b: tuple[int, int]) -> list[tuple[int, int]]:
    """A 4-connected Bresenham walk from ``a`` to ``b`` (both inclusive):
    one axis step per move, always the one that stays closest to the ideal
    line, so every cell touches the next by an edge and the WORN autotile
    can join them."""
    (x0, y0), (x1, y1) = a, b
    dx, dy = abs(x1 - x0), abs(y1 - y0)
    sx, sy = (1 if x1 >= x0 else -1), (1 if y1 >= y0 else -1)
    cells = [(x0, y0)]
    x, y = x0, y0
    n = dx + dy
    for i in range(n):
        t = (i + 1) / n
        ix, iy = x0 + sx * dx * t, y0 + sy * dy * t
        step_x = abs(x + sx - ix) + abs(y - iy) <= abs(x - ix) + abs(y + sy - iy)
        if (step_x and x != x1) or y == y1:
            x += sx
        else:
            y += sy
        cells.append((x, y))
    return cells


def _open_grass(m: MapCanvas, c: tuple[int, int], lawn: set[int]) -> bool:
    """Bare grass (base, light meadow or dark shade) with nothing on it."""
    if not m.inb(*c) or c in m.road_mask or c in m.paved or c in m.reserved:
        return False
    if m.get("deco-below", *c) or m.get("buildings-base", *c) or m.get("buildings-top", *c):
        return False
    g = m.get("ground-detail", *c)
    return g == 0 or g in lawn


def desire_path(m: MapCanvas, a: tuple[int, int], b: tuple[int, int]) -> set[tuple[int, int]]:
    """A one-wide trodden line (the ``WORN`` autotile) from cell ``a`` to
    cell ``b`` over open grass only — pavement, props and buildings along
    the walk are simply not painted, so the line breaks where people would
    already be on something. Returns the cells painted."""
    lawn = _grass_gids() | _dark_grass_gids()
    worn = {c for c in _line4(a, b) if _open_grass(m, c, lawn)}
    if worn:
        m.blob("ground-detail", worn, M.WORN, holes=False)
    return worn


def _tree_cells(m: MapCanvas) -> list[tuple[int, int]]:
    return [
        (int(a["x"] // T), int(a["y"] // T) - 1)
        for a in m.anchors
        if a["props"].get("kind") == "tree"
    ]


def emit_ground_shade(m: MapCanvas) -> None:
    """Post-pass, after a layout's props and trees are down: the lawn's
    third tone plus its litter.

    * ``GRASS_DARK`` shade under every tree cluster (three or more trees
      within three cells of each other: the 3x3 around each trunk) and a
      one-row strip along the north face of every building at least five
      wide, so buildings and woods sit IN the grass instead of on it;
    * ``clover_a/b`` on 6% of a park's open lawn cells, ``mulch_a/b`` on
      the bare grass under planters and hedges, and ``litter_a/b`` on 4%
      of the shaded cells — never on a street, a spot or a prop."""
    m.flush_markings()
    trees = _tree_cells(m)
    shade: set[tuple[int, int]] = set()
    for i, (tx, ty) in enumerate(trees):
        near = sum(
            1
            for j, (ox, oy) in enumerate(trees)
            if j != i and abs(ox - tx) <= 3 and abs(oy - ty) <= 3
        )
        if near >= 2:
            shade.update((tx + dx, ty + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1))
    for x, y, w, _h in m.shadow_requests:
        if w >= 5:
            shade.update((xx, y - 1) for xx in range(x, x + w))
    m.shade_cells(shade)

    lawn = _grass_gids() | _dark_grass_gids()
    keep = m.authored_cells()
    clover = (M.mg("clover_a"), M.mg("clover_b"))
    for lm in m.landmarks.values():
        if lm.type != "park":
            continue
        for cy in range(lm.y, lm.y + lm.h):
            for cx in range(lm.x, lm.x + lm.w):
                if m.rng.random() < 0.06 and _open_grass(m, (cx, cy), lawn):
                    if m.placeable(cx, cy, keep):
                        m.set("deco-below", cx, cy, m.rng.choice(clover))
    planter_gids = {M.mg("planter_box")}
    for s in (R.PLANTER_YELLOW, R.PLANTER_PURPLE, R.PLANTER_EMPTY):
        planter_gids.update(g for _, _, g in s.cells())
    planter_gids.update(g for s in M.HEDGE.values() for _, _, g in s.cells())
    mulch = (M.mg("mulch_a"), M.mg("mulch_b"))
    dark = _dark_grass_gids()
    litter = (M.mg("litter_a"), M.mg("litter_b"))
    for cy in range(m.h):
        for cx in range(m.w):
            if (m.get("deco-below", cx, cy) & R.GID_MASK) in planter_gids:
                if m.get("ground-detail", cx, cy) == 0 and (cx, cy) not in m.road_mask:
                    m.set("ground-detail", cx, cy, m.rng.choice(mulch))
            elif m.get("ground-detail", cx, cy) in dark and m.rng.random() < 0.04:
                if m.placeable(cx, cy, keep):
                    m.set("deco-below", cx, cy, m.rng.choice(litter))


def _nearest_pavement(
    m: MapCanvas, start: tuple[int, int], lawn: set[int], pavement: set[int], limit: int
) -> tuple[tuple[int, int], int] | None:
    """Breadth-first over open grass from ``start`` to the closest pavement
    cell within ``limit`` steps: ``(cell, steps)`` or None."""
    seen = {start}
    frontier = [start]
    for d in range(1, limit + 1):
        nxt: list[tuple[int, int]] = []
        for x, y in frontier:
            for c in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if c in seen or not m.inb(*c):
                    continue
                seen.add(c)
                if m.get("ground-detail", *c) in pavement and c not in m.road_mask:
                    return c, d
                if _open_grass(m, c, lawn) and not m.collided((c[0] + 0.5) * T, (c[1] + 0.5) * T):
                    nxt.append(c)
        frontier = nxt
        if not frontier:
            break
    return None


def emit_ground_wear(m: MapCanvas) -> None:
    """Post-pass: desire lines. From every dwelling's doorstep to the nearest
    sidewalk or path when two to six cells of grass separate them (a house
    whose walk is already poured gets none), and one diagonal across every
    park between its two farthest entrances (pavement cells on the park's
    rim)."""
    m.flush_markings()
    lawn = _grass_gids() | _dark_grass_gids()
    pavement = _pavement_gids()
    for home in m.homes:
        dx = home.get("door_x", home["x"] + (home["w"] - 2) // 2)
        start = (dx, home["y"] + home["h"])
        if not m.inb(*start):
            continue
        if m.get("ground-detail", *start) in pavement:
            start = (dx, start[1] + 1)  # step off a porch deck
        if not m.inb(*start) or m.get("ground-detail", *start) in pavement:
            continue
        if not _open_grass(m, start, lawn) or m.on_street(*start):
            continue
        hit = _nearest_pavement(m, start, lawn, pavement, 6)
        if hit and 2 <= hit[1] <= 6:
            desire_path(m, start, hit[0])
    for lm in m.landmarks.values():
        if lm.type != "park":
            continue
        rim = [
            (cx, cy)
            for cy in range(lm.y - 1, lm.y + lm.h + 1)
            for cx in range(lm.x - 1, lm.x + lm.w + 1)
            if (cx in (lm.x - 1, lm.x + lm.w) or cy in (lm.y - 1, lm.y + lm.h))
            and m.inb(cx, cy)
            and m.get("ground-detail", cx, cy) in pavement
            and (cx, cy) not in m.road_mask
        ]
        if len(rim) < 2:
            continue
        a, b = max(
            ((p, q) for i, p in enumerate(rim) for q in rim[i + 1 :]),
            key=lambda pq: (pq[0][0] - pq[1][0]) ** 2 + (pq[0][1] - pq[1][1]) ** 2,
        )
        desire_path(m, a, b)


#: Big canopies (6x7) with their footprint relative to the anchor cell.
_BIG_TREES = ("tree_light", "tree_dark")
_RING_BAND = 2


def _edge_road_runs(m: MapCanvas, side: str) -> list[tuple[int, int]]:
    """Contiguous runs ``(start, width)`` of road cells along a map edge."""
    if side in ("w", "e"):
        col = 0 if side == "w" else m.w - 1
        line = [(col, a) for a in range(m.h)]
    else:
        row = 0 if side == "n" else m.h - 1
        line = [(a, row) for a in range(m.w)]
    runs: list[tuple[int, int]] = []
    for i, c in enumerate(line):
        if c in m.road_mask:
            if runs and runs[-1][0] + runs[-1][1] == i:
                runs[-1] = (runs[-1][0], runs[-1][1] + 1)
            else:
                runs.append((i, 1))
    return runs


def _exit_gap(m: MapCanvas, side: str, c: int) -> tuple[int, set[tuple[int, int]]]:
    """Road width at a declared exit and the gap cells kept clear of the
    ring: the road plus one sidewalk cell either side, through the band."""
    runs = {start: width for start, width in _edge_road_runs(m, side)}
    if c not in runs:
        raise ValueError(f"declared exit {side}:{c} has no road leaving the map there")
    width = runs[c]
    along = range(c - 1, c + width + 1)
    if side == "w":
        gap = {(b, a) for b in range(_RING_BAND) for a in along}
    elif side == "e":
        gap = {(m.w - 1 - b, a) for b in range(_RING_BAND) for a in along}
    elif side == "n":
        gap = {(a, b) for b in range(_RING_BAND) for a in along}
    else:
        gap = {(a, m.h - 1 - b) for b in range(_RING_BAND) for a in along}
    return width, {g for g in gap if m.inb(*g)}


def _exit_sign_spots(m: MapCanvas, side: str, c: int, width: int) -> list[tuple[int, int]]:
    """Post cells to try for an exit's destination sign, nearest the edge
    first: two cells inside the map on the outbound driver's right (the
    sidewalk when the sign's face can hang over the verge behind it, else
    the verge behind that sidewalk), then the other side, then one cell
    further in, up to four cells deep."""
    spots: list[tuple[int, int]] = []
    right, left = c + width, c - 1  # the two sidewalks flanking the road
    for lanes in ((right, left), (right + 1, left - 1)):  # then the verges beyond
        for depth in range(_RING_BAND, _RING_BAND + 4):
            a, b = lanes
            if side == "w":
                spots += [(depth, b), (depth, a + 1)]
            elif side == "e":
                spots += [(m.w - 1 - depth, a + 1), (m.w - 1 - depth, b)]
            elif side == "n":
                spots += [(a, depth), (b, depth)]
            else:
                spots += [(b, m.h - 1 - depth), (a, m.h - 1 - depth)]
    return spots


def emit_edge_ring(m: MapCanvas, exits: list[tuple[str, int, str]]) -> None:
    """Close the map with woods: a two-cell canopy band inside the border.

    ``exits`` lists every road that leaves the map as ``(side, c, text)``
    — ``side`` n/s/e/w, ``c`` the road segment's first row / column, and
    the destination the sign reads (``"TO RT 46"``). Each exit keeps a gap
    through the band (the road plus its sidewalks) and gets a blank green
    ``EXIT_SIGN`` on the outbound driver's right with a ``roadsign`` anchor
    carrying ``text``. A declared exit without a road, or an edge road
    without a declaration, is an error.

    Ground: the band's open grass becomes ``GRASS_DARK`` (``shade_cells``
    keeps the outer edge seamless). Trees: every two cells along
    each edge — small round trees along the top (their two-row canopies
    fit the band), full canopies elsewhere wherever the canopy's footprint
    hides nothing (else a small tree), plus a big tree every eight cells
    along the top where the ground behind it is open — skipping the gaps,
    roads, rails, water, reserved cells, existing props and existing trees.
    """
    keep = m.authored_cells()
    gaps: set[tuple[int, int]] = set()
    declared: dict[str, set[int]] = {"n": set(), "s": set(), "e": set(), "w": set()}
    signs: list[tuple[str, int, int, str]] = []
    for side, c, text in exits:
        width, gap = _exit_gap(m, side, c)
        gaps |= gap
        declared[side].add(c)
        signs.append((side, c, width, text))
    for side, runs in ((s, _edge_road_runs(m, s)) for s in ("n", "s", "e", "w")):
        for start, _width in runs:
            if start not in declared[side]:
                raise ValueError(
                    f"road leaves the map at {side}:{start} but no EXITS entry names it"
                )
    m.exit_gaps |= gaps

    lawn = _grass_gids() | _dark_grass_gids()
    band = {
        (x, y)
        for y in range(m.h)
        for x in range(m.w)
        if x < _RING_BAND or y < _RING_BAND or x >= m.w - _RING_BAND or y >= m.h - _RING_BAND
    }
    m.shade_cells({c for c in band if c not in gaps and _open_grass(m, c, lawn)})

    existing = set(_tree_cells(m))

    def near_tree(x: int, y: int) -> bool:
        return any(abs(tx - x) <= 1 and abs(ty - y) <= 1 for tx, ty in existing)

    def anchor_ok(x: int, y: int) -> bool:
        return (
            (x, y) not in gaps
            and m.placeable(x, y, keep, street_only=False)
            and _open_grass(m, (x, y), lawn)
            and not near_tree(x, y)
        )

    def canopy_ok(x: int, y: int, stamp: TileStamp) -> bool:
        """The stamp's footprint (bottom-centre on (x, y)) hides nothing."""
        x0, y0 = x - stamp.w // 2, y - stamp.h + 1
        for yy in range(max(0, y0), min(m.h, y0 + stamp.h)):
            for xx in range(max(0, x0), min(m.w, x0 + stamp.w)):
                c = (xx, yy)
                if c in gaps or c in m.road_mask or c in m.reserved or c in keep:
                    return False
                if m.get("deco-below", xx, yy) or m.get("buildings-base", xx, yy):
                    return False
                if m.get("buildings-top", xx, yy):
                    return False
        return True

    def plant(x: int, y: int, big_first: bool) -> None:
        if not anchor_ok(x, y):
            return
        if big_first:
            stamp = m.rng.choice(_BIG_TREES)
            if canopy_ok(x, y, R.STAMPS[stamp]):
                m.tree(x, y, stamp=stamp)
                existing.add((x, y))
                return
        m.tree(x, y, stamp="tree_round_small")
        existing.add((x, y))

    # top: a neat small-tree line, a big tree every eight cells behind it
    for x in range(1, m.w, 2):
        plant(x, 1, big_first=False)
    for x in range(4, m.w - 2, 8):
        if anchor_ok(x, 5) and canopy_ok(x, 5, R.TREE_LIGHT):
            stamp = m.rng.choice(_BIG_TREES)
            m.tree(x, 5, stamp=stamp)
            existing.add((x, 5))
    # bottom and sides: full canopies where they hide nothing
    for i, x in enumerate(range(1, m.w, 2)):
        plant(x, m.h - 1, big_first=i % 2 == 0)
    for i, y in enumerate(range(3, m.h - 2, 2)):
        plant(1, y, big_first=i % 2 == 0)
        plant(m.w - 2, y, big_first=i % 2 == 1)

    for side, c, width, text in signs:
        for sx, sy in _exit_sign_spots(m, side, c, width):
            if road_sign(m, sx, sy, text):
                break
        else:
            print(f"  ! no room for the {side}:{c} exit sign ({text!r})")


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
    m.spot_cells = set(placer.taken)


# ---------------------------------------------------------------------------
# generic landmark interpreter (fallback when no layout module exists)
# ---------------------------------------------------------------------------


def emit_traffic(m: MapCanvas) -> None:
    """Derive the ``traffic`` object layer from the road network.

    Right-hand traffic: every street gets one lane per direction on its
    outer tile row/column (a 2x1 car sprite then sits on whole tiles), as a
    polyline from one end of the segment to the other in driving order.
    ``through`` marks lanes whose ends touch the map edge — cars enter and
    leave the world on those. A stop line sits 2 px before every crosswalk
    band a lane crosses; it is ``signal``-governed when a ``signal`` anchor
    stands within two tiles of that junction. Coordinates are world px.
    """
    m.traffic = []
    signal_pts = [(a["x"] / T, a["y"] / T) for a in m.anchors if a["props"].get("kind") == "signal"]

    def signalled(j: tuple[int, int, int, int]) -> bool:
        jx0, jy0, jx1, jy1 = j
        return any(jx0 - 2 <= sx <= jx1 + 3 and jy0 - 2 <= sy <= jy1 + 3 for sx, sy in signal_pts)

    bands = m.crosswalk_bands()
    for seg in m.road_segs:
        first = seg.c  # outer row/column on the near side
        last = seg.c + seg.width - 1
        # driving directions: h-road east on the south row, west on the north
        # row; v-road south on the west column, north on the east column
        lanes = [("e", last), ("w", first)] if seg.orient == "h" else [("s", first), ("n", last)]
        a_lo, a_hi = seg.a0 * T, (seg.a1 + 1) * T
        for d, row in lanes:
            centre = (row + 0.5) * T
            if seg.orient == "h":
                pts = [(a_lo, centre), (a_hi, centre)]
            else:
                pts = [(centre, a_lo), (centre, a_hi)]
            if d in ("w", "n"):
                pts.reverse()
            through = a_lo <= T and a_hi >= (m.w if seg.orient == "h" else m.h) * T - T
            m.traffic.append(
                {
                    "kind": "lane",
                    "dir": d,
                    "road": f"{seg.orient}{seg.c}",
                    "through": through,
                    "points": pts,
                }
            )
            # stop lines: the crosswalk bands this lane drives through
            for j, side, band in bands:
                if seg.orient == "h" and side in ("w", "e"):
                    bx = band[0][0]
                    if not (seg.a0 <= bx <= seg.a1) or not (j[1] <= row <= j[3]):
                        continue
                    # eastbound stops before the west band, westbound before the east band
                    if d == "e" and side == "w":
                        x = bx * T - 2
                    elif d == "w" and side == "e":
                        x = (bx + 1) * T + 2
                    else:
                        continue
                    m.traffic.append(
                        {
                            "kind": "stopline",
                            "axis": "h",
                            "dir": d,
                            "x": x,
                            "y": centre,
                            "signal": signalled(j),
                        }
                    )
                elif seg.orient == "v" and side in ("n", "s"):
                    by = band[0][1]
                    if not (seg.a0 <= by <= seg.a1) or not (j[0] <= row <= j[2]):
                        continue
                    if d == "s" and side == "n":
                        y = by * T - 2
                    elif d == "n" and side == "s":
                        y = (by + 1) * T + 2
                    else:
                        continue
                    m.traffic.append(
                        {
                            "kind": "stopline",
                            "axis": "v",
                            "dir": d,
                            "x": centre,
                            "y": y,
                            "signal": signalled(j),
                        }
                    )


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
    tobjs = []
    for t in m.traffic:
        if t["kind"] == "lane":
            (x0, y0), *rest = t["points"]
            tobjs.append(
                {
                    "id": oid,
                    "name": t["road"],
                    "type": "",
                    "rotation": 0,
                    "visible": True,
                    "x": round(x0, 1),
                    "y": round(y0, 1),
                    "width": 0,
                    "height": 0,
                    "polyline": [{"x": 0, "y": 0}]
                    + [{"x": round(px - x0, 1), "y": round(py - y0, 1)} for px, py in rest],
                    "properties": [
                        {"name": "kind", "type": "string", "value": "lane"},
                        {"name": "dir", "type": "string", "value": t["dir"]},
                        {"name": "road", "type": "string", "value": t["road"]},
                        {
                            "name": "through",
                            "type": "string",
                            "value": "1" if t["through"] else "0",
                        },
                    ],
                }
            )
        else:
            tobjs.append(
                {
                    "id": oid,
                    "name": "",
                    "type": "",
                    "rotation": 0,
                    "point": True,
                    "visible": True,
                    "x": round(t["x"], 1),
                    "y": round(t["y"], 1),
                    "width": 0,
                    "height": 0,
                    "properties": [
                        {"name": "kind", "type": "string", "value": "stopline"},
                        {"name": "axis", "type": "string", "value": t["axis"]},
                        {"name": "dir", "type": "string", "value": t["dir"]},
                        {"name": "signal", "type": "string", "value": "1" if t["signal"] else "0"},
                    ],
                }
            )
        oid += 1
    layers.append(
        {
            "id": lid,
            "name": "traffic",
            "type": "objectgroup",
            "visible": False,
            "opacity": 1,
            "x": 0,
            "y": 0,
            "draworder": "topdown",
            "objects": tobjs,
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
    m.flush_markings()
    emit_civic_anchors(m)
    emit_spot_anchors(m)
    emit_building_shadows(m)
    emit_traffic(m)
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
