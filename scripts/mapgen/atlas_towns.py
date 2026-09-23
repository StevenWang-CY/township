#!/usr/bin/env python3
"""Mini-towns for the District Atlas overworld.

Each scenario town gets a 12x10-tile *pad* on the overworld canvas with a
real signature block composed from the same recipes the town maps use
(``storefront`` / ``grand`` / ``cottage`` / ``diner`` from ``build_maps``,
the ``township-modern`` street kit, the rpg prop stamps). Every pad shares
one frame so the atlas reads as a district of towns rather than a set of
icons:

    rows 0-5   building zone (six rows: every recipe's minimum height)
    row  6     north sidewalk  (part of the walk loop)
    rows 7-8   the 2-wide asphalt main street
    row  9     south sidewalk  (part of the walk loop)

The main street leaves the pad on its *connector* side and, when the
scenario has a highway, bends into a 2-wide asphalt leg that meets it; the
opposite end is the *gate* the tan district roads start from. The town's
set-piece is composed at minimum sizes inside the building zone, and
ground-detail dressing (rails, parking stalls, a zebra) is laid after the
road network is painted so it sits on top of the sidewalk ring.

``overworld.py`` drives this module in two phases per town — ``plan`` (road
masks, paving, reservations: everything ``MapCanvas.paint_roads`` must know
about) and ``dress`` (buildings, props, ground overrides). Unknown scenarios
or towns fall back to a generic pad: two cottages, a shop and a tree.
"""

from __future__ import annotations

import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mapgen import moderntiles as M  # noqa: E402
from mapgen import tiles as R  # noqa: E402
from mapgen.build_maps import (  # noqa: E402
    MapCanvas,
    bench,
    cottage,
    diner,
    grand,
    storefront,
)

T = 16
PAD_W, PAD_H = 12, 10
#: pad-relative rows of the shared frame
NORTH_WALK, STREET_TOP, STREET_BOTTOM, SOUTH_WALK = 6, 7, 8, 9
#: how far the asphalt main street runs past the pad on each side
STUB = 2


@dataclass(frozen=True)
class Pad:
    """A town's tile rectangle on the overworld (top-left + size)."""

    x: int
    y: int
    w: int = PAD_W
    h: int = PAD_H

    @property
    def x1(self) -> int:  # exclusive
        return self.x + self.w

    @property
    def y1(self) -> int:  # exclusive
        return self.y + self.h

    @property
    def street_rows(self) -> tuple[int, int]:
        return self.y + STREET_TOP, self.y + STREET_BOTTOM

    def cells(self, margin: int = 0) -> set[tuple[int, int]]:
        return {
            (xx, yy)
            for xx in range(self.x - margin, self.x1 + margin)
            for yy in range(self.y - margin, self.y1 + margin)
        }

    def as_dict(self) -> dict[str, int]:
        return {"x": self.x, "y": self.y, "w": self.w, "h": self.h}


def walk_loop(pad: Pad) -> list[list[int]]:
    """The residents' stroll: a closed loop along both sidewalks of the
    main street, in overworld PIXELS (tile centres), clockwise from the
    north-west corner. The frontend feeds it to ``offset-path``."""

    def px(tx: int) -> int:
        return tx * T + T // 2

    x0, x1 = pad.x + 1, pad.x + pad.w - 2
    north, south = pad.y + NORTH_WALK, pad.y + SOUTH_WALK
    return [
        [px(x0), px(north)],
        [px(x1), px(north)],
        [px(x1), px(south)],
        [px(x0), px(south)],
        [px(x0), px(north)],
    ]


def gate(pad: Pad, side: str) -> tuple[float, float]:
    """Where the tan district road meets the main street's free end (the
    side opposite the connector), in TILE coordinates."""
    y = pad.y + STREET_TOP + 0.5
    if side == "w":
        return (pad.x - STUB - 0.5, y)
    return (pad.x1 + STUB - 0.5, y)


# ---------------------------------------------------------------------------
# shared frame
# ---------------------------------------------------------------------------


def plan_frame(o: Any, pad: Pad, connector: str) -> None:
    """Street + connector masks for one pad, before ``paint_roads``.

    ``connector`` is the side ("w" / "e") whose street end bends into the
    asphalt leg toward the highway; the other end is the gate. Both ends run
    ``STUB`` tiles past the pad and the cell beyond each is reserved so the
    sidewalk ring never caps an open road end."""
    m: MapCanvas = o.m
    top = pad.y + STREET_TOP
    m.road_h(top, pad.x - STUB, pad.x1 + STUB - 1, width=2)
    for x in (pad.x - STUB - 1, pad.x1 + STUB):
        m.reserve(x, top, 1, 2)
    hw = getattr(o, "hw_center", None) or {}
    if not hw:
        return
    leg_x = pad.x1 + STUB - 2 if connector == "e" else pad.x - STUB
    target = hw.get(leg_x) or hw.get(leg_x + 1)
    if target is None:
        return
    lo, hi = min(top, target), max(top + 1, target)
    m.road_v(leg_x, lo, hi, width=2)
    # the leg's own end is swallowed by the highway band, but keep the cell
    # past the street stub clear on the connector side too
    o.keepout.update((leg_x + dx, yy) for dx in (-1, 0, 1, 2) for yy in range(lo - 1, hi + 2))


# ---------------------------------------------------------------------------
# signatures (dress phase: after paint_roads)
# ---------------------------------------------------------------------------


def _prop(m: MapCanvas, name: str, x: int, y: int) -> None:
    m.set("deco-below", x, y, M.mg(name))


def _stalls(m: MapCanvas, cells: tuple[tuple[int, int], ...]) -> None:
    for x, y in cells:
        m.set("ground-detail", x, y, M.mg("parking_stall"))


def sig_dover(o: Any, pad: Pad, phase: str) -> None:
    """Dover: NJ Transit — a stone station house with a rail stub running
    along the back of the pad, a bodega beside it, a bus at the kerb."""
    m: MapCanvas = o.m
    x, y = pad.x, pad.y
    track = [xx for xx in range(x - 3, x + pad.w + 3) if m.inb(xx, y)]
    if phase == "plan":
        # ballast along the back wall, running past both pad edges
        for xx in track:
            m.set("ground-detail", xx, y, m.rng.choice(R.GRAVEL.fill))
            o.keepout.update(((xx, y), (xx, y - 1)))
        return
    for xx in track:
        m.set("ground-detail", xx, y, M.mg("rail_h"))
    storefront(m, x, y + 1, 7, 5, facade="stone_gray", roof="stone", sign=3, chimney=False)
    storefront(m, x + 8, y + 1, 4, 5, facade="brick", roof="terracotta", awning=True, chimney=False)
    m.stamp("deco-below", M.BUS_SIGN, x + 7, y + 5)
    m.stamp("deco-below", M.BUS_H, x + 1, y + STREET_BOTTOM)
    bench(m, x + 9, y + SOUTH_WALK)
    _prop(m, "trash_bin", x + 6, y + NORTH_WALK)
    _prop(m, "hydrant", x + 2, y + SOUTH_WALK)


def sig_montclair(o: Any, pad: Pad, phase: str) -> None:
    """Montclair: the Art Museum's banners over a fountain plaza."""
    m: MapCanvas = o.m
    x, y = pad.x, pad.y
    if phase == "plan":
        m.pave(x + 8, y + 2, 4, 4)  # plaza, poured with the sidewalks
        return
    grand(m, x, y, 8, 6, facade="stone_gray", roof="stone", banners=True)
    m.stamp("deco-below", M.FOUNTAIN, x + 9, y + 3)
    for px_, py_ in ((x + 8, y + 2), (x + 11, y + 2), (x + 8, y + 5), (x + 11, y + 5)):
        _prop(m, "planter_box", px_, py_)
    for hx in range(x + 8, x + 12):
        m.stamp("deco-below", M.HEDGE["h"], hx, y + 1)
    o.place(R.TREE_ROUND_SMALL, x + 9, y - 1)
    _prop(m, "trash_bin", x + 7, y + NORTH_WALK)
    _prop(m, "mailbox", x + 1, y + SOUTH_WALK)
    bench(m, x + 10, y + SOUTH_WALK)


def sig_parsippany(o: Any, pad: Pad, phase: str) -> None:
    """Parsippany-Troy Hills: a corporate campus block with its parking lot
    beside the lake lobe that laps the pad's north-east corner."""
    m: MapCanvas = o.m
    x, y = pad.x, pad.y
    if phase == "plan":
        lot = {(xx, yy) for xx in range(x + 7, x + 10) for yy in range(y + 3, y + 6)}
        lot.add((x + 8, y + NORTH_WALK))  # driveway mouth through the kerb
        m.road_mask |= lot
        return
    grand(m, x, y, 7, 6, facade="stone_large", door="metal")
    m.stamp("buildings-base", M.WINDOW, x + 1, y + 1)
    m.stamp("buildings-base", M.WINDOW, x + 4, y + 1)
    _stalls(m, ((x + 7, y + 3), (x + 9, y + 3)))
    _prop(m, "bollard", x + 7, y + NORTH_WALK)
    _prop(m, "bollard", x + 9, y + NORTH_WALK)
    bench(m, x + 8, y + 1)
    m.stamp("deco-below", R.BUSH_ROUND, x + 7, y + 0)
    _prop(m, "trash_bin", x + 3, y + SOUTH_WALK)


def sig_randolph(o: Any, pad: Pad, phase: str) -> None:
    """Randolph: the chrome diner, its terrace and the crop rows next door."""
    m: MapCanvas = o.m
    x, y = pad.x, pad.y
    if phase == "plan":
        return
    diner(m, x, y, 6, 6)
    m.stamp("deco-below", R.MENU_BOARD, x + 6, y + 1)
    m.stamp("deco-below", R.STOOL, x + 6, y + 3)
    field = {(xx, yy) for xx in range(x + 8, x + 12) for yy in range(y, y + 5)}
    m.blob("ground-detail", field, R.FIELD_TILLED, holes=False)
    for yy in range(y + 1, y + 4):
        for xx in range(x + 8, x + 12):
            m.set("deco-below", xx, yy, m.rng.choice(R.CROP_TILES))
    m.stamp("deco-below", R.POST_WOOD_A, x + 8, y + 5)
    m.stamp("deco-below", R.BUCKET, x + 10, y + 4)
    _stalls(m, ((x + 1, y + STREET_TOP), (x + 3, y + STREET_TOP)))
    _prop(m, "hydrant", x + 5, y + SOUTH_WALK)
    _prop(m, "mailbox", x + 9, y + NORTH_WALK)


def sig_harlow(o: Any, pad: Pad, phase: str) -> None:
    """Harlow Crossing: the Route 9 strip with a zebra set mid-block."""
    m: MapCanvas = o.m
    x, y = pad.x, pad.y
    if phase == "plan":
        return
    storefront(m, x, y, 4, 6, facade="brick", roof="slate", sign=0, chimney=False)
    storefront(m, x + 4, y, 4, 6, facade="cream", roof="cedar", awning=True, chimney=False)
    storefront(m, x + 8, y, 4, 6, facade="stone_small", roof="stone", window=False, chimney=False)
    for yy in (y + STREET_TOP, y + STREET_BOTTOM):
        m.set("ground-detail", x + 6, yy, M.mg("crosswalk_h"))
    _stalls(
        m, ((x + 1, y + STREET_BOTTOM), (x + 3, y + STREET_BOTTOM), (x + 10, y + STREET_BOTTOM))
    )
    m.stamp("deco-below", M.CAR_H["red"], x + 8, y + STREET_BOTTOM)
    _prop(m, "newsbox", x + 3, y + NORTH_WALK)
    _prop(m, "trash_bin", x + 9, y + NORTH_WALK)
    _prop(m, "mailbox", x + 1, y + SOUTH_WALK)
    m.stamp("deco-below", M.STOP_SIGN, x + 11, y + SOUTH_WALK - 1)


def sig_millbrook(o: Any, pad: Pad, phase: str) -> None:
    """Millbrook Village: the brick mill on the Stillwater's bank (stack,
    weir across the river) and a colonial at the other end of Main Street."""
    m: MapCanvas = o.m
    x, y = pad.x, pad.y
    if phase == "plan":
        return
    cottage(m, x, y, 6, 6, roof="cedar")
    storefront(m, x + 7, y, 5, 6, facade="brick", roof="slate", window=False, sign=None)
    # smokestack rising off the mill's east gable
    for r in range(3):
        m.set("buildings-top", x + 11, y - 2 + r, R.FACADE_BRICK.gids[2 + r][0])
    # the weir: a stone course across the river beside the mill
    weir_rows = (y + 2, y + 3)
    for wx, wy in sorted(o.water):
        if wy in weir_rows and x + pad.w <= wx <= x + pad.w + 7:
            m.set("ground-detail", wx, wy, m.rng.choice(R.WALL_ROUGH_FILL))
    m.stamp("deco-below", R.BARREL, x + 6, y + 4)
    m.stamp("deco-below", R.CRATE, x + 6, y + 2)
    _prop(m, "mailbox", x + 6, y + SOUTH_WALK)
    bench(m, x + 3, y + SOUTH_WALK)


def sig_generic(o: Any, pad: Pad, phase: str) -> None:
    """Any town without a signature: two cottages, a shop and a tree."""
    m: MapCanvas = o.m
    x, y = pad.x, pad.y
    if phase == "plan":
        return
    cottage(m, x, y, 5, 6)
    storefront(m, x + 6, y, 5, 6, facade="cream", awning=True, chimney=False)
    o.place(R.TREE_ROUND_SMALL, x + 11, y + 4)
    bench(m, x + 5, y + SOUTH_WALK)
    _prop(m, "mailbox", x + 5, y + NORTH_WALK)


Signature = Callable[[Any, Pad, str], None]

SIGNATURES: dict[str, dict[str, Signature]] = {
    "nj11-2026": {
        "dover": sig_dover,
        "montclair": sig_montclair,
        "parsippany": sig_parsippany,
        "randolph": sig_randolph,
    },
    "millbrook-budget": {
        "harlow-crossing": sig_harlow,
        "millbrook-village": sig_millbrook,
    },
}


def signature_for(scenario: str, town_id: str) -> Signature:
    return SIGNATURES.get(scenario, {}).get(town_id, sig_generic)


def plan_town(o: Any, scenario: str, town_id: str, pad: Pad, connector: str) -> None:
    """Phase 1 (before ``paint_roads``): the frame plus anything the town
    needs in the road/pave masks."""
    plan_frame(o, pad, connector)
    signature_for(scenario, town_id)(o, pad, "plan")


def dress_town(o: Any, scenario: str, town_id: str, pad: Pad) -> None:
    """Phase 2 (after ``paint_roads``): buildings, props, ground overrides."""
    signature_for(scenario, town_id)(o, pad, "dress")
