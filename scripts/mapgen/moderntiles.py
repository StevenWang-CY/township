#!/usr/bin/env python3
"""Generate the ``township-modern`` tileset (contemporary street furniture).

Renders ``frontend/public/assets/tilesets/township-modern.png`` — a 16 px
tileset that extends the vendored ai-town RPG tileset with the modern
material it lacks: asphalt, concrete sidewalk, road markings, small-town
street props (hydrant, mailbox, bus sign, ...), the roof / diner / church /
civic kits, and — rows 17-29 — building shadows, ground litter, the
``GRASS_DARK`` and ``WORN`` ground autotiles, vehicles, a hedge kit, the
street-furniture kit (poles, wires, signals, signs), a suburb kit (steps,
garage door, shed) and the shelter / backstop / fountain / exit-sign
set-pieces.

Style contract: every opaque pixel is quantized to the nearest color that
actually occurs in ``rpg-tileset.png`` (sampled at generation time), and all
shapes carry the same 1 px darker outline the source tileset uses, so the two
sheets sit next to each other without a style clash. The one exception is
``GRASS_DARK`` (``NO_QUANTIZE``): its pixels are the sampled ``R.GRASS``
pixels darkened and cooled, and re-snapping them would collapse the patch
back onto the plain grass greens.

Grid: 10 columns, 16 px tiles. In Tiled maps this tileset is appended with
``firstgid = 10001``; all the ``Blob`` / ``TileStamp`` objects exported here
already carry absolute GIDs in that range. Ids 0-169 are frozen: the shipped
maps reference them and ``tests/test_tilekit.py`` pins their pixels to the
committed sheet.

Run:
    python3 -m scripts.mapgen.moderntiles      # writes the png + contact sheet
"""

from __future__ import annotations

import hashlib
import math
import random
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mapgen.tiles import Blob, TileStamp  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_IMAGE = REPO_ROOT / "frontend/public/assets/tilesets/township-modern.png"
SHEET_PATH = Path(__file__).resolve().parent / "_inspect" / "modern_sheet.png"
RPG_TILESET = REPO_ROOT / "frontend/public/assets/tilesets/rpg-tileset.png"


def _stable_seed(label: str) -> int:
    """Return the same RNG seed on every Python process and platform."""
    return int.from_bytes(hashlib.sha256(label.encode("utf-8")).digest()[:8], "big")


T = 16
MODERN_FIRSTGID = 10001
MODERN_COLUMNS = 10
MODERN_ROWS = 30
MODERN_TILECOUNT = MODERN_COLUMNS * MODERN_ROWS
MODERN_IMAGE = "frontend/public/assets/tilesets/township-modern.png"

# ---------------------------------------------------------------------------
# Local tile ids (0-based position in this sheet; GID = MODERN_FIRSTGID + id)
# ---------------------------------------------------------------------------
IDS: dict[str, int] = {
    # asphalt
    "asphalt_0": 0,
    "asphalt_1": 1,
    "asphalt_2": 2,
    "asphalt_3": 3,
    "asp_nw": 4,
    "asp_n": 5,
    "asp_ne": 6,
    "asp_w": 7,
    "asp_e": 8,
    "asp_sw": 9,
    "asp_s": 10,
    "asp_se": 11,
    "asp_hole_nw": 12,
    "asp_hole_ne": 13,
    "asp_hole_sw": 14,
    "asp_hole_se": 15,
    # sidewalk (cream concrete, curb-style edges)
    "swk_0": 16,
    "swk_1": 17,
    "swk_2": 18,
    "swk_3": 19,
    "swk_nw": 20,
    "swk_n": 21,
    "swk_ne": 22,
    "swk_w": 23,
    "swk_e": 24,
    "swk_sw": 25,
    "swk_s": 26,
    "swk_se": 27,
    "swk_hole_nw": 28,
    "swk_hole_ne": 29,
    "swk_hole_sw": 30,
    "swk_hole_se": 31,
    # markings (baked onto asphalt)
    "crosswalk_h": 32,  # for a HORIZONTAL road (band runs N-S, bars E-W)
    "crosswalk_v": 33,  # for a VERTICAL road
    "dash_h": 34,
    "dash_v": 35,
    # curb corner overlays (transparent, quarter-arc curb line)
    "curb_nw": 36,
    "curb_ne": 37,
    "curb_sw": 38,
    "curb_se": 39,
    "parking_stall": 40,
    "storm_drain": 41,
    # props (transparent background)
    "hydrant": 42,
    "mailbox": 43,
    "bus_sign_top": 44,
    "trash_bin": 45,
    "planter_box": 46,
    "newsbox": 47,
    "bench_h": 48,
    "bollard": 49,
    # row 5: facade window (transparent bg — safe on any wall), railway
    "win_tl": 50,
    "win_tr": 51,
    "win_bl": 52,
    "win_br": 53,
    "bus_sign_bot": 54,
    "rail_h": 55,  # track on ballast (repeat horizontally)
    "rail_x": 56,  # track embedded in asphalt (level crossing)
}

#: rows 6-8 — pitched shingle-roof kit, one row per colorway. Each row is
#: ridge / slope / eave strips with gable-end (l/r) and tileable middle (m)
#: tiles; ridge caps the top, slope rows repeat vertically, the eave row
#: closes the bottom with an overhang shadow.
SHINGLE_COLORWAYS = ("terracotta", "slate", "cedar")
_SHINGLE_PARTS = ("ridge", "slope", "eave")
for _i, _cw in enumerate(SHINGLE_COLORWAYS):
    for _j, _part in enumerate(_SHINGLE_PARTS):
        for _k, _side in enumerate(("l", "m", "r")):
            IDS[f"shg_{_cw}_{_part}_{_side}"] = 60 + _i * 10 + _j * 3 + _k

#: rows 9-10 — chrome-diner kit (rounded chrome band, DINER signboard, big
#: window band, ribbed stainless walls, glass door) + colonial 2x2 window
#: with slate-blue shutters (drops onto the cream facade).
for _j, _n in enumerate(
    (
        "diner_roof_l",
        "diner_roof_m",
        "diner_roof_r",
        "diner_sign_a",
        "diner_sign_b",
        "diner_trim",
        "diner_win_l",
        "diner_win_m",
        "diner_win_r",
        "diner_wall",
        "diner_door_t",
        "diner_door_b",
        "swin_tl",
        "swin_tr",
        "swin_bl",
        "swin_br",
    )
):
    IDS[_n] = 90 + _j


#: rows 11-14 — church kit. Shared 2-wide slate spire (gold cross finial +
#: flared cap), then per material variant — white clapboard ``cw`` / gray
#: stone ``st`` — a tower shaft (rises through the nave roof), a louvered
#: belfry, wall courses (l/m/r + foundation ``wallb`` course), a 1x2 lancet
#: window, and a 2x2 arched double door.
IDS["ch_spire_l"] = 110
IDS["ch_spire_r"] = 111
CHURCH_VARIANTS = {"clapboard": "cw", "stone": "st"}
_CHURCH_PARTS = (
    "tower_l",
    "tower_r",
    "belfry_l",
    "belfry_r",
    "wall_l",
    "wall_m",
    "wall_r",
    "wallb_l",
    "wallb_m",
    "wallb_r",
    "lan_t",
    "lan_b",
    "door_tl",
    "door_tr",
    "door_bl",
    "door_br",
)
for _i, _v in enumerate(("cw", "st")):
    for _j, _part in enumerate(_CHURCH_PARTS):
        IDS[f"ch_{_v}_{_part}"] = 112 + _i * 16 + _j


#: rows 15-16 — civic kit: the election made visible. A two-tile yard sign
#: (white board over a wooden stake — the board is tinted at runtime with a
#: resident's option color), a 2x2 notice-board kiosk (cedar mini-roof over a
#: cork board the runtime pins headlines to), a VOTE HERE board, a ballot
#: box, stanchion + rope for the polling queue, a plain banner (1x2, tinted
#: at runtime) and a bunting strip, a 1x1 opaque shop window, a chimney
#: stack that sits above a shingle ridge, and an unlit park brazier.
for _j, _n in enumerate(
    (
        "yard_post",
        "yard_board",
        "notice_tl",
        "notice_tr",
        "notice_bl",
        "notice_br",
        "vote_board",
        "ballot_box",
        "stanchion",
        "rope_h",
        "banner_plain_t",
        "banner_plain_b",
        "bunting_h",
        "win_small",
        "chimney",
        "brazier",
    )
):
    IDS[_n] = 150 + _j


#: row 17 — building shadows (translucent SHADOW ink, alpha 64: overlay on
#: deco-below along the south row / east column of a building) and ground
#: litter (clover clusters + fallen leaves on transparency, opaque mulch).
for _j, _n in enumerate(
    (
        "sh_full",
        "sh_fade_n",
        "sh_fade_w",
        "sh_corner",
        "clover_a",
        "clover_b",
        "litter_a",
        "litter_b",
        "mulch_a",
        "mulch_b",
    )
):
    IDS[_n] = 170 + _j

#: rows 18-19 — GRASS_DARK autotile: a cooler, ~12% darker recolour of the
#: sampled R.GRASS pixels with 4 px ordered-dither edges back into plain
#: grass (same piece set as ASPHALT / SIDEWALK, holes included).
_BLOB_PIECES = ("nw", "n", "ne", "w", "e", "sw", "s", "se")
for _i in range(4):
    IDS[f"gd_{_i}"] = 180 + _i
for _j, _piece in enumerate(_BLOB_PIECES):
    IDS[f"gd_{_piece}"] = 184 + _j
for _j, _piece in enumerate(("hole_nw", "hole_ne", "hole_sw", "hole_se")):
    IDS[f"gd_{_piece}"] = 192 + _j

#: rows 19-20 — WORN autotile: trodden tan dirt under sparse grass tufts,
#: dithered edges into R.GRASS; fill x4 + edges + convex corners (no holes).
for _i in range(4):
    IDS[f"worn_{_i}"] = 196 + _i
for _j, _piece in enumerate(_BLOB_PIECES):
    IDS[f"worn_{_piece}"] = 200 + _j

#: rows 21-24 — vehicles (top-down, 1 px K outline, teal glass, 2 px wheel
#: stubs). ``_h`` cars face east (a = front / east tile, b = rear), ``_v``
#: cars face south (a = front / south tile). Buses are 3 tiles: a = front,
#: b = middle, c = rear.
CAR_COLORS = ("red", "blue", "white", "silver", "green")
_vid = 210
for _cw in CAR_COLORS:
    for _n in (f"car_{_cw}_h_a", f"car_{_cw}_h_b", f"car_{_cw}_v_a", f"car_{_cw}_v_b"):
        IDS[_n] = _vid
        _vid += 1
for _n in (
    "pickup_h_a",
    "pickup_h_b",
    "pickup_v_a",
    "pickup_v_b",
    "bus_h_a",
    "bus_h_b",
    "bus_h_c",
    "bus_v_a",
    "bus_v_b",
    "bus_v_c",
    "schoolbus_h_a",
    "schoolbus_h_b",
    "schoolbus_h_c",
):
    IDS[_n] = _vid
    _vid += 1
assert _vid == 243, _vid

#: rows 24-25 — hedge kit: straight runs, end caps and corners of a clipped
#: hedge (LEAF noise, K outline, SE contact shadow).
for _j, _n in enumerate(
    (
        "hedge_h",
        "hedge_v",
        "hedge_end_w",
        "hedge_end_e",
        "hedge_end_n",
        "hedge_end_s",
        "hedge_nw",
        "hedge_ne",
        "hedge_sw",
        "hedge_se",
    )
):
    IDS[_n] = 243 + _j

#: rows 25-26 — street kit: utility pole (2 tall) + wires, traffic signal
#: (2 tall), stop sign / street-name blade over a shared sign post.
for _j, _n in enumerate(
    (
        "pole_top",
        "pole_base",
        "wire_h",
        "wire_v",
        "signal_red",
        "signal_green",
        "signal_pole",
        "stop_top",
        "sign_post",
        "blade_top",
    )
):
    IDS[_n] = 253 + _j

#: rows 26-27 — suburb kit: stone steps, house-number plaque and window AC
#: unit (transparent overlays), a 2x2 panelled garage door (opaque, stone
#: surround like WINDOW) and a 2x2 clapboard shed with a cedar roof.
for _j, _n in enumerate(
    (
        "steps",
        "house_num",
        "ac_window",
        "garage_door_tl",
        "garage_door_tr",
        "garage_door_bl",
        "garage_door_br",
        "shed_tl",
        "shed_tr",
        "shed_bl",
        "shed_br",
    )
):
    IDS[_n] = 263 + _j

#: rows 27-29 — set-pieces: glass bus shelter 3x2, chain-link backstop 3x2,
#: stone fountain 2x2, blank green exit sign 1x2 (the runtime letters it),
#: then two leaning bicycles and a hoop bike rack (292-294; 295-299 free).
for _r in range(2):
    for _c in range(3):
        IDS[f"shelter_{_r}{_c}"] = 274 + _r * 3 + _c
        IDS[f"backstop_{_r}{_c}"] = 280 + _r * 3 + _c
for _j, _n in enumerate(("fountain_tl", "fountain_tr", "fountain_bl", "fountain_br")):
    IDS[_n] = 286 + _j
IDS["exit_sign_t"] = 290
IDS["exit_sign_b"] = 291
IDS["bike_a"] = 292
IDS["bike_b"] = 293
IDS["bike_rack"] = 294

assert len(set(IDS.values())) == len(IDS), "duplicate modern tile id"
assert all(0 <= _i < MODERN_TILECOUNT for _i in IDS.values()), "modern tile id out of range"

#: Ids whose opaque pixels are NOT snapped to the rpg palette (see module doc).
NO_QUANTIZE: frozenset[int] = frozenset(v for k, v in IDS.items() if k.startswith("gd_"))


def mg(name: str) -> int:
    """Absolute GID of a modern tile."""
    return MODERN_FIRSTGID + IDS[name]


# Blob views over the modern sheet, shaped like scripts.mapgen.tiles.Blob so
# the same autotiler drives both tilesets.
ASPHALT = Blob(
    name="asphalt",
    fill=tuple(mg(f"asphalt_{i}") for i in range(4)),
    nw=mg("asp_nw"),
    n=(mg("asp_n"),),
    ne=mg("asp_ne"),
    w=(mg("asp_w"),),
    e=(mg("asp_e"),),
    sw=mg("asp_sw"),
    s=(mg("asp_s"),),
    se=mg("asp_se"),
    hole_nw=mg("asp_hole_nw"),
    hole_ne=mg("asp_hole_ne"),
    hole_sw=mg("asp_hole_sw"),
    hole_se=mg("asp_hole_se"),
)

SIDEWALK = Blob(
    name="sidewalk",
    fill=tuple(mg(f"swk_{i}") for i in range(4)),
    nw=mg("swk_nw"),
    n=(mg("swk_n"),),
    ne=mg("swk_ne"),
    w=(mg("swk_w"),),
    e=(mg("swk_e"),),
    sw=mg("swk_sw"),
    s=(mg("swk_s"),),
    se=mg("swk_se"),
    hole_nw=mg("swk_hole_nw"),
    hole_ne=mg("swk_hole_ne"),
    hole_sw=mg("swk_hole_sw"),
    hole_se=mg("swk_hole_se"),
)

BUS_SIGN = TileStamp("bus_sign", ((mg("bus_sign_top"),), (mg("bus_sign_bot"),)))

#: 2x2 sash window on TRANSPARENT background — unlike the rpg tileset's
#: WINDOW_TEAL (which has grass baked around it), this drops onto any facade.
WINDOW = TileStamp("window_modern", ((mg("win_tl"), mg("win_tr")), (mg("win_bl"), mg("win_br"))))

#: 2x2 colonial sash window with slate-blue shutters, cream surround —
#: fully opaque, designed for the cream clapboard facade.
SHUTTER_WINDOW = TileStamp(
    "window_shutter", ((mg("swin_tl"), mg("swin_tr")), (mg("swin_bl"), mg("swin_br")))
)

#: 1x2 chrome-framed glass diner door.
DINER_DOOR = TileStamp("diner_door", ((mg("diner_door_t"),), (mg("diner_door_b"),)))

#: 2x1 "DINER" letterboard (red panel, chrome edging); flank with
#: ``diner_trim`` tiles to span a wider frontage.
DINER_SIGN = TileStamp("diner_sign", ((mg("diner_sign_a"), mg("diner_sign_b")),))


def shingle_stamp(colorway: str, w: int, h: int) -> TileStamp:
    """Pitched shingle roof, ``w x h`` tiles (both >= 2): ridge row on top,
    tileable slope rows, eave row with an overhang shadow at the bottom;
    gable-end trim closes the left/right edges."""
    if colorway not in SHINGLE_COLORWAYS:
        raise ValueError(f"unknown shingle colorway: {colorway!r}")
    if w < 2 or h < 2:
        raise ValueError("shingle roofs need w >= 2 and h >= 2")

    def row(part: str) -> tuple[int, ...]:
        return (
            mg(f"shg_{colorway}_{part}_l"),
            *([mg(f"shg_{colorway}_{part}_m")] * (w - 2)),
            mg(f"shg_{colorway}_{part}_r"),
        )

    rows = (row("ridge"), *(row("slope") for _ in range(h - 2)), row("eave"))
    return TileStamp(f"shingle_{colorway}_{w}x{h}", rows)


def diner_row(kind: str, w: int) -> tuple[int, ...]:
    """One w-wide course of the diner kit: ``roof`` (rounded chrome band),
    ``sign`` (trim with the DINER board centered), ``window`` (big glass
    band) or ``wall`` (ribbed stainless)."""
    if w < 4:
        raise ValueError("the diner kit needs w >= 4")
    if kind == "roof":
        return (mg("diner_roof_l"), *([mg("diner_roof_m")] * (w - 2)), mg("diner_roof_r"))
    if kind == "window":
        return (mg("diner_win_l"), *([mg("diner_win_m")] * (w - 2)), mg("diner_win_r"))
    if kind == "wall":
        return tuple([mg("diner_wall")] * w)
    if kind == "sign":
        lo = (w - 2) // 2
        row = [mg("diner_trim")] * w
        row[lo] = mg("diner_sign_a")
        row[lo + 1] = mg("diner_sign_b")
        return tuple(row)
    raise ValueError(f"unknown diner course: {kind!r}")


#: Civic kit stamps (see rows 15-16 above).
YARD_SIGN = TileStamp("yard_sign", ((mg("yard_board"),), (mg("yard_post"),)))
VOTE_SIGN = TileStamp("vote_sign", ((mg("vote_board"),), (mg("yard_post"),)))
NOTICE_BOARD = TileStamp(
    "notice_board",
    ((mg("notice_tl"), mg("notice_tr")), (mg("notice_bl"), mg("notice_br"))),
)
BANNER_PLAIN = TileStamp("banner_plain", ((mg("banner_plain_t"),), (mg("banner_plain_b"),)))
SMALL_WINDOW = TileStamp("win_small", ((mg("win_small"),),))
#: Church lancet windows per wall variant (1x2, glass on the wall art).
CH_LANCET = {
    v: TileStamp(f"ch_{v}_lancet", ((mg(f"ch_{v}_lan_t"),), (mg(f"ch_{v}_lan_b"),)))
    for v in CHURCH_VARIANTS.values()
}
#: Diner glass band tiles (each is a 1x1 window for the night-glow pass).
DINER_WINDOWS = tuple(
    TileStamp(n, ((mg(n),),)) for n in ("diner_win_l", "diner_win_m", "diner_win_r")
)

MODERN_SINGLES: dict[str, int] = {
    n: mg(n)
    for n in (
        "crosswalk_h",
        "crosswalk_v",
        "dash_h",
        "dash_v",
        "curb_nw",
        "curb_ne",
        "curb_sw",
        "curb_se",
        "parking_stall",
        "storm_drain",
        "hydrant",
        "mailbox",
        "trash_bin",
        "planter_box",
        "newsbox",
        "bench_h",
        "bollard",
        "rail_h",
        "rail_x",
        "yard_post",
        "yard_board",
        "vote_board",
        "ballot_box",
        "stanchion",
        "rope_h",
        "bunting_h",
        "win_small",
        "chimney",
        "brazier",
        # rows 17-29
        "sh_full",
        "sh_fade_n",
        "sh_fade_w",
        "sh_corner",
        "clover_a",
        "clover_b",
        "litter_a",
        "litter_b",
        "mulch_a",
        "mulch_b",
        "hedge_h",
        "hedge_v",
        "hedge_end_w",
        "hedge_end_e",
        "hedge_end_n",
        "hedge_end_s",
        "hedge_nw",
        "hedge_ne",
        "hedge_sw",
        "hedge_se",
        "wire_h",
        "wire_v",
        "steps",
        "house_num",
        "ac_window",
        "bike_a",
        "bike_b",
        "bike_rack",
    )
}


def _blob(prefix: str, name: str, holes: bool) -> Blob:
    """A modern-sheet autotile from ``{prefix}_{piece}`` ids (ASPHALT layout)."""
    return Blob(
        name=name,
        fill=tuple(mg(f"{prefix}_{i}") for i in range(4)),
        nw=mg(f"{prefix}_nw"),
        n=(mg(f"{prefix}_n"),),
        ne=mg(f"{prefix}_ne"),
        w=(mg(f"{prefix}_w"),),
        e=(mg(f"{prefix}_e"),),
        sw=mg(f"{prefix}_sw"),
        s=(mg(f"{prefix}_s"),),
        se=mg(f"{prefix}_se"),
        hole_nw=mg(f"{prefix}_hole_nw") if holes else 0,
        hole_ne=mg(f"{prefix}_hole_ne") if holes else 0,
        hole_sw=mg(f"{prefix}_hole_sw") if holes else 0,
        hole_se=mg(f"{prefix}_hole_se") if holes else 0,
    )


#: Cooler, darker lawn / tree-shade grass; edges dither back into R.GRASS.
GRASS_DARK = _blob("gd", "grass_dark", holes=True)
#: Trodden dirt (desire lines, dugouts, the worn strip along a fence).
WORN = _blob("worn", "worn", holes=False)

#: Vehicles. ``CAR_H[color]`` is 2x1 facing east (rear tile, front tile);
#: ``CAR_V[color]`` is 1x2 facing south (rear on top). Buses likewise.
CAR_H = {
    c: TileStamp(f"car_{c}_h", ((mg(f"car_{c}_h_b"), mg(f"car_{c}_h_a")),)) for c in CAR_COLORS
}
CAR_V = {
    c: TileStamp(f"car_{c}_v", ((mg(f"car_{c}_v_b"),), (mg(f"car_{c}_v_a"),))) for c in CAR_COLORS
}
PICKUP_H = TileStamp("pickup_h", ((mg("pickup_h_b"), mg("pickup_h_a")),))
PICKUP_V = TileStamp("pickup_v", ((mg("pickup_v_b"),), (mg("pickup_v_a"),)))
BUS_H = TileStamp("bus_h", ((mg("bus_h_c"), mg("bus_h_b"), mg("bus_h_a")),))
BUS_V = TileStamp("bus_v", ((mg("bus_v_c"),), (mg("bus_v_b"),), (mg("bus_v_a"),)))
SCHOOLBUS_H = TileStamp(
    "schoolbus_h", ((mg("schoolbus_h_c"), mg("schoolbus_h_b"), mg("schoolbus_h_a")),)
)
BIKE_RACK = TileStamp("bike_rack", ((mg("bike_rack"),),))

#: Hedge line pieces, keyed like R.FENCE_WOOD so a layout can draw a run:
#: ``h`` / ``v`` straight runs, ``end_*`` caps (the hedge continues AWAY from
#: the named side: ``end_w`` is the west cap of an eastward run), and outer
#: ``corner_*`` L-pieces (``corner_nw`` joins a run going east and one going
#: south). Every piece is a 1x1 stamp.
HEDGE = {
    "h": TileStamp("hedge_h", ((mg("hedge_h"),),)),
    "v": TileStamp("hedge_v", ((mg("hedge_v"),),)),
    "end_w": TileStamp("hedge_end_w", ((mg("hedge_end_w"),),)),
    "end_e": TileStamp("hedge_end_e", ((mg("hedge_end_e"),),)),
    "end_n": TileStamp("hedge_end_n", ((mg("hedge_end_n"),),)),
    "end_s": TileStamp("hedge_end_s", ((mg("hedge_end_s"),),)),
    "corner_nw": TileStamp("hedge_nw", ((mg("hedge_nw"),),)),
    "corner_ne": TileStamp("hedge_ne", ((mg("hedge_ne"),),)),
    "corner_sw": TileStamp("hedge_sw", ((mg("hedge_sw"),),)),
    "corner_se": TileStamp("hedge_se", ((mg("hedge_se"),),)),
}

#: Street kit (all 1x2, post at the bottom).
POLE = TileStamp("pole", ((mg("pole_top"),), (mg("pole_base"),)))
SIGNAL = TileStamp("signal", ((mg("signal_red"),), (mg("signal_pole"),)))
SIGNAL_GREEN = TileStamp("signal_green", ((mg("signal_green"),), (mg("signal_pole"),)))
STOP_SIGN = TileStamp("stop_sign", ((mg("stop_top"),), (mg("sign_post"),)))
STREET_BLADE = TileStamp("street_blade", ((mg("blade_top"),), (mg("sign_post"),)))

#: Suburb kit.
GARAGE_DOOR = TileStamp(
    "garage_door",
    ((mg("garage_door_tl"), mg("garage_door_tr")), (mg("garage_door_bl"), mg("garage_door_br"))),
)
SHED = TileStamp("shed", ((mg("shed_tl"), mg("shed_tr")), (mg("shed_bl"), mg("shed_br"))))

#: Set-pieces.
SHELTER = TileStamp(
    "shelter", tuple(tuple(mg(f"shelter_{r}{c}") for c in range(3)) for r in range(2))
)
BACKSTOP = TileStamp(
    "backstop", tuple(tuple(mg(f"backstop_{r}{c}") for c in range(3)) for r in range(2))
)
FOUNTAIN = TileStamp(
    "fountain",
    ((mg("fountain_tl"), mg("fountain_tr")), (mg("fountain_bl"), mg("fountain_br"))),
)
EXIT_SIGN = TileStamp("exit_sign", ((mg("exit_sign_t"),), (mg("exit_sign_b"),)))

#: Every multi-tile stamp of rows 17-29, by export name (the exporters and
#: the contact sheet iterate this).
KIT_STAMPS: dict[str, TileStamp] = {
    **{f"car_{c}_h": s for c, s in CAR_H.items()},
    **{f"car_{c}_v": s for c, s in CAR_V.items()},
    "pickup_h": PICKUP_H,
    "pickup_v": PICKUP_V,
    "bus_h": BUS_H,
    "bus_v": BUS_V,
    "schoolbus_h": SCHOOLBUS_H,
    "bike_rack": BIKE_RACK,
    "pole": POLE,
    "signal": SIGNAL,
    "signal_green": SIGNAL_GREEN,
    "stop_sign": STOP_SIGN,
    "street_blade": STREET_BLADE,
    "garage_door": GARAGE_DOOR,
    "shed": SHED,
    "shelter": SHELTER,
    "backstop": BACKSTOP,
    "fountain": FOUNTAIN,
    "exit_sign": EXIT_SIGN,
    **{f"hedge_{k}": s for k, s in HEDGE.items()},
}


def tileset_json_entry() -> dict:
    """The Tiled tilesets[] entry for this sheet (firstgid 10001)."""
    return {
        "firstgid": MODERN_FIRSTGID,
        "name": "township-modern",
        "image": "../tilesets/township-modern.png",
        "imagewidth": MODERN_COLUMNS * T,
        "imageheight": MODERN_ROWS * T,
        "tilewidth": T,
        "tileheight": T,
        "columns": MODERN_COLUMNS,
        "tilecount": MODERN_TILECOUNT,
        "margin": 0,
        "spacing": 0,
    }


# ===========================================================================
# Generation (drawing code below runs only under __main__ / generate())
# ===========================================================================

# Intended colors; every opaque pixel is snapped to the rpg-tileset palette.
K = (45, 39, 34)  # outline
A1 = (84, 78, 73)  # asphalt warm grays
A2 = (80, 74, 69)
A3 = (88, 82, 76)
ASPECK = (97, 90, 82)
ADARK = (68, 62, 57)
C1 = (206, 192, 163)  # concrete creams
C2 = (198, 184, 156)
C3 = (214, 201, 173)
CJOINT = (176, 161, 133)
CURB_HI = (229, 218, 195)
CURB_MID = (188, 174, 147)
YEL = (216, 178, 74)
ZEB = (224, 212, 186)
ZEB2 = (208, 194, 166)
RED = (186, 66, 48)
RED_HI = (224, 112, 84)
BLUE = (62, 86, 146)
BLUE_HI = (106, 130, 186)
WHITE = (238, 234, 222)
GRAY = (128, 122, 112)
GRAY_HI = (162, 156, 144)
BIN = (86, 96, 84)
BIN_HI = (116, 128, 110)
WOOD = (152, 106, 62)
WOOD_D = (112, 76, 45)
LEAF = (92, 150, 71)
LEAF_D = (62, 118, 53)
ORANGE = (206, 118, 52)
TEAL = (86, 178, 178)  # window glass (matches the rpg teal panes)
TEAL_D = (58, 138, 142)
# ballast grays sampled from the rpg GRAVEL fill tiles (2603/2604/...)
B1 = (125, 129, 136)
B2 = (148, 162, 163)
B3 = (108, 108, 132)
BSPECK = (167, 186, 185)
SHADOW = (30, 26, 22, 70)  # kept semi-transparent, not quantized
GROUND_SHADOW = (30, 26, 22, 96)  # 2 px dithered contact shadow under props
SHADOW_TILE = (30, 26, 22, 64)  # the sh_* building-shadow overlay tiles
WIRE = (45, 39, 34, 210)  # utility wire: 1 px, slightly soft against grass

#: Seeds that reproduce the committed sidewalk edge tiles (see _draw_tiles).
_SWK_SEEDS = {
    "swk_n": 2725,
    "swk_s": 3958,
    "swk_w": 5532,
    "swk_e": 4315,
    "swk_nw": 6282,
    "swk_ne": 7307,
    "swk_sw": 4924,
    "swk_se": 41,
    "swk_hole_nw": 819,
    "swk_hole_ne": 1492,
    "swk_hole_sw": 91,
    "swk_hole_se": 235,
}

# shingle colorways: hi (course top-light) / base / dark (stagger speck) /
# line (course separation). Intent colors sit near real rpg-palette entries
# (terracotta near the brick facade, slate near the stone pad) so
# quantization keeps the ramps distinct.
SHINGLE_TONES: dict[str, dict[str, tuple[int, int, int]]] = {
    "terracotta": {
        "hi": (206, 130, 82),
        "base": (183, 98, 62),
        "dark": (150, 74, 58),
        "line": (114, 56, 52),
    },
    "slate": {
        "hi": (134, 148, 170),
        "base": (95, 109, 128),
        "dark": (66, 74, 92),
        "line": (46, 46, 58),
    },
    "cedar": {
        "hi": (176, 133, 88),
        "base": (133, 97, 67),
        "dark": (98, 69, 52),
        "line": (64, 46, 42),
    },
}
GABLE_TRIM = (229, 218, 195)  # cream fascia board on the gable ends

# chrome-diner metals
CHR_HI = (224, 228, 232)
CHR = (186, 190, 198)
CHR_MID = (156, 160, 170)
CHR_DK = (118, 124, 134)
DINER_RED = (186, 44, 52)
DINER_RED_D = (140, 26, 40)
CREAM_WALL = (241, 202, 158)  # matches the rpg cream facade fill
CREAM_WALL_D = (227, 169, 125)
SHUTTER_BLUE = (95, 109, 128)
SHUTTER_BLUE_D = (66, 76, 94)

# church kit materials: fill / course line / corner-board trim / shade.
# "cw" is bright white clapboard, "st" a light warm ashlar — both sit well
# clear of the dark castle-rubble facade the churches used to wear.
CHURCH_TONES: dict[str, dict[str, tuple[int, int, int]]] = {
    "cw": {
        "fill": (238, 234, 222),
        "line": (206, 200, 184),
        "trim": (222, 217, 203),
        "shade": (178, 172, 156),
    },
    "st": {
        "fill": (172, 166, 154),
        "line": (132, 126, 116),
        "trim": (196, 190, 178),
        "shade": (112, 107, 98),
    },
}
LOUVER = (112, 92, 68)
LOUVER_D = (58, 50, 42)
GOLD = (216, 178, 74)
GOLD_HI = (238, 208, 120)


def _load_palette() -> list[tuple[int, int, int]]:
    from PIL import Image

    img = Image.open(RPG_TILESET).convert("RGBA")
    counts: Counter = Counter()
    px = img.getdata()
    for r, g, b, a in px:
        if a == 255:
            counts[(r, g, b)] += 1
    return [c for c, n in counts.items() if n >= 25]


class Painter:
    """16x16 RGBA tile painter with palette quantization at save time."""

    def __init__(self) -> None:
        from PIL import Image

        self.img = Image.new("RGBA", (T, T), (0, 0, 0, 0))

    def px(self, x: int, y: int, c) -> None:
        if 0 <= x < T and 0 <= y < T:
            self.img.putpixel((x, y), c if len(c) == 4 else (*c, 255))

    def rect(self, x0, y0, x1, y1, c) -> None:
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.px(x, y, c)

    def noise(self, rng, x0, y0, x1, y1, tones, speck=None, speck_p=0.04) -> None:
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                c = rng.choice(tones)
                if speck and rng.random() < speck_p:
                    c = speck
                self.px(x, y, c)

    def grid(self, art: list[str], cmap: dict[str, tuple], ox: int = 0, oy: int = 0) -> None:
        for y, row in enumerate(art):
            for x, ch in enumerate(row):
                if ch in cmap:
                    self.px(ox + x, oy + y, cmap[ch])


def _asphalt_base(rng, p: Painter) -> None:
    p.noise(rng, 0, 0, 15, 15, [A1, A1, A1, A2, A2, A3], speck=ASPECK, speck_p=0.015)
    # faint cracks
    if rng.random() < 0.35:
        x = rng.randrange(2, 13)
        y = rng.randrange(2, 13)
        for i in range(rng.randrange(3, 6)):
            p.px(x + i, y + rng.choice((-1, 0, 0, 1)), ADARK)


def _sidewalk_base(rng, p: Painter, joints: bool = True) -> None:
    p.noise(rng, 0, 0, 15, 15, [C1, C1, C2, C3], speck=CJOINT, speck_p=0.02)
    if joints:
        for x in range(16):
            p.px(x, 15, CJOINT)
        for y in range(16):
            p.px(15, y, CJOINT)


def _round_cut(p: Painter, corner: str, r: int = 5) -> None:
    """Cut a rounded corner (transparent) with outline along the arc."""
    cx, cy = {"nw": (r, r), "ne": (15 - r, r), "sw": (r, 15 - r), "se": (15 - r, 15 - r)}[corner]
    zone = {
        "nw": lambda x, y: x <= cx and y <= cy,
        "ne": lambda x, y: x >= cx and y <= cy,
        "sw": lambda x, y: x <= cx and y >= cy,
        "se": lambda x, y: x >= cx and y >= cy,
    }[corner]
    for y in range(16):
        for x in range(16):
            if not zone(x, y):
                continue
            d2 = (x - cx) ** 2 + (y - cy) ** 2
            if d2 > (r + 0.5) ** 2:
                p.px(x, y, (0, 0, 0, 0))
            elif d2 > (r - 0.7) ** 2:
                p.px(x, y, K)


def _outline_edge(p: Painter, sides: str, hi=None) -> None:
    for s in sides:
        if s == "n":
            for x in range(16):
                p.px(x, 0, K)
                if hi:
                    p.px(x, 1, hi)
        if s == "s":
            for x in range(16):
                p.px(x, 15, K)
                if hi:
                    p.px(x, 14, hi)
        if s == "w":
            for y in range(16):
                p.px(0, y, K)
                if hi:
                    p.px(1, y, hi)
        if s == "e":
            for y in range(16):
                p.px(15, y, K)
                if hi:
                    p.px(14, y, hi)


def _fillet(p: Painter, corner: str, base_tones, rng, r: int = 5, hi=None) -> None:
    """Inverse (concave) corner: material only in one corner, rounded."""
    cx, cy = {"nw": (0, 0), "ne": (15, 0), "sw": (0, 15), "se": (15, 15)}[corner]
    for y in range(16):
        for x in range(16):
            d2 = (x - cx) ** 2 + (y - cy) ** 2
            if d2 <= (r - 0.7) ** 2:
                p.px(x, y, rng.choice(base_tones))
            elif d2 <= (r + 0.5) ** 2:
                p.px(x, y, K)
    if hi:
        for y in range(16):
            for x in range(16):
                d2 = (x - cx) ** 2 + (y - cy) ** 2
                if (r - 1.9) ** 2 < d2 <= (r - 0.7) ** 2:
                    p.px(x, y, hi)


def _draw_tiles() -> dict[int, object]:
    """Return {local_id: PIL tile image} for every entry in IDS."""
    tiles_out: dict[int, object] = {}

    def make(name: str, fn) -> None:
        p = Painter()
        fn(p)
        tiles_out[IDS[name]] = p.img

    def make_shadowed(name: str, fn) -> None:
        """A ground prop: draw it, then deepen its flat shadow row into the
        2 px ordered-dither contact shadow (opaque silhouette untouched)."""

        def f(p):
            fn(p)
            _ground_shadow(p)

        make(name, f)

    # --- asphalt fills -----------------------------------------------------
    for i in range(4):
        rng = random.Random(100 + i)
        make(f"asphalt_{i}", lambda p, rng=rng: _asphalt_base(rng, p))

    # --- asphalt edges (hard edge + outline, rounded convex corners) -------
    edge_map = {"asp_n": "n", "asp_s": "s", "asp_w": "w", "asp_e": "e"}
    for name, side in edge_map.items():

        def f(p, side=side, name=name):
            _asphalt_base(random.Random(_stable_seed(name)), p)
            _outline_edge(p, side)

        make(name, f)
    for name, corner, sides in (
        ("asp_nw", "nw", "nw"),
        ("asp_ne", "ne", "ne"),
        ("asp_sw", "sw", "sw"),
        ("asp_se", "se", "se"),
    ):

        def f(p, corner=corner, sides=sides, name=name):
            _asphalt_base(random.Random(_stable_seed(name)), p)
            _outline_edge(p, sides)
            _round_cut(p, corner, r=4)

        make(name, f)
    for name, corner in (
        ("asp_hole_nw", "nw"),
        ("asp_hole_ne", "ne"),
        ("asp_hole_sw", "sw"),
        ("asp_hole_se", "se"),
    ):

        def f(p, corner=corner, name=name):
            _fillet(p, corner, [A1, A2, A3], random.Random(_stable_seed(name)), r=5)

        make(name, f)

    # --- sidewalk fills ----------------------------------------------------
    for i in range(4):
        rng = random.Random(200 + i)
        make(f"swk_{i}", lambda p, rng=rng: _sidewalk_base(rng, p))

    # --- sidewalk edges: curb look (outline + light curb-top highlight) ----
    # These tiles were originally seeded with ``hash(name) % 9999``, which
    # str-hash randomization made different on every run; the seeds below
    # are the ones that reproduce the committed sheet pixel for pixel.
    swk_edge = {"swk_n": "n", "swk_s": "s", "swk_w": "w", "swk_e": "e"}
    for name, side in swk_edge.items():

        def f(p, side=side, name=name):
            _sidewalk_base(random.Random(_SWK_SEEDS[name]), p, joints=False)
            _outline_edge(p, side, hi=CURB_HI)

        make(name, f)
    for name, corner in (("swk_nw", "nw"), ("swk_ne", "ne"), ("swk_sw", "sw"), ("swk_se", "se")):

        def f(p, corner=corner, name=name):
            _sidewalk_base(random.Random(_SWK_SEEDS[name]), p, joints=False)
            _outline_edge(p, corner)
            _round_cut(p, corner, r=4)

        make(name, f)
    for name, corner in (
        ("swk_hole_nw", "nw"),
        ("swk_hole_ne", "ne"),
        ("swk_hole_sw", "sw"),
        ("swk_hole_se", "se"),
    ):

        def f(p, corner=corner, name=name):
            _fillet(p, corner, [C1, C2, C3], random.Random(_SWK_SEEDS[name]), r=5, hi=CURB_HI)

        make(name, f)

    # --- markings ----------------------------------------------------------
    def crosswalk_h(p):  # horizontal road -> N-S band, E-W bars
        _asphalt_base(random.Random(32), p)
        rng = random.Random(7)
        for y0 in (1, 9):
            for y in range(y0, y0 + 4):
                for x in range(16):
                    p.px(x, y, ZEB2 if rng.random() < 0.18 else ZEB)

    make("crosswalk_h", crosswalk_h)

    def crosswalk_v(p):
        _asphalt_base(random.Random(33), p)
        rng = random.Random(8)
        for x0 in (1, 9):
            for x in range(x0, x0 + 4):
                for y in range(16):
                    p.px(x, y, ZEB2 if rng.random() < 0.18 else ZEB)

    make("crosswalk_v", crosswalk_v)

    def dash_h(p):
        _asphalt_base(random.Random(34), p)
        for x in range(3, 13):
            p.px(x, 7, YEL)
            p.px(x, 8, YEL)

    make("dash_h", dash_h)

    def dash_v(p):
        _asphalt_base(random.Random(35), p)
        for y in range(3, 13):
            p.px(7, y, YEL)
            p.px(8, y, YEL)

    make("dash_v", dash_v)

    # --- curb corner overlays (quarter arc of curb on transparency) --------
    for name, corner in (
        ("curb_nw", "nw"),
        ("curb_ne", "ne"),
        ("curb_sw", "sw"),
        ("curb_se", "se"),
    ):

        def f(p, corner=corner):
            cx, cy = {"nw": (15, 15), "ne": (0, 15), "sw": (15, 0), "se": (0, 0)}[corner]
            for y in range(16):
                for x in range(16):
                    d2 = (x - cx) ** 2 + (y - cy) ** 2
                    if 10.5**2 < d2 <= 12.5**2:
                        p.px(x, y, CURB_MID)
                    elif 12.5**2 < d2 <= 13.8**2:
                        p.px(x, y, K)

        make(name, f)

    def parking_stall(p):
        _asphalt_base(random.Random(40), p)
        for y in range(16):
            p.px(0, y, ZEB2)
        for x in range(0, 8):
            p.px(x, 0, ZEB2)

    make("parking_stall", parking_stall)

    def storm_drain(p):
        _asphalt_base(random.Random(41), p)
        p.rect(3, 5, 12, 10, ADARK)
        p.rect(3, 5, 12, 5, K)
        for x in (4, 6, 8, 10):
            p.rect(x, 6, x, 9, K)
        p.rect(3, 10, 12, 10, GRAY)

    make("storm_drain", storm_drain)

    # --- props -------------------------------------------------------------
    def hydrant(p):
        p.grid(
            [
                "................",
                "................",
                "................",
                "......oo........",
                ".....orro.......",
                ".....orho.......",
                "....oorroo......",
                "...or.rr.ro.....",
                "...oo.rh.oo.....",
                ".....orro.......",
                ".....orro.......",
                "....oorroo......",
                "....orrrro......",
                "....oooooo......",
                "...ssssssss.....",
                "................",
            ],
            {"o": K, "r": RED, "h": RED_HI, "s": SHADOW},
        )

    make_shadowed("hydrant", hydrant)

    def mailbox(p):
        p.grid(
            [
                "................",
                "................",
                "....oooooo......",
                "...obbbbbbo.....",
                "...obhhhhbo.....",
                "...obbbbbbo.....",
                "...obwwwwbo.....",
                "...obbbbbbo.....",
                "...obbbbbbo.....",
                "...oobbbboo.....",
                "....o.oo.o......",
                "....o.oo.o......",
                "....o.oo.o......",
                "...ssssssss.....",
                "................",
                "................",
            ],
            {"o": K, "b": BLUE, "h": BLUE_HI, "w": WHITE, "s": SHADOW},
        )

    make_shadowed("mailbox", mailbox)

    def bus_sign_top(p):
        p.grid(
            [
                "................",
                "...ooooooo......",
                "..obbbbbbbo.....",
                "..obwbwbwbo.....",
                "..obwbwbwbo.....",
                "..obbbbbbbo.....",
                "..obwwwwwbo.....",
                "..obbbbbbbo.....",
                "...ooooooo......",
                "......go........",
                "......go........",
                "......go........",
                "......go........",
                "......go........",
                "......go........",
                "......go........",
            ],
            {"o": K, "b": BLUE, "w": WHITE, "g": GRAY_HI},
        )

    make("bus_sign_top", bus_sign_top)

    def bus_sign_bot(p):
        p.grid(
            [
                "......go........",
                "......go........",
                "......go........",
                "......go........",
                "......go........",
                "......go........",
                "......go........",
                "......go........",
                "......go........",
                "......go........",
                ".....ogggo......",
                ".....ooooo......",
                "....sssssss.....",
                "................",
                "................",
                "................",
            ],
            {"o": K, "g": GRAY, "s": SHADOW},
        )

    make("bus_sign_bot", bus_sign_bot)

    def trash_bin(p):
        p.grid(
            [
                "................",
                "................",
                "................",
                "....oooooo......",
                "...oddddddo.....",
                "...oooooooo.....",
                "....obbhbo......",
                "....obbhbo......",
                "....obbhbo......",
                "....obbhbo......",
                "....obbhbo......",
                "....obbhbo......",
                "....oooooo......",
                "...ssssssss.....",
                "................",
                "................",
            ],
            {"o": K, "d": BIN_HI, "b": BIN, "h": BIN_HI, "s": SHADOW},
        )

    make_shadowed("trash_bin", trash_bin)

    def planter_box(p):
        p.grid(
            [
                "................",
                "................",
                "....g..gg.......",
                "...gLgLLLLg.....",
                "..gLLgLLLLLg....",
                "..gLLLLgLLLg....",
                "..ogLLLLLLgo....",
                "..owwwwwwwwo....",
                "..owddddddwo....",
                "..owwwwwwwwo....",
                "...owddddwo.....",
                "...oooooooo.....",
                "..ssssssssss....",
                "................",
                "................",
                "................",
            ],
            {"o": K, "w": WOOD, "d": WOOD_D, "L": LEAF, "g": LEAF_D, "s": SHADOW},
        )

    make_shadowed("planter_box", planter_box)

    def newsbox(p):
        p.grid(
            [
                "................",
                "................",
                "................",
                "...oooooooo.....",
                "..oNNNNNNNNo....",
                "..oNwwwwwwNo....",
                "..oNwbbbbwNo....",
                "..oNwwwwwwNo....",
                "..oNNNNNNNNo....",
                "..oNNNNNNNNo....",
                "...oooooooo.....",
                "....o....o......",
                "....o....o......",
                "...ssssssss.....",
                "................",
                "................",
            ],
            {"o": K, "N": ORANGE, "w": WHITE, "b": BLUE, "s": SHADOW},
        )

    make_shadowed("newsbox", newsbox)

    def bench_h(p):
        p.grid(
            [
                "................",
                "................",
                "................",
                "................",
                "................",
                "..oooooooooooo..",
                ".owwwwwwwwwwwwo.",
                "..oddddddddddo..",
                ".owwwwwwwwwwwwo.",
                "..oo........oo..",
                "..oo........oo..",
                ".ssssssssssssss.",
                "................",
                "................",
                "................",
                "................",
            ],
            {"o": K, "w": WOOD, "d": WOOD_D, "s": SHADOW},
        )

    make_shadowed("bench_h", bench_h)

    # --- facade window (2x2) -----------------------------------------------
    # FULLY OPAQUE, edge to edge: a tile layer holds one gid per cell, so a
    # window stamped onto a facade REPLACES the wall tile — any transparent
    # margin would show the ground layer's grass through the wall (the exact
    # defect the rpg tileset's grass-baked WINDOW_TEAL had).
    def _window_quadrants():
        from PIL import Image

        big = Image.new("RGBA", (32, 32), (0, 0, 0, 0))

        def wpx(x, y, c):
            if 0 <= x < 32 and 0 <= y < 32:
                big.putpixel((x, y), c if len(c) == 4 else (*c, 255))

        def wrect(x0, y0, x1, y1, c):
            for y in range(y0, y1 + 1):
                for x in range(x0, x1 + 1):
                    wpx(x, y, c)

        # stone surround (fills every pixel), outlined
        wrect(0, 0, 31, 31, CURB_MID)
        wrect(1, 1, 30, 2, CURB_HI)  # lintel highlight
        wrect(1, 27, 30, 28, CURB_HI)  # sill top lip
        wrect(1, 29, 30, 30, CJOINT)  # sill shadow
        wrect(0, 0, 31, 0, K)
        wrect(0, 31, 31, 31, K)
        wrect(0, 0, 0, 31, K)
        wrect(31, 0, 31, 31, K)
        # frame + glass (four panes: center mullion + transom bar)
        wrect(2, 3, 29, 26, K)
        wrect(3, 4, 28, 25, TEAL)
        wrect(3, 23, 28, 25, TEAL_D)
        wrect(15, 4, 16, 25, K)
        wrect(3, 14, 28, 15, K)
        # sparkle highlight in the upper panes
        for bx in (5, 19):
            for i in range(5):
                wpx(bx + i, 11 - i, WHITE)
                wpx(bx + i + 1, 11 - i, WHITE)
        return {
            "win_tl": big.crop((0, 0, 16, 16)),
            "win_tr": big.crop((16, 0, 32, 16)),
            "win_bl": big.crop((0, 16, 16, 32)),
            "win_br": big.crop((16, 16, 32, 32)),
        }

    for name, img in _window_quadrants().items():
        tiles_out[IDS[name]] = img

    # --- railway -----------------------------------------------------------
    def _rails(p):
        for ry in (3, 9):
            p.rect(0, ry, 15, ry, K)
            p.rect(0, ry + 1, 15, ry + 1, GRAY_HI)
            p.rect(0, ry + 2, 15, ry + 2, ADARK)

    def rail_h(p):
        rng = random.Random(55)
        p.noise(rng, 0, 0, 15, 15, [B1, B1, B2, B3], speck=BSPECK, speck_p=0.06)
        for tx in (1, 5, 9, 13):  # sleepers
            p.rect(tx, 1, tx + 1, 13, WOOD_D)
            p.rect(tx, 1, tx + 1, 1, WOOD)
        _rails(p)

    make("rail_h", rail_h)

    def rail_x(p):
        _asphalt_base(random.Random(56), p)
        _rails(p)

    make("rail_x", rail_x)

    def bollard(p):
        p.grid(
            [
                "................",
                "................",
                "................",
                "................",
                "................",
                "......oo........",
                ".....ogho.......",
                ".....oggo.......",
                ".....oggo.......",
                ".....oggo.......",
                ".....oooo.......",
                "....ssssss......",
                "................",
                "................",
                "................",
                "................",
            ],
            {"o": K, "g": GRAY, "h": GRAY_HI, "s": SHADOW},
        )

    make_shadowed("bollard", bollard)

    # --- pitched shingle-roof kit (3 colorways x ridge/slope/eave x l/m/r) --
    def _shingle_field(p: Painter, t: dict, y0: int, y1: int, phase: int = 0) -> None:
        """Shingle courses: 4 px per course (highlight, 2x base, dark line),
        vertical joints every 8 px staggered half a shingle per course. The
        pattern's vertical period is 16 px, so slope tiles stack seamlessly."""
        for y in range(y0, y1 + 1):
            yy = y - y0 + phase
            cy = yy % 4
            course = yy // 4
            joint = 0 if course % 2 == 0 else 4
            for x in range(T):
                at_joint = (x + joint) % 8 == 0
                if cy == 0:
                    # notch the course highlight at every shingle joint so
                    # individual shingles read, not just horizontal stripes
                    c = t["base"] if at_joint else t["hi"]
                elif cy == 3:
                    c = t["line"]
                else:
                    c = t["dark"] if at_joint else t["base"]
                p.px(x, y, c)

    def _ridge_cap(p: Painter, t: dict) -> None:
        for x in range(T):
            p.px(x, 0, K)
            p.px(x, 1, t["hi"])
            p.px(x, 2, t["base"])
            p.px(x, 3, t["line"])
        # phase 4 => the field below the cap ends on an odd course, so a
        # slope tile placed underneath continues the half-shingle stagger
        _shingle_field(p, t, 4, 15, phase=4)

    def _eave_rows(p: Painter, t: dict) -> None:
        _shingle_field(p, t, 0, 11)
        for x in range(T):
            p.px(x, 12, t["base"])
            p.px(x, 13, t["dark"])
            p.px(x, 14, t["line"])
            p.px(x, 15, K)

    def _gable(p: Painter, side: str) -> None:
        xo, xt = (0, 1) if side == "l" else (15, 14)
        for y in range(T):
            p.px(xt, y, GABLE_TRIM)
            p.px(xo, y, K)

    for cw in SHINGLE_COLORWAYS:
        tones = SHINGLE_TONES[cw]
        for part in _SHINGLE_PARTS:
            for side in ("l", "m", "r"):

                def f(p, t=tones, part=part, side=side):
                    if part == "ridge":
                        _ridge_cap(p, t)
                    elif part == "eave":
                        _eave_rows(p, t)
                    else:
                        _shingle_field(p, t, 0, 15)
                    if side in ("l", "r"):
                        _gable(p, side)
                        if part == "ridge":
                            for x in range(T):
                                p.px(x, 0, K)
                        if part == "eave":
                            for x in range(T):
                                p.px(x, 15, K)

                make(f"shg_{cw}_{part}_{side}", f)

    # --- chrome-diner kit ---------------------------------------------------
    def _chrome_band(p: Painter) -> None:
        rows = (
            K,
            CHR_HI,
            CHR_HI,
            CHR,
            WHITE,
            WHITE,
            CHR,
            CHR,
            CHR_MID,
            CHR_MID,
            CHR,
            CHR_MID,
            CHR_DK,
            CHR_DK,
            CHR_MID,
            K,
        )
        for y, c in enumerate(rows):
            for x in range(T):
                p.px(x, y, c)
        for x in (2, 6, 10, 14):  # rivets on the lower band
            p.px(x, 12, CHR_HI)

    def diner_roof_m(p):
        _chrome_band(p)

    make("diner_roof_m", diner_roof_m)

    def _diner_roof_end(p, side: str) -> None:
        _chrome_band(p)
        _round_cut(p, "nw" if side == "l" else "ne", r=5)
        xo = 0 if side == "l" else 15
        for y in range(5, T):
            p.px(xo, y, K)

    make("diner_roof_l", lambda p: _diner_roof_end(p, "l"))
    make("diner_roof_r", lambda p: _diner_roof_end(p, "r"))

    def _sign_panel(p: Painter) -> None:
        rows = (
            K,
            CHR_HI,
            CHR_MID,
            DINER_RED,
            DINER_RED,
            DINER_RED,
            DINER_RED,
            DINER_RED,
            DINER_RED,
            DINER_RED,
            DINER_RED,
            DINER_RED_D,
            DINER_RED_D,
            CHR_MID,
            CHR_DK,
            K,
        )
        for y, c in enumerate(rows):
            for x in range(T):
                p.px(x, y, c)

    make("diner_trim", _sign_panel)

    # DINER letterboard drawn across a 32x16 pair, 5x7 px letters
    _FONT = {
        "D": ("XXXX.", "X...X", "X...X", "X...X", "X...X", "X...X", "XXXX."),
        "I": ("XXXXX", "..X..", "..X..", "..X..", "..X..", "..X..", "XXXXX"),
        "N": ("X...X", "XX..X", "XX..X", "X.X.X", "X..XX", "X..XX", "X...X"),
        "E": ("XXXXX", "X....", "X....", "XXXX.", "X....", "X....", "XXXXX"),
        "R": ("XXXX.", "X...X", "X...X", "XXXX.", "X.X..", "X..X.", "X...X"),
    }

    def _diner_sign_tiles():
        from PIL import Image

        big = Image.new("RGBA", (32, 16), (0, 0, 0, 0))
        pa, pb = Painter(), Painter()
        _sign_panel(pa)
        _sign_panel(pb)
        big.alpha_composite(pa.img, (0, 0))
        big.alpha_composite(pb.img, (16, 0))
        for li, ch in enumerate("DINER"):
            x0 = 2 + li * 6
            for gy, rowbits in enumerate(_FONT[ch]):
                for gx, bit in enumerate(rowbits):
                    if bit == "X":
                        big.putpixel((x0 + gx, 4 + gy), (*WHITE, 255))
        return {"diner_sign_a": big.crop((0, 0, 16, 16)), "diner_sign_b": big.crop((16, 0, 32, 16))}

    for name, img in _diner_sign_tiles().items():
        tiles_out[IDS[name]] = img

    def _diner_window(p: Painter, side: str = "m") -> None:
        # stainless header, chrome-framed glass band, red skirt stripe
        for x in range(T):
            p.px(x, 0, CHR_HI)
            p.px(x, 1, CHR)
            p.px(x, 2, K)
            for y in range(3, 12):
                p.px(x, y, TEAL if y < 10 else TEAL_D)
            p.px(x, 12, K)
            p.px(x, 13, DINER_RED)
            p.px(x, 14, DINER_RED_D)
            p.px(x, 15, K)
        if side == "m":
            for y in range(3, 12):  # slim mullion between panes
                p.px(0, y, CHR_MID)
        for i in range(5):  # sparkle
            p.px(3 + i, 8 - i, WHITE)
            p.px(4 + i, 8 - i, WHITE)
        if side in ("l", "r"):
            xo, xt = (0, 1) if side == "l" else (15, 14)
            for y in range(T):
                p.px(xt, y, CHR)
                p.px(xo, y, K)

    make("diner_win_m", lambda p: _diner_window(p, "m"))
    make("diner_win_l", lambda p: _diner_window(p, "l"))
    make("diner_win_r", lambda p: _diner_window(p, "r"))

    def diner_wall(p):
        # smooth stainless panels: 8 px sheets with a soft top sheen and a
        # thin seam line — quiet, so the windows and sign carry the facade
        for y in range(T):
            m8 = y % 8
            c = CHR_HI if m8 in (1, 2) else (CHR_MID if m8 == 7 else CHR)
            for x in range(T):
                p.px(x, y, c)

    make("diner_wall", diner_wall)

    def _diner_door(p: Painter, half: str) -> None:
        diner_wall(p)
        if half == "t":
            for x in range(3, 13):
                p.px(x, 2, K)
            for y in range(3, 16):
                p.px(3, y, K)
                p.px(12, y, K)
                p.px(4, y, CHR)
                p.px(11, y, CHR)
                for x in range(5, 11):
                    p.px(x, y, TEAL)
            for i in range(3):
                p.px(6 + i, 6 - i, WHITE)
        else:
            for y in range(0, 10):
                p.px(3, y, K)
                p.px(12, y, K)
                p.px(4, y, CHR)
                p.px(11, y, CHR)
                for x in range(5, 11):
                    p.px(x, y, TEAL if y < 4 else CHR_MID)
            p.px(10, 2, K)  # handle
            p.px(10, 3, K)
            for x in range(3, 13):
                p.px(x, 10, K)
            for x in range(2, 14):  # doorstep
                p.px(x, 12, CHR_MID)
                p.px(x, 13, CHR_DK)

    make("diner_door_t", lambda p: _diner_door(p, "t"))
    make("diner_door_b", lambda p: _diner_door(p, "b"))

    # --- colonial shutter window (2x2, opaque, cream surround) -------------
    def _shutter_quadrants():
        from PIL import Image

        big = Image.new("RGBA", (32, 32), (0, 0, 0, 0))

        def wpx(x, y, c):
            if 0 <= x < 32 and 0 <= y < 32:
                big.putpixel((x, y), c if len(c) == 4 else (*c, 255))

        def wrect(x0, y0, x1, y1, c):
            for y in range(y0, y1 + 1):
                for x in range(x0, x1 + 1):
                    wpx(x, y, c)

        # cream clapboard surround with faint siding lines
        wrect(0, 0, 31, 31, CREAM_WALL)
        for y in (5, 13, 21, 29):
            wrect(0, y, 31, y, CREAM_WALL_D)
        # shutters: louvered slate-blue panels
        for sx in (2, 25):
            wrect(sx - 1, 2, sx + 5, 26, K)
            wrect(sx, 3, sx + 4, 25, SHUTTER_BLUE)
            for ly in range(5, 25, 3):
                wrect(sx, ly, sx + 4, ly, SHUTTER_BLUE_D)
        # sash window: white frame, four panes
        wrect(8, 2, 23, 26, K)
        wrect(9, 3, 22, 25, WHITE)
        wrect(10, 4, 21, 24, TEAL)
        wrect(10, 22, 21, 24, TEAL_D)
        wrect(15, 4, 16, 24, WHITE)
        wrect(10, 13, 21, 14, WHITE)
        for i in range(4):  # sparkle in the upper-left pane
            wpx(11 + i, 9 - i, WHITE)
            wpx(12 + i, 9 - i, WHITE)
        # sill
        wrect(6, 27, 25, 28, GABLE_TRIM)
        wrect(6, 29, 25, 29, CJOINT)
        return {
            "swin_tl": big.crop((0, 0, 16, 16)),
            "swin_tr": big.crop((16, 0, 32, 16)),
            "swin_bl": big.crop((0, 16, 16, 32)),
            "swin_br": big.crop((16, 16, 32, 32)),
        }

    for name, img in _shutter_quadrants().items():
        tiles_out[IDS[name]] = img

    # --- civic kit ------------------------------------------------------------
    # Yard sign: a white board (tinted at runtime) over a wooden stake. The
    # board carries two faint "text" dashes so a tinted sign still reads as
    # a printed sign, not a colored rectangle.
    def yard_post(p):
        p.grid(
            [
                "................",
                "................",
                "................",
                "................",
                "................",
                "................",
                ".......oo.......",
                ".......wd.......",
                ".......wd.......",
                ".......wd.......",
                ".......wd.......",
                ".......wd.......",
                ".......wd.......",
                ".......oo.......",
                "......ssss......",
                "................",
            ],
            {"o": K, "w": WOOD, "d": WOOD_D, "s": SHADOW},
        )

    make("yard_post", yard_post)

    def yard_board(p):
        p.grid(
            [
                "................",
                "................",
                "................",
                "..oooooooooooo..",
                "..oWWWWWWWWWWo..",
                "..oWWggggggWWo..",
                "..oWWWWWWWWWWo..",
                "..oWWgggggggWo..",
                "..oWWWWWWWWWWo..",
                "..oWWggggWWWWo..",
                "..oWWWWWWWWWWo..",
                "..oooooooooooo..",
                ".......oo.......",
                ".......oo.......",
                "................",
                "................",
            ],
            {"o": K, "W": (250, 248, 240), "g": GRAY_HI},
        )

    make("yard_board", yard_board)

    # Notice board kiosk (2x2): cedar mini-roof, cork board in a wood frame,
    # two posts. The cork is left plain — the runtime pins headline sheets.
    def _notice(p, quadrant):
        cedar = SHINGLE_TONES["cedar"]
        art_top = [
            "..oooooooooooooooooooooooooooo..",
            ".ohhhhhhhhhhhhhhhhhhhhhhhhhhhho.",
            "obbbbbbbbbbbbbbbbbbbbbbbbbbbbbbo",
            "obbbbbbbbdbbbbbbbdbbbbbbbbdbbbbo",
            "olllllllllllllllllllllllllllllllo",
            "oooooooooooooooooooooooooooooooo",
            ".oFFFFFFFFFFFFFFFFFFFFFFFFFFFFo.",
            ".oFccccccccccccccccccccccccccFo.",
            ".oFcccCcccccccCccccccccCcccccFo.",
            ".oFccccccccccccccccccccccccccFo.",
            ".oFcccccccCcccccccccCccccccccFo.",
            ".oFccccccccccccccccccccccccccFo.",
            ".oFcccCccccccccccCcccccccCcccFo.",
            ".oFccccccccccccccccccccccccccFo.",
            ".oFFFFFFFFFFFFFFFFFFFFFFFFFFFFo.",
            ".oooooooooooooooooooooooooooooo.",
        ]
        art_bot = [
            ".oFFFFFFFFFFFFFFFFFFFFFFFFFFFFo.",
            ".oFccccccccccccccccccccccccccFo.",
            ".oFccccCcccccccccCccccccCccccFo.",
            ".oFccccccccccccccccccccccccccFo.",
            ".oFFFFFFFFFFFFFFFFFFFFFFFFFFFFo.",
            ".oooooooooooooooooooooooooooooo.",
            "....owd..................owd....",
            "....owd..................owd....",
            "....owd..................owd....",
            "....owd..................owd....",
            "....owd..................owd....",
            "....owd..................owd....",
            "....owd..................owd....",
            "...sssss................sssss...",
            "................................",
            "................................",
        ]
        cmap = {
            "o": K,
            "h": cedar["hi"],
            "b": cedar["base"],
            "d": cedar["dark"],
            "l": cedar["line"],
            "F": WOOD,
            "c": (176, 128, 84),
            "C": (150, 106, 66),
            "w": WOOD,
            "s": SHADOW,
        }
        cmap["d"] = cedar["dark"] if quadrant[0] == "t" else WOOD_D
        art = art_top if quadrant[0] == "t" else art_bot
        ox = 0 if quadrant[1] == "l" else 16
        rows = [row[ox : ox + 16] for row in art]
        p.grid(rows, cmap)

    for q in ("tl", "tr", "bl", "br"):
        make(f"notice_{q}", lambda p, q=q: _notice(p, q))

    # VOTE HERE board: a white board with red 3x5 lettering, over a stake.
    FONT3x5 = {
        "V": ["#.#", "#.#", "#.#", "#.#", ".#."],
        "O": ["###", "#.#", "#.#", "#.#", "###"],
        "T": ["###", ".#.", ".#.", ".#.", ".#."],
        "E": ["###", "#..", "##.", "#..", "###"],
        "H": ["#.#", "#.#", "###", "#.#", "#.#"],
        "R": ["##.", "#.#", "##.", "#.#", "#.#"],
    }

    def vote_board(p):
        p.rect(0, 1, 15, 14, K)
        p.rect(1, 2, 14, 13, (250, 248, 240))
        p.rect(1, 13, 14, 13, CJOINT)
        for row_i, word in enumerate(("VOTE", "HERE")):
            for ci, ch in enumerate(word):
                glyph = FONT3x5[ch]
                for gy, grow in enumerate(glyph):
                    for gx, gch in enumerate(grow):
                        if gch == "#":
                            p.px(2 + ci * 3 + gx, 3 + row_i * 6 + gy, RED if row_i == 0 else BLUE)
        p.rect(7, 15, 8, 15, K)

    make("vote_board", vote_board)

    # Ballot box: a civic-blue box with a dark slot on a wooden stand.
    def ballot_box(p):
        p.grid(
            [
                "................",
                "................",
                "....oooooooo....",
                "...ohhhhhhhho...",
                "...ohbbbbbbho...",
                "...ohbooooBho...",
                "...ohbbbbbbho...",
                "...obbbbbbbbo...",
                "...obbbbbbbbo...",
                "...obbbbbbbbo...",
                "....oooooooo....",
                ".....owwwwo.....",
                ".....owddwo.....",
                ".....oo..oo.....",
                "....ssssssss....",
                "................",
            ],
            {"o": K, "h": BLUE_HI, "b": BLUE, "B": BLUE_HI, "w": WOOD, "d": WOOD_D, "s": SHADOW},
        )

    make("ballot_box", ballot_box)

    def stanchion(p):
        p.grid(
            [
                "................",
                "................",
                "................",
                ".......oo.......",
                "......ohho......",
                "......ohgo......",
                ".......oo.......",
                ".......go.......",
                ".......go.......",
                ".......go.......",
                ".......go.......",
                ".......go.......",
                "......oggo......",
                ".....oggggo.....",
                ".....ssssss.....",
                "................",
            ],
            {"o": K, "h": GRAY_HI, "g": GRAY, "s": SHADOW},
        )

    make("stanchion", stanchion)

    def rope_h(p):
        p.grid(
            [
                "................",
                "................",
                "................",
                "................",
                "................",
                "................",
                "oo............oo",
                "rroo........oorr",
                "..rroooooooorr..",
                "....rrrrrrrr....",
                "................",
                "................",
                "................",
                "................",
                "................",
                "................",
            ],
            {"o": K, "r": RED_HI},
        )

    make("rope_h", rope_h)

    # Plain hanging banner (1x2): gold rod, white cloth (tinted at runtime),
    # swallow-tail hem.
    def banner_plain_t(p):
        p.grid(
            [
                "................",
                "..GGGGGGGGGGGG..",
                "...oooooooooo...",
                "...oWWWWWWWWo...",
                "...oWWWWWWWWo...",
                "...oWWWWWWWWo...",
                "...oWWWWWWWWo...",
                "...oWWWWWWWWo...",
                "...oWWWWWWWWo...",
                "...oWWWWWWWWo...",
                "...oWWWWWWWWo...",
                "...oWWWWWWWWo...",
                "...oWWWWWWWWo...",
                "...oWWWWWWWWo...",
                "...oWWWWWWWWo...",
                "...oWWWWWWWWo...",
            ],
            {"o": K, "G": GOLD, "W": (250, 248, 240)},
        )

    make("banner_plain_t", banner_plain_t)

    def banner_plain_b(p):
        p.grid(
            [
                "...oWWWWWWWWo...",
                "...oWWWWWWWWo...",
                "...oWWWWWWWWo...",
                "...oWWWWWWWWo...",
                "...oWWWWWWWWo...",
                "...oWWWWWWWWo...",
                "...oWWWWWWWWo...",
                "...oWWWWWWWWo...",
                "...oWWWWWWWWo...",
                "...oWWWooWWWo...",
                "...oWWo..oWWo...",
                "...oWo....oWo...",
                "...oo......oo...",
                "................",
                "................",
                "................",
            ],
            {"o": K, "W": (250, 248, 240)},
        )

    make("banner_plain_b", banner_plain_b)

    # Bunting strip: a dark string with three white pennants (tinted at
    # runtime), tiling horizontally along a wall row.
    def bunting_h(p):
        p.grid(
            [
                "................",
                "oooooooooooooooo",
                "oWWWoo.oWWWoo.oW",
                "oWWWo..oWWWo..oW",
                ".oWo....oWo....o",
                ".oWo....oWo....o",
                "..o......o......",
                "................",
                "................",
                "................",
                "................",
                "................",
                "................",
                "................",
                "................",
                "................",
            ],
            {"o": K, "W": (250, 248, 240)},
        )

    make("bunting_h", bunting_h)

    # Small opaque window (1x1): stone surround, teal glass, mullion, sparkle.
    def win_small(p):
        p.rect(0, 0, 15, 15, CURB_MID)
        p.rect(1, 1, 14, 1, CURB_HI)
        p.rect(0, 0, 15, 0, K)
        p.rect(0, 15, 15, 15, K)
        p.rect(0, 0, 0, 15, K)
        p.rect(15, 0, 15, 15, K)
        p.rect(2, 2, 13, 12, K)
        p.rect(3, 3, 12, 11, TEAL)
        p.rect(3, 10, 12, 11, TEAL_D)
        p.rect(7, 3, 8, 11, K)
        p.rect(3, 6, 12, 7, K)
        for i in range(3):
            p.px(4 + i, 5 - i, WHITE)
        p.rect(2, 13, 13, 13, CURB_HI)
        p.rect(2, 14, 13, 14, CJOINT)

    make("win_small", win_small)

    # Chimney stack (transparent bg): brick stack with a stone cap, drawn in
    # the row above a shingle ridge so it pokes above the roofline.
    def chimney(p):
        p.grid(
            [
                "................",
                "................",
                "................",
                "................",
                "................",
                "................",
                "................",
                "................",
                "......oooo......",
                ".....ohhhho.....",
                "......orro......",
                "......oRro......",
                "......orRo......",
                "......orro......",
                "......oRro......",
                "......orro......",
            ],
            {"o": K, "h": CURB_HI, "r": (156, 78, 58), "R": (186, 96, 70)},
        )

    make("chimney", chimney)

    # Park brazier: an iron bowl on three legs, unlit (the runtime lights it).
    def brazier(p):
        p.grid(
            [
                "................",
                "................",
                "................",
                "................",
                "................",
                "................",
                "....oooooooo....",
                "...ogggggggggo..",
                "....ogggggggo...",
                ".....ooooooo....",
                "......o..o......",
                ".....o....o.....",
                "....o......o....",
                "...oo......oo...",
                "...ssssssssss...",
                "................",
            ],
            {"o": K, "g": GRAY, "s": SHADOW},
        )

    make_shadowed("brazier", brazier)

    # --- church kit ----------------------------------------------------------
    for name, img in _church_tiles().items():
        tiles_out[IDS[name]] = img

    # --- rows 17-29: shadows, litter, ground blobs, vehicles, hedge, street /
    # suburb kits and the set-pieces ------------------------------------------
    for name, img in _kit_tiles().items():
        tiles_out[IDS[name]] = img

    missing = sorted(n for n, i in IDS.items() if i not in tiles_out)
    assert not missing, f"registered but unpainted: {missing}"
    return tiles_out


def _church_tiles() -> dict[str, object]:
    """Draw the church kit as big composites and crop 16px tiles.

    Every wall-material tile is FULLY OPAQUE (tile layers hold one gid per
    cell, so transparent margins would let grass bleed through the facade);
    only the spire — which stands above the roofline over open ground, like
    a tree crown — keeps a transparent background.
    """
    from PIL import Image

    S = SHINGLE_TONES["slate"]
    out: dict[str, object] = {}

    def big_img(w: int, h: int) -> object:
        return Image.new("RGBA", (w, h), (0, 0, 0, 0))

    def bpx(im, x, y, c) -> None:
        if 0 <= x < im.width and 0 <= y < im.height:
            im.putpixel((x, y), c if len(c) == 4 else (*c, 255))

    def brect(im, x0, y0, x1, y1, c) -> None:
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                bpx(im, x, y, c)

    def wall_bg(im, v: str, x0: int, y0: int, x1: int, y1: int) -> None:
        """Seamless wall material (period 4 vertically, 16 horizontally)."""
        t = CHURCH_TONES[v]
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                if v == "cw":  # clapboard siding: shadow line every 4 rows
                    c = t["line"] if y % 4 == 3 else t["fill"]
                else:  # ashlar: 8x4 blocks, staggered joints
                    course = y // 4
                    joint = (x + (4 if course % 2 else 0)) % 8 == 0
                    c = t["line"] if (y % 4 == 3 or joint) else t["fill"]
                bpx(im, x, y, c)

    def edge_boards(im, v: str, y0: int, y1: int) -> None:
        """1px outline + corner-board trim on the composite's l/r edges."""
        t = CHURCH_TONES[v]
        for y in range(y0, y1 + 1):
            bpx(im, 0, y, K)
            bpx(im, 1, y, t["trim"])
            bpx(im, im.width - 1, y, K)
            bpx(im, im.width - 2, y, t["shade"])

    # -- shared spire pair (32x16, transparent bg) ---------------------------
    sp = big_img(32, 16)
    brect(sp, 14, 0, 17, 5, K)  # cross, outlined gold
    brect(sp, 11, 1, 20, 3, K)
    brect(sp, 15, 1, 16, 4, GOLD)
    brect(sp, 12, 2, 19, 2, GOLD)
    bpx(sp, 15, 1, GOLD_HI)
    bpx(sp, 16, 1, GOLD_HI)
    for i, y in enumerate(range(6, 12)):  # slate cone widening downward
        half = 2 + i
        x0, x1 = 15 - half, 16 + half
        bpx(sp, x0, y, K)
        bpx(sp, x1, y, K)
        brect(sp, x0 + 1, y, 15, y, S["hi"])
        brect(sp, 16, y, x1 - 1, y, S["base"])
    brect(sp, 8, 12, 23, 12, K)  # cone shoulder
    brect(sp, 9, 12, 15, 12, S["hi"])
    brect(sp, 16, 12, 22, 12, S["base"])
    brect(sp, 0, 13, 31, 13, K)  # flared cap eave, full tower width
    brect(sp, 1, 13, 15, 13, S["hi"])
    brect(sp, 16, 13, 30, 13, S["base"])
    brect(sp, 0, 14, 31, 14, S["dark"])
    bpx(sp, 0, 14, K)
    bpx(sp, 31, 14, K)
    brect(sp, 0, 15, 31, 15, K)
    out["ch_spire_l"] = sp.crop((0, 0, 16, 16))
    out["ch_spire_r"] = sp.crop((16, 0, 32, 16))

    for v in ("cw", "st"):
        t = CHURCH_TONES[v]

        # -- belfry (32x16): twin louvered arches under the cap ---------------
        bf = big_img(32, 16)
        wall_bg(bf, v, 0, 0, 31, 15)
        edge_boards(bf, v, 0, 15)
        for ax in (6, 18):  # two 8-wide arched openings
            brect(bf, ax + 2, 2, ax + 5, 2, K)  # arch crown
            bpx(bf, ax + 1, 3, K)
            bpx(bf, ax + 6, 3, K)
            brect(bf, ax + 2, 3, ax + 5, 3, LOUVER_D)
            brect(bf, ax, 4, ax, 12, K)
            brect(bf, ax + 7, 4, ax + 7, 12, K)
            brect(bf, ax + 1, 4, ax + 6, 12, LOUVER_D)
            for ly in (5, 7, 9, 11):  # louver slats
                brect(bf, ax + 1, ly, ax + 6, ly, LOUVER)
            brect(bf, ax, 13, ax + 7, 13, K)  # sill
            brect(bf, ax, 14, ax + 7, 14, t["trim"])
        brect(bf, 2, 15, 29, 15, t["shade"])  # cornice shadow over the ridge
        out[f"ch_{v}_belfry_l"] = bf.crop((0, 0, 16, 16))
        out[f"ch_{v}_belfry_r"] = bf.crop((16, 0, 32, 16))

        # -- tower shaft (32x16): plain body rising through the roof ----------
        tw = big_img(32, 16)
        wall_bg(tw, v, 0, 0, 31, 15)
        edge_boards(tw, v, 0, 15)
        out[f"ch_{v}_tower_l"] = tw.crop((0, 0, 16, 16))
        out[f"ch_{v}_tower_r"] = tw.crop((16, 0, 32, 16))

        # -- wall courses: l/m/r plus the foundation course -------------------
        for kind in ("wall", "wallb"):
            strip = big_img(48, 16)
            wall_bg(strip, v, 0, 0, 47, 15)
            if kind == "wallb":  # stone plinth grounds the building
                brect(strip, 0, 12, 47, 12, t["shade"])
                brect(strip, 0, 13, 47, 14, GRAY if v == "cw" else t["shade"])
                brect(strip, 0, 14, 47, 14, CJOINT if v == "cw" else t["line"])
                brect(strip, 0, 15, 47, 15, K)
            edge_boards(strip, v, 0, 15)
            out[f"ch_{v}_{kind}_l"] = strip.crop((0, 0, 16, 16))
            out[f"ch_{v}_{kind}_m"] = strip.crop((16, 0, 32, 16))
            out[f"ch_{v}_{kind}_r"] = strip.crop((32, 0, 48, 16))

        # -- lancet window (16x32, on wall bg) ---------------------------------
        ln = big_img(16, 32)
        wall_bg(ln, v, 0, 0, 15, 31)
        bpx(ln, 7, 2, K)  # pointed arch outline
        bpx(ln, 8, 2, K)
        bpx(ln, 6, 3, K)
        bpx(ln, 9, 3, K)
        bpx(ln, 5, 4, K)
        bpx(ln, 10, 4, K)
        brect(ln, 4, 5, 4, 25, K)
        brect(ln, 11, 5, 11, 25, K)
        brect(ln, 7, 3, 8, 3, TEAL)  # glass
        brect(ln, 6, 4, 9, 4, TEAL)
        brect(ln, 5, 5, 10, 21, TEAL)
        brect(ln, 5, 22, 10, 25, TEAL_D)
        brect(ln, 5, 14, 10, 14, WHITE)  # transom bar
        for i in range(3):  # sparkle
            bpx(ln, 6 + i, 10 - i, WHITE)
            bpx(ln, 7 + i, 10 - i, WHITE)
        brect(ln, 4, 26, 11, 26, K)
        brect(ln, 3, 27, 12, 27, t["trim"])  # sill
        brect(ln, 3, 28, 12, 28, t["shade"])
        out[f"ch_{v}_lan_t"] = ln.crop((0, 0, 16, 16))
        out[f"ch_{v}_lan_b"] = ln.crop((0, 16, 16, 32))

        # -- arched double door (32x32, on wall bg + foundation) ---------------
        dr = big_img(32, 32)
        wall_bg(dr, v, 0, 0, 31, 31)
        brect(dr, 0, 27, 31, 27, t["shade"])  # foundation continues
        brect(dr, 0, 28, 31, 29, GRAY if v == "cw" else t["shade"])
        brect(dr, 0, 30, 31, 30, CJOINT if v == "cw" else t["line"])
        brect(dr, 0, 31, 31, 31, K)
        # arch outline
        brect(dr, 13, 2, 18, 2, K)
        brect(dr, 10, 3, 12, 3, K)
        brect(dr, 19, 3, 21, 3, K)
        brect(dr, 8, 4, 9, 4, K)
        brect(dr, 22, 4, 23, 4, K)
        brect(dr, 7, 5, 7, 26, K)
        brect(dr, 24, 5, 24, 26, K)
        # fanlight over the transom
        brect(dr, 13, 3, 18, 3, TEAL)
        brect(dr, 10, 4, 21, 4, TEAL)
        brect(dr, 8, 5, 23, 8, TEAL)
        for x in (12, 15, 16, 19):  # radial muntins
            bpx(dr, x, 5, WHITE)
        brect(dr, 15, 6, 16, 8, WHITE)
        brect(dr, 8, 9, 23, 9, K)  # transom bar
        # double wooden doors with plank lines + gold handles
        brect(dr, 8, 10, 23, 25, WOOD)
        for x in (10, 13, 18, 21):
            brect(dr, x, 10, x, 25, WOOD_D)
        brect(dr, 15, 10, 16, 25, K)  # center stile
        brect(dr, 8, 11, 23, 11, WOOD_D)
        bpx(dr, 14, 17, GOLD)
        bpx(dr, 14, 18, GOLD)
        bpx(dr, 17, 17, GOLD)
        bpx(dr, 17, 18, GOLD)
        brect(dr, 8, 26, 23, 26, K)  # threshold
        brect(dr, 6, 27, 25, 27, CURB_HI)  # stone step
        brect(dr, 6, 28, 25, 28, CURB_MID)
        out[f"ch_{v}_door_tl"] = dr.crop((0, 0, 16, 16))
        out[f"ch_{v}_door_tr"] = dr.crop((16, 0, 32, 16))
        out[f"ch_{v}_door_bl"] = dr.crop((0, 16, 16, 32))
        out[f"ch_{v}_door_br"] = dr.crop((16, 16, 32, 32))

    return out


# ===========================================================================
# Rows 17-29: shadows, litter, ground blobs, vehicles, hedge, street /
# suburb kits and set-pieces
# ===========================================================================

BAYER4 = ((0, 8, 2, 10), (12, 4, 14, 6), (3, 11, 1, 9), (15, 7, 13, 5))

# kit tones (intents; opaque pixels snap to the rpg palette at save time)
TYRE = (102, 89, 89)
HEADLIGHT = (247, 215, 89)
GLASS_HI = (255, 255, 255)
#: car body colorways: base / highlight / shade
CAR_TONES: dict[str, tuple[tuple[int, int, int], ...]] = {
    "red": ((181, 64, 67), (224, 103, 86), (140, 26, 40)),
    "blue": ((83, 78, 157), (107, 110, 174), (57, 53, 108)),
    "white": ((255, 249, 234), (255, 255, 255), (204, 217, 206)),
    "silver": ((159, 165, 176), (191, 191, 191), (118, 121, 129)),
    "green": ((69, 138, 79), (127, 173, 110), (50, 74, 48)),
}
PICKUP_TONES = ((204, 156, 84), (238, 204, 125), (183, 149, 67))
BUS_TONES = ((255, 249, 234), (255, 255, 255), (204, 217, 206))
BUS_BLUE = (83, 78, 157)
BUS_NAVY = (57, 53, 108)
ROOF_PANEL = (200, 200, 191)
SCHOOL_TONES = ((248, 200, 72), (247, 215, 89), (255, 171, 61))
STEEL = (159, 165, 176)  # galvanized posts, signal heads
STEEL_D = (118, 121, 129)
STEEL_HI = (191, 191, 191)
MESH = (191, 191, 191, 190)  # chain-link lattice (translucent, see-through)
# Foliage deliberately reuses the rpg canopy greens so the seasons LUT
# (scripts/mapgen/seasons.py) recolours hedges along with the trees; every
# other green below is chosen OFF the LUT's key colours so signs, lamps and
# car paint stay put through the year.
HEDGE_HI = (140, 189, 74)
HEDGE_BASE = (86, 141, 68)
HEDGE_D = (61, 108, 67)
HEDGE_DD = (54, 74, 76)
SIGN_GREEN = (39, 96, 85)
BLADE_GREEN = (55, 128, 60)
SIGN_WHITE = (255, 249, 234)
LAMP_RED = (224, 103, 86)
LAMP_RED_OFF = (143, 87, 70)
LAMP_AMBER_OFF = (140, 119, 74)
LAMP_GREEN = (85, 196, 0)
LAMP_GREEN_OFF = (50, 74, 48)
SIGNAL_BODY = (102, 89, 89)
WATER = (76, 150, 190)
WATER_HI = (126, 215, 255)
WATER_RIPPLE = (164, 211, 255)
MULCH = ((98, 53, 28), (98, 53, 28), (98, 53, 28), (117, 80, 45), (117, 80, 45), (75, 43, 19))
MULCH_CHIP = (154, 111, 55)
DIRT = (195, 151, 83)
DIRT_SPECK = (154, 111, 55)
DIRT_DARK = (117, 80, 45)
LEAF_TONES = ((231, 124, 61), (204, 156, 84), (193, 85, 71), (227, 198, 84), (210, 92, 53))
CLOVER = (55, 128, 60)
CLOVER_HI = (80, 143, 58)
GRASS_MAIN = (100, 209, 76)  # the R.GRASS fill's dominant blade colour
GRASS_BLADE_D = (80, 193, 64)


def _ordered(x: int, y: int, coverage: float) -> bool:
    """True where a 4x4 Bayer ordered dither of ``coverage`` (0..1) is on."""
    return BAYER4[y % 4][x % 4] < coverage * 16


def _ground_shadow(p) -> None:
    """Deepen a prop's flat ``SHADOW`` row into a 2 px ordered-dither contact
    shadow: the row at the base goes solid-dark, the row beneath it becomes
    a 50% checker. Only translucent / transparent pixels are touched, so an
    existing prop keeps its opaque silhouette pixel for pixel."""
    px = p.img.load()
    w, h = p.img.size
    base = [(x, y) for y in range(h) for x in range(w) if px[x, y] == SHADOW]
    for x, y in base:
        px[x, y] = GROUND_SHADOW
    for x, y in base:
        if y + 1 < h and px[x, y + 1][3] == 0 and (x + y) % 2 == 0:
            px[x, y + 1] = GROUND_SHADOW


def _cool_dark(c: tuple[int, int, int]) -> tuple[int, int, int]:
    """GRASS_DARK recolour: ~12% darker and cooler than the sampled grass."""
    r, g, b = c
    return (min(255, round(r * 0.80)), min(255, round(g * 0.88)), min(255, round(b * 1.05)))


class _Big:
    """A ``tw x th``-tile RGBA composite with the Painter vocabulary; crop
    it into 16 px tiles with :meth:`tiles`."""

    def __init__(self, tw: int, th: int) -> None:
        from PIL import Image

        self.img = Image.new("RGBA", (tw * T, th * T), (0, 0, 0, 0))
        self.pix = self.img.load()

    @property
    def size(self) -> tuple[int, int]:
        return self.img.size

    def get(self, x: int, y: int):
        if 0 <= x < self.img.width and 0 <= y < self.img.height:
            return self.pix[x, y]
        return (0, 0, 0, 0)

    def px(self, x: int, y: int, c) -> None:
        if 0 <= x < self.img.width and 0 <= y < self.img.height:
            self.pix[x, y] = c if len(c) == 4 else (*c, 255)

    def rect(self, x0, y0, x1, y1, c) -> None:
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.px(x, y, c)

    def outline_rect(self, x0, y0, x1, y1, c=K, chamfer: bool = True) -> None:
        """1 px outline; ``chamfer`` leaves the four corner pixels empty."""
        for x in range(x0, x1 + 1):
            self.px(x, y0, c)
            self.px(x, y1, c)
        for y in range(y0, y1 + 1):
            self.px(x0, y, c)
            self.px(x1, y, c)
        if chamfer:
            for x, y in ((x0, y0), (x1, y0), (x0, y1), (x1, y1)):
                self.px(x, y, (0, 0, 0, 0))

    def grid(self, art: list[str], cmap: dict[str, tuple], ox: int = 0, oy: int = 0) -> None:
        for y, row in enumerate(art):
            for x, ch in enumerate(row):
                if ch in cmap:
                    self.px(ox + x, oy + y, cmap[ch])

    def noise(self, rng, x0, y0, x1, y1, tones, speck=None, speck_p=0.04) -> None:
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                c = rng.choice(tones)
                if speck and rng.random() < speck_p:
                    c = speck
                self.px(x, y, c)

    def shadow_rows(self, x0: int, x1: int, y: int) -> None:
        """2 px ordered-dither contact shadow: solid row ``y``, checker below."""
        for x in range(x0, x1 + 1):
            if self.get(x, y)[3] == 0:
                self.px(x, y, GROUND_SHADOW)
            if (x + y + 1) % 2 == 0 and self.get(x, y + 1)[3] == 0:
                self.px(x, y + 1, GROUND_SHADOW)

    def tiles(self, names: list[list[str]]) -> dict[str, object]:
        out: dict[str, object] = {}
        for r, row in enumerate(names):
            for c, n in enumerate(row):
                if n:
                    out[n] = self.img.crop((c * T, r * T, (c + 1) * T, (r + 1) * T))
        return out


def _rpg_tile(g: int):
    """The 16x16 RGBA tile at rpg GID ``g`` (cached sheet)."""
    from PIL import Image

    global _RPG_SHEET
    try:
        sheet = _RPG_SHEET
    except NameError:
        sheet = _RPG_SHEET = Image.open(RPG_TILESET).convert("RGBA")
    row, col = (g - 1) // 100, (g - 1) % 100
    return sheet.crop((col * T, row * T, (col + 1) * T, (row + 1) * T))


def _depth(piece: str, x: int, y: int) -> float:
    """How far (px) a pixel centre sits INSIDE a blob piece's material, for
    the 4 px dither band: <= 0 is outside, >= 4 is solid. Convex corners
    are rounded (r=5, like ``_round_cut``); ``hole_*`` fillets mirror
    ``_fillet``: material only in the named corner."""
    cx, cy = x + 0.5, y + 0.5
    if piece == "fill":
        return 99.0
    if piece in ("n", "s", "w", "e"):
        return {"n": cy, "s": 16 - cy, "w": cx, "e": 16 - cx}[piece]
    if piece.startswith("hole_"):
        ox, oy = {"nw": (0, 0), "ne": (16, 0), "sw": (0, 16), "se": (16, 16)}[piece[5:]]
        return 7.0 - math.hypot(cx - ox, cy - oy)
    # convex corner: distance to the two open edges, rounded near the tip
    dx = cx if piece[1] == "w" else 16 - cx
    dy = cy if piece[0] == "n" else 16 - cy
    r = 5.0
    if dx < r and dy < r:
        return r - math.hypot(r - dx, r - dy)
    return min(dx, dy)


_BLOB_KINDS = (
    "nw",
    "n",
    "ne",
    "w",
    "e",
    "sw",
    "s",
    "se",
    "hole_nw",
    "hole_ne",
    "hole_sw",
    "hole_se",
)


def _dither_blob(prefix: str, inside, outside, holes: bool) -> dict[str, object]:
    """Paint a ground autotile whose edges are 4 px ordered-dither
    transitions from ``inside(name, x, y)`` (the material) to
    ``outside(name, x, y)`` (the surrounding R.GRASS pixels)."""
    from PIL import Image

    out: dict[str, object] = {}
    kinds = ["fill"] * 4 + list(_BLOB_KINDS if holes else _BLOB_KINDS[:8])
    for i, kind in enumerate(kinds):
        name = f"{prefix}_{i}" if kind == "fill" else f"{prefix}_{kind}"
        rng = random.Random(_stable_seed(name))
        img = Image.new("RGBA", (T, T), (0, 0, 0, 0))
        px = img.load()
        for y in range(T):
            for x in range(T):
                d = _depth(kind, x, y) + rng.uniform(-0.45, 0.45)
                if _ordered(x, y, max(0.0, min(1.0, d / 4.0))):
                    px[x, y] = (*inside(name, x, y), 255)
                else:
                    px[x, y] = (*outside(name, x, y), 255)
        out[name] = img
    return out


def _ground_blobs() -> dict[str, object]:
    """GRASS_DARK and WORN, both blended into the real R.GRASS texture."""
    from mapgen import tiles as R

    grass = {g: _rpg_tile(g).load() for g in R.GRASS.fill}

    def grass_px(name: str, x: int, y: int) -> tuple[int, int, int]:
        g = R.GRASS.fill[_stable_seed(name) % len(R.GRASS.fill)]
        return grass[g][x, y][:3]

    def dark_px(name: str, x: int, y: int) -> tuple[int, int, int]:
        return _cool_dark(grass_px(name, x, y))

    out = _dither_blob("gd", dark_px, grass_px, holes=True)

    # trodden dirt: the DIRT_TAN_SPECKLED mix (4% speck, ~1% dark) plus a
    # few surviving grass tufts, drawn as 2 px pairs so they read as blades
    dirt_cache: dict[str, dict] = {}

    def dirt_px(name: str, x: int, y: int) -> tuple[int, int, int]:
        if name not in dirt_cache:
            rng = random.Random(_stable_seed(name + "/dirt"))
            tex = {}
            for yy in range(T):
                for xx in range(T):
                    roll = rng.random()
                    tex[(xx, yy)] = (
                        DIRT_DARK if roll < 0.01 else DIRT_SPECK if roll < 0.05 else DIRT
                    )
            for _ in range(rng.randrange(3, 6)):
                tx, ty = rng.randrange(1, T - 1), rng.randrange(1, T - 1)
                tex[(tx, ty)] = GRASS_MAIN
                tex[(tx + rng.choice((-1, 1)), ty)] = GRASS_BLADE_D
            dirt_cache[name] = tex
        return dirt_cache[name][(x, y)]

    out.update(_dither_blob("worn", dirt_px, grass_px, holes=False))
    return out


def _shadow_and_litter() -> dict[str, object]:
    out: dict[str, object] = {}

    def make(name: str, fn) -> None:
        p = Painter()
        fn(p)
        out[name] = p.img

    def sh(p, keep) -> None:
        for y in range(T):
            for x in range(T):
                if keep(x, y):
                    p.px(x, y, SHADOW_TILE)

    make("sh_full", lambda p: sh(p, lambda x, y: True))
    make("sh_fade_n", lambda p: sh(p, lambda x, y: y >= 2 or (x + y) % 2 == 0))
    make("sh_fade_w", lambda p: sh(p, lambda x, y: x >= 2 or (x + y) % 2 == 0))
    make(
        "sh_corner",
        lambda p: sh(
            p, lambda x, y: x >= 8 and y >= 8 and ((x >= 10 and y >= 10) or (x + y) % 2 == 0)
        ),
    )

    clover = ["cc.cc", "cCcCc", ".ccc.", ".cCc.", "..cc."]
    cmap = {"c": CLOVER, "C": CLOVER_HI}

    def clover_a(p):
        p.grid(clover, cmap, 1, 2)
        p.grid(clover, cmap, 9, 9)

    def clover_b(p):
        p.grid(clover, cmap, 8, 1)
        p.grid(clover, cmap, 2, 8)
        p.grid(["cc", "cC"], cmap, 12, 12)

    make("clover_a", clover_a)
    make("clover_b", clover_b)

    def leaves(p, seed: int) -> None:
        rng = random.Random(seed)
        spots = set()
        while len(spots) < 5:
            x, y = rng.randrange(0, 13), rng.randrange(0, 14)
            if all(abs(x - sx) > 2 or abs(y - sy) > 1 for sx, sy in spots):
                spots.add((x, y))
        for i, (x, y) in enumerate(sorted(spots)):
            tone = LEAF_TONES[(seed + i) % len(LEAF_TONES)]
            shape = rng.choice((["oxx", "xxo"], ["xxo", "oxx"], ["xx.", "oxx"], [".xo", "xxo"]))
            p.grid(shape, {"x": tone, "o": DIRT_DARK}, x, y)

    make("litter_a", lambda p: leaves(p, 174))
    make("litter_b", lambda p: leaves(p, 175))

    for i, name in enumerate(("mulch_a", "mulch_b")):
        rng = random.Random(176 + i)
        make(
            name,
            lambda p, rng=rng: p.noise(rng, 0, 0, 15, 15, MULCH, speck=MULCH_CHIP, speck_p=0.06),
        )
    return out


def _vehicle(kind: str, tones, orient: str, names: list[list[str]]) -> dict[str, object]:
    """Paint one top-down vehicle. Car space runs along +u (east = front)
    with v across the body; ``orient`` 'v' transposes it to face south.
    ``names`` is the tile grid of the composite (rows of ids)."""
    from PIL import Image

    base, hi, dark = tones
    if kind in ("car", "pickup"):
        L, Wd = 28, 10
    else:
        L, Wd = 44, 11
    VO = 2  # stub rows above the body
    cs = Image.new("RGBA", (L, Wd + 2 * VO), (0, 0, 0, 0))
    pix = cs.load()

    def put(u, v, c):
        if 0 <= u < L and 0 <= v + VO < cs.height:
            pix[u, v + VO] = c if len(c) == 4 else (*c, 255)

    def get(u, v):
        return pix[u, v + VO][:3] if 0 <= u < L and 0 <= v + VO < cs.height else None

    def prect(u0, v0, u1, v1, c):
        for v in range(v0, v1 + 1):
            for u in range(u0, u1 + 1):
                put(u, v, c)

    def outline(u0, v0, u1, v1):
        for u in range(u0, u1 + 1):
            put(u, v0, K)
            put(u, v1, K)
        for v in range(v0, v1 + 1):
            put(u0, v, K)
            put(u1, v, K)
        for u, v in ((u0, v0), (u1, v0), (u0, v1), (u1, v1)):
            put(u, v, (0, 0, 0, 0))

    def glass(u0, v0, u1, v1, sparkle=True):
        prect(u0, v0, u1, v1, TEAL)
        prect(u0, v1, u1, v1, TEAL_D)
        if sparkle:
            put(u0, v0, GLASS_HI)

    def stubs(*axles):
        for a in axles:
            for row in (-2, -1, Wd, Wd + 1):
                put(a, row, K)
                put(a + 1, row, TYRE)
                put(a + 2, row, TYRE)
                put(a + 3, row, K)

    if kind == "car":
        outline(0, 0, L - 1, Wd - 1)
        prect(1, 1, L - 2, Wd - 2, base)
        outline(8, 2, 21, 7)
        glass(9, 3, 10, 6, sparkle=False)
        prect(11, 3, 17, 6, hi)
        glass(18, 3, 20, 6)
        for v in (2, 7):
            put(1, v, RED_HI)
            put(L - 2, v, HEADLIGHT)
        stubs(3, 21)
    elif kind == "pickup":
        outline(0, 0, L - 1, Wd - 1)
        prect(1, 1, L - 2, Wd - 2, base)
        outline(13, 2, 21, 7)
        glass(14, 3, 14, 6, sparkle=False)
        prect(15, 3, 17, 6, hi)
        glass(18, 3, 20, 6)
        outline(2, 2, 12, 7)
        prect(3, 3, 11, 6, A1)
        prect(3, 4, 11, 4, ADARK)
        prect(3, 6, 11, 6, ADARK)
        for v in (2, 7):
            put(1, v, RED_HI)
            put(L - 2, v, HEADLIGHT)
        stubs(3, 21)
    elif kind == "bus":
        outline(0, 0, L - 1, Wd - 1)
        prect(1, 1, L - 2, Wd - 2, base)
        prect(6, 3, 37, 5, ROOF_PANEL)
        prect(20, 3, 23, 5, STEEL)
        for u in range(4, 38):
            put(u, 7, base if (u - 4) % 4 == 3 else TEAL)
        prect(1, 8, 38, 8, BUS_BLUE)
        prect(1, 9, 38, 9, BUS_NAVY)
        prect(39, 1, 39, 9, K)
        glass(40, 1, 42, 9)
        put(42, 1, HEADLIGHT)
        put(42, 9, HEADLIGHT)
        prect(1, 2, 2, 8, STEEL)
        put(1, 1, RED_HI)
        put(1, 9, RED_HI)
        stubs(6, 32)
    elif kind == "schoolbus":
        outline(0, 0, 37, Wd - 1)
        prect(1, 1, 36, Wd - 2, base)
        outline(37, 1, L - 1, Wd - 2)
        prect(38, 2, L - 2, Wd - 3, base)
        prect(38, 2, L - 2, 2, hi)
        prect(38, Wd - 3, L - 2, Wd - 3, dark)
        for u in range(4, 33):
            put(u, 7, K if (u - 4) % 4 == 3 else TEAL)
        prect(1, 8, 36, 8, K)
        prect(1, 9, 36, 9, dark)
        prect(33, 1, 33, 9, K)
        glass(34, 1, 36, 9)
        prect(L - 2, 4, L - 2, 6, K)
        put(L - 2, 3, HEADLIGHT)
        put(L - 2, 7, HEADLIGHT)
        put(1, 2, RED_HI)
        put(1, 8, RED_HI)
        stubs(6, 28)
    else:
        raise ValueError(kind)

    # lighting: the north-most body row catches light, the south-most falls
    # into shade — whichever end that is once the vehicle is oriented
    if orient == "h":
        for u in range(1, L - 1):
            if get(u, 1) == base:
                put(u, 1, hi)
            if get(u, Wd - 2) == base:
                put(u, Wd - 2, dark)
    else:
        for v in range(1, Wd - 1):
            if get(1, v) == base:
                put(1, v, hi)
            if get(L - 2, v) == base:
                put(L - 2, v, dark)

    if orient == "v":
        cs = cs.transpose(Image.Transpose.TRANSPOSE)
    big = _Big(len(names[0]), len(names))
    if orient == "h":
        big.img.alpha_composite(cs, (2, 0))
        y = cs.height
        if y + 1 < big.size[1]:
            big.shadow_rows(3, 2 + L - 1 - 1, y)
        else:
            for x in range(3, 2 + L - 2):
                big.px(x, y, GROUND_SHADOW)
    else:
        ox = (big.size[0] - cs.width) // 2
        big.img.alpha_composite(cs, (ox, 2))
        big.shadow_rows(ox + VO + 1, ox + VO + Wd - 2, 2 + L)
    return big.tiles(names)


def _vehicles() -> dict[str, object]:
    out: dict[str, object] = {}
    for c in CAR_COLORS:
        out.update(_vehicle("car", CAR_TONES[c], "h", [[f"car_{c}_h_b", f"car_{c}_h_a"]]))
        out.update(_vehicle("car", CAR_TONES[c], "v", [[f"car_{c}_v_b"], [f"car_{c}_v_a"]]))
    out.update(_vehicle("pickup", PICKUP_TONES, "h", [["pickup_h_b", "pickup_h_a"]]))
    out.update(_vehicle("pickup", PICKUP_TONES, "v", [["pickup_v_b"], ["pickup_v_a"]]))
    out.update(_vehicle("bus", BUS_TONES, "h", [["bus_h_c", "bus_h_b", "bus_h_a"]]))
    out.update(_vehicle("bus", BUS_TONES, "v", [["bus_v_c"], ["bus_v_b"], ["bus_v_a"]]))
    out.update(
        _vehicle(
            "schoolbus", SCHOOL_TONES, "h", [["schoolbus_h_c", "schoolbus_h_b", "schoolbus_h_a"]]
        )
    )
    return out


def _hedge_tiles() -> dict[str, object]:
    """Hedge pieces from a mask: each piece is drawn on a 3x3-tile canvas
    with its runs extended into the neighbour tiles, outlined automatically
    (mask pixels touching non-mask), shaded by distance to the mask's
    north / south / side boundaries, then the centre tile is cropped."""
    pieces = {
        "hedge_h": "we",
        "hedge_v": "ns",
        "hedge_end_w": "e",
        "hedge_end_e": "w",
        "hedge_end_n": "s",
        "hedge_end_s": "n",
        "hedge_nw": "es",
        "hedge_ne": "ws",
        "hedge_sw": "en",
        "hedge_se": "wn",
    }
    out: dict[str, object] = {}
    OFF = 16  # centre tile offset on the 48x48 canvas
    LO, HI = OFF + 3, OFF + 12  # band extent inside the centre tile (10 px)
    for name, runs in pieces.items():
        rng = random.Random(_stable_seed(name))
        mask: set[tuple[int, int]] = set()
        if "w" in runs or "e" in runs:
            x0 = 0 if "w" in runs else LO
            x1 = 47 if "e" in runs else HI
            mask |= {(x, y) for x in range(x0, x1 + 1) for y in range(LO, HI + 1)}
        if "n" in runs or "s" in runs:
            y0 = 0 if "n" in runs else LO
            y1 = 47 if "s" in runs else HI
            mask |= {(x, y) for y in range(y0, y1 + 1) for x in range(LO, HI + 1)}
        # round every free corner of the silhouette (caps and outer corners)
        for x, y in list(mask):
            free = sum(
                (x + dx, y + dy) not in mask for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
            )
            if free >= 2:
                mask.discard((x, y))
        big = _Big(3, 3)

        def inside(x, y, mask=mask):
            if not (0 <= x < 48 and 0 <= y < 48):
                return True  # runs continue off-canvas
            return (x, y) in mask

        def run(x, y, dx, dy):
            n = 0
            while inside(x + dx * (n + 1), y + dy * (n + 1)) and n < 20:
                n += 1
            return n

        for x, y in mask:
            if not all(inside(x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                big.px(x, y, K)
                continue
            dn, ds = run(x, y, 0, -1), run(x, y, 0, 1)
            dw, de = run(x, y, -1, 0), run(x, y, 1, 0)
            if dn <= 2:
                tones = (HEDGE_HI, HEDGE_HI, HEDGE_BASE)
            elif ds <= 2:
                tones = (HEDGE_D, HEDGE_D, HEDGE_DD, HEDGE_BASE)
            elif dw <= 1 or de <= 1:
                tones = (HEDGE_BASE, HEDGE_D)
            else:
                tones = (HEDGE_BASE, HEDGE_BASE, HEDGE_BASE, HEDGE_HI, HEDGE_D)
            big.px(x, y, rng.choice(tones))
        # SE contact shadow: solid strip, then a checker strip
        for y in range(48):
            for x in range(48):
                if (x, y) in mask:
                    continue
                if (x, y - 1) in mask or (x - 1, y) in mask:
                    big.px(x, y, GROUND_SHADOW)
                elif ((x, y - 2) in mask or (x - 2, y) in mask) and (x + y) % 2 == 0:
                    big.px(x, y, GROUND_SHADOW)
        out[name] = big.img.crop((OFF, OFF, OFF + T, OFF + T))
    return out


def _street_and_suburb() -> dict[str, object]:
    out: dict[str, object] = {}

    def make(name: str, fn, shadow: bool = True) -> None:
        p = Painter()
        fn(p)
        if shadow:
            _ground_shadow(p)
        out[name] = p.img

    post = {"o": K, "g": STEEL, "d": STEEL_D, "s": SHADOW}
    POST_ROW = "......ogdo......"

    # -- utility pole + wires ------------------------------------------------
    def pole_top(p):
        p.grid(
            [
                "...oo......oo...",
                "...hh......hh...",
                ".oooooooooooooo.",
                ".owwwwwwwwwwwwo.",
                ".oddddddddddddo.",
                ".oooooooooooooo.",
            ]
            + ["......owdo......"] * 10,
            {"o": K, "w": WOOD, "d": WOOD_D, "h": (204, 217, 206)},
        )
        for x in (0, 1, 2, 13, 14, 15):  # wire stubs meet the insulators
            p.px(x, 1, WIRE)

    make("pole_top", pole_top, shadow=False)
    make(
        "pole_base",
        lambda p: p.grid(
            ["......owdo......"] * 13 + [".....oooooo.....", "....ssssssss...."],
            {"o": K, "w": WOOD, "d": WOOD_D, "s": SHADOW},
        ),
    )
    make("wire_h", lambda p: [p.px(x, 1, WIRE) for x in range(T)], shadow=False)
    make("wire_v", lambda p: [p.px(x, y, WIRE) for x in (3, 12) for y in range(T)], shadow=False)

    # -- traffic signal ---------------------------------------------------------
    def signal(p, lit: str):
        red = LAMP_RED if lit == "red" else LAMP_RED_OFF
        green = LAMP_GREEN if lit == "green" else LAMP_GREEN_OFF
        p.grid(
            [
                ".....oooooo.....",
                ".....obbbbo.....",
                ".....obRRbo.....",
                ".....obRRbo.....",
                ".....obbbbo.....",
                ".....obAAbo.....",
                ".....obAAbo.....",
                ".....obbbbo.....",
                ".....obGGbo.....",
                ".....obGGbo.....",
                ".....obbbbo.....",
                ".....oooooo.....",
            ]
            + [POST_ROW] * 4,
            {**post, "b": SIGNAL_BODY, "R": red, "A": LAMP_AMBER_OFF, "G": green},
        )
        lx, ly = (7, 2) if lit == "red" else (7, 8)
        p.px(lx, ly, (255, 231, 213))

    make("signal_red", lambda p: signal(p, "red"), shadow=False)
    make("signal_green", lambda p: signal(p, "green"), shadow=False)
    make(
        "signal_pole",
        lambda p: p.grid([POST_ROW] * 13 + [".....oooooo.....", "....ssssssss...."], post),
    )

    # -- stop sign, shared sign post, street-name blade ------------------------
    def stop_top(p):
        cx, cy = 7, 5
        octo = {
            (x, y)
            for y in range(T)
            for x in range(T)
            if abs(x - cx) <= 4 and abs(y - cy) <= 4 and abs(x - cx) + abs(y - cy) <= 6
        }
        for x, y in octo:
            edge = any(
                (x + dx, y + dy) not in octo for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
            )
            ring = any(
                (x + dx, y + dy) not in octo
                for dx, dy in ((2, 0), (-2, 0), (0, 2), (0, -2), (1, 1), (-1, 1), (1, -1), (-1, -1))
            )
            p.px(x, y, K if edge else SIGN_WHITE if ring else RED)
        for x in range(5, 10):
            p.px(x, cy, SIGN_WHITE)
        p.grid([POST_ROW] * 6, post, 0, 10)

    make("stop_top", stop_top, shadow=False)
    make(
        "sign_post",
        lambda p: p.grid([POST_ROW] * 13 + [".....oooooo.....", "....ssssssss...."], post),
    )

    def blade_top(p):
        p.rect(2, 2, 13, 6, K)
        p.rect(3, 3, 12, 5, BLADE_GREEN)
        p.rect(5, 4, 10, 4, SIGN_WHITE)
        p.grid([POST_ROW] * 9, post, 0, 7)

    make("blade_top", blade_top, shadow=False)

    # -- suburb kit ------------------------------------------------------------
    make(
        "steps",
        lambda p: p.grid(
            [
                "....oooooooo....",
                "....ohhhhhho....",
                "....ommmmmmo....",
                "..oooooooooooo..",
                "..ohhhhhhhhhho..",
                "..ommmmmmmmmmo..",
                "..oooooooooooo..",
                "..ssssssssssss..",
            ],
            {"o": K, "h": CURB_HI, "m": CURB_MID, "s": SHADOW},
            0,
            7,
        ),
    )
    make(
        "house_num",
        lambda p: p.grid(
            [".....oooooo.....", ".....oWWWWo.....", ".....oWkWko.....", ".....oooooo....."],
            {"o": K, "W": SIGN_WHITE, "k": K},
            0,
            6,
        ),
        shadow=False,
    )
    make(
        "ac_window",
        lambda p: p.grid(
            [
                "....oooooooo....",
                "....ohhhhhho....",
                "....oglglglo....",
                "....oglglglo....",
                "....oggggggo....",
                "....oooooooo....",
                "....ssssssss....",
            ],
            {"o": K, "h": STEEL_HI, "g": STEEL, "l": STEEL_D, "s": SHADOW},
            0,
            5,
        ),
        shadow=False,
    )
    return out


def _garage_and_shed() -> dict[str, object]:
    out: dict[str, object] = {}

    # -- 2x2 panelled garage door: opaque stone surround like WINDOW ----------
    g = _Big(2, 2)
    g.rect(0, 0, 31, 31, CURB_MID)
    g.rect(1, 1, 30, 2, CURB_HI)
    g.outline_rect(0, 0, 31, 31, K, chamfer=False)
    g.rect(3, 3, 28, 28, K)
    g.rect(4, 4, 27, 27, SIGN_WHITE)
    for y in (10, 16, 22):
        g.rect(4, y, 27, y, CJOINT)
        g.rect(4, y + 1, 27, y + 1, CURB_HI)
    for x0 in (6, 12, 18, 24):
        g.rect(x0, 5, x0 + 2, 8, TEAL)
        g.rect(x0, 8, x0 + 2, 8, TEAL_D)
        g.px(x0, 5, GLASS_HI)
    g.rect(15, 25, 16, 26, K)
    g.rect(1, 29, 30, 30, CJOINT)
    out.update(
        g.tiles([["garage_door_tl", "garage_door_tr"], ["garage_door_bl", "garage_door_br"]])
    )

    # -- 2x2 clapboard shed with a cedar shingle roof ----------------------
    s = _Big(2, 2)
    t = SHINGLE_TONES["cedar"]
    for y in range(1, 12):
        yy = y - 1
        cy, course = yy % 4, yy // 4
        joint = 0 if course % 2 == 0 else 4
        for x in range(32):
            at_joint = (x + joint) % 8 == 0
            if cy == 0:
                c = t["base"] if at_joint else t["hi"]
            elif cy == 3:
                c = t["line"]
            else:
                c = t["dark"] if at_joint else t["base"]
            s.px(x, y, c)
    s.rect(0, 0, 31, 0, K)
    s.rect(0, 12, 31, 12, t["line"])
    s.rect(0, 13, 31, 13, K)
    s.rect(0, 1, 0, 12, K)
    s.rect(31, 1, 31, 12, K)
    cw = CHURCH_TONES["cw"]
    for y in range(14, 30):
        for x in range(2, 30):
            s.px(x, y, cw["line"] if y % 4 == 1 else cw["fill"])
    s.rect(3, 14, 28, 14, cw["shade"])
    s.rect(2, 14, 2, 30, K)
    s.rect(3, 15, 3, 29, cw["trim"])
    s.rect(28, 15, 28, 29, cw["shade"])
    s.rect(29, 14, 29, 30, K)
    s.rect(12, 19, 19, 29, K)
    s.rect(13, 20, 18, 29, WOOD)
    for x in (15, 16):
        s.rect(x, 20, x, 29, WOOD_D)
    s.px(17, 25, K)
    s.rect(2, 30, 29, 30, K)
    s.shadow_rows(3, 30, 31)
    out.update(s.tiles([["shed_tl", "shed_tr"], ["shed_bl", "shed_br"]]))
    return out


def _set_pieces() -> dict[str, object]:
    out: dict[str, object] = {}

    # -- glass bus shelter 3x2 -------------------------------------------------
    b = _Big(3, 2)
    b.outline_rect(1, 1, 46, 7, K)
    b.rect(2, 2, 45, 6, STEEL_HI)
    b.rect(2, 2, 45, 2, ROOF_PANEL)
    b.rect(2, 6, 45, 6, STEEL)
    for x0 in (1, 22, 43):  # posts
        b.rect(x0, 8, x0 + 3, 27, K)
        b.rect(x0 + 1, 8, x0 + 1, 27, STEEL)
        b.rect(x0 + 2, 8, x0 + 2, 27, STEEL_D)
    for x0, x1 in ((5, 21), (26, 42)):  # glass back panels
        b.rect(x0, 8, x1, 19, TEAL)
        b.rect(x0, 17, x1, 19, TEAL_D)
        b.rect(x0, 20, x1, 20, K)
        for i in range(4):
            b.px(x0 + 2 + i, 13 - i, GLASS_HI)
            b.px(x0 + 3 + i, 13 - i, GLASS_HI)
    b.outline_rect(8, 21, 39, 24, K)
    b.rect(9, 22, 38, 22, WOOD)
    b.rect(9, 23, 38, 23, WOOD_D)
    for x0 in (9, 37):
        b.rect(x0, 25, x0 + 1, 26, K)
    b.shadow_rows(2, 45, 28)
    out.update(b.tiles([[f"shelter_0{c}" for c in range(3)], [f"shelter_1{c}" for c in range(3)]]))

    # -- chain-link backstop 3x2 ----------------------------------------------
    k = _Big(3, 2)
    for y in range(3, 26):
        for x in range(4, 44):
            if (x + y) % 4 == 0 or (x - y) % 4 == 0:
                k.px(x, y, MESH)
    for x0 in (1, 22, 44):
        k.rect(x0, 1, x0 + 2, 27, K)
        k.rect(x0 + 1, 2, x0 + 1, 26, STEEL)
    k.rect(1, 1, 46, 1, K)
    k.rect(2, 2, 45, 2, STEEL_HI)
    k.rect(2, 26, 45, 26, STEEL_D)
    k.rect(1, 27, 46, 27, K)
    k.shadow_rows(2, 45, 28)
    out.update(
        k.tiles([[f"backstop_0{c}" for c in range(3)], [f"backstop_1{c}" for c in range(3)]])
    )

    # -- stone fountain 2x2 ---------------------------------------------------
    f = _Big(2, 2)
    cx, cy = 16.0, 16.0
    for y in range(32):
        for x in range(32):
            d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
            if d > 15.0:
                continue
            if d > 13.5:
                if y >= 16 and ((x + y) % 2 == 0 or d < 14.3):
                    f.px(x, y, GROUND_SHADOW)
            elif d > 12.5:
                f.px(x, y, K)
            elif d > 10.5:
                f.px(x, y, CURB_HI if y < 14 else CJOINT if y > 20 else CURB_MID)
            elif d > 9.5:
                f.px(x, y, K)
            else:
                ring = 5.5 < d < 7.0 and (x + y) % 3 == 0
                f.px(x, y, WATER_RIPPLE if ring else WATER)
    f.rect(14, 8, 17, 15, K)
    f.rect(15, 9, 16, 14, CURB_HI)
    f.rect(16, 9, 16, 14, CURB_MID)
    for x, y in ((15, 6), (16, 6), (14, 7), (17, 7), (13, 8), (18, 8), (12, 10), (19, 10)):
        f.px(x, y, GLASS_HI)
    for x, y in ((12, 14), (19, 14), (11, 17), (20, 17)):
        f.px(x, y, WATER_HI)
    out.update(f.tiles([["fountain_tl", "fountain_tr"], ["fountain_bl", "fountain_br"]]))

    # -- blank green exit sign 1x2 -------------------------------------------
    e = _Big(1, 2)
    e.rect(1, 1, 14, 12, K)
    e.rect(2, 2, 13, 11, SIGN_WHITE)
    e.rect(3, 3, 12, 10, SIGN_GREEN)
    for x0 in (3, 11):
        e.rect(x0, 13, x0 + 1, 28, K)
        e.rect(x0 + 1, 13, x0 + 1, 27, STEEL)
    e.rect(2, 29, 5, 29, K)
    e.rect(10, 29, 13, 29, K)
    e.shadow_rows(2, 13, 30)
    out.update(e.tiles([["exit_sign_t"], ["exit_sign_b"]]))
    return out


_BIKE = [
    "................",
    "................",
    "...oo.......ooo.",
    "....f........f..",
    "....ffffffffff..",
    "....f......f.f..",
    "....f.....f..f..",
    "...ofo...f.oof..",
    "..o.f.o.f.o..fo.",
    ".o..f..f.o..f..o",
    ".o..hooo.o..h..o",
    ".o.....o.o.....o",
    "..o...o...o...o.",
    "...ooo.....ooo..",
    ".ssssssssssssss.",
    "................",
]


def _bikes() -> dict[str, object]:
    out: dict[str, object] = {}

    def make(name, art, frame) -> None:
        p = Painter()
        p.grid(art, {"o": K, "f": frame, "h": STEEL_HI, "s": SHADOW})
        _ground_shadow(p)
        out[name] = p.img

    make("bike_a", _BIKE, RED)
    make("bike_b", [row[::-1] for row in _BIKE], BLUE)
    p = Painter()
    hoop = [
        "..oooo..",
        ".ohhhho.",
        ".oh..ho.",
        ".oh..ho.",
        ".oh..ho.",
        ".oh..ho.",
        ".oh..ho.",
        ".oo..oo.",
    ]
    for ox in (1, 8):
        p.grid(hoop, {"o": K, "h": STEEL_HI}, ox, 4)
    for x in range(1, 15):
        p.px(x, 12, SHADOW)
    _ground_shadow(p)
    out["bike_rack"] = p.img
    return out


def _kit_tiles() -> dict[str, object]:
    """Every tile of rows 17-29, by name."""
    out: dict[str, object] = {}
    out.update(_shadow_and_litter())
    out.update(_ground_blobs())
    out.update(_vehicles())
    out.update(_hedge_tiles())
    out.update(_street_and_suburb())
    out.update(_garage_and_shed())
    out.update(_set_pieces())
    out.update(_bikes())
    return out


def generate() -> None:
    from PIL import Image

    palette = _load_palette()
    cache: dict[tuple[int, int, int], tuple[int, int, int]] = {}

    def q(c: tuple[int, int, int]) -> tuple[int, int, int]:
        if c not in cache:
            r, g, b = c
            cache[c] = min(
                palette, key=lambda p: (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2
            )
        return cache[c]

    sheet = Image.new("RGBA", (MODERN_COLUMNS * T, MODERN_ROWS * T), (0, 0, 0, 0))
    for tid, img in _draw_tiles().items():
        # quantize opaque pixels to the rpg-tileset palette (GRASS_DARK is
        # derived from sampled grass pixels and stays as painted)
        out = img.copy()
        if tid not in NO_QUANTIZE:
            for y in range(T):
                for x in range(T):
                    r, g, b, a = out.getpixel((x, y))
                    if a == 255:
                        out.putpixel((x, y), (*q((r, g, b)), 255))
        row, col = divmod(tid, MODERN_COLUMNS)
        sheet.alpha_composite(out, (col * T, row * T))
    OUT_IMAGE.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT_IMAGE)
    print(f"wrote {OUT_IMAGE} ({sheet.width}x{sheet.height})")
    _render_contact_sheet(sheet)


def _render_contact_sheet(sheet) -> None:
    """Labeled contact sheet + a side-by-side strip with registry tiles."""
    from PIL import Image, ImageDraw

    from mapgen import tiles as R

    Z = 3
    rpg = Image.open(RPG_TILESET).convert("RGBA")

    def rpg_tile(g: int) -> object:
        row, col = (g - 1) // 100, (g - 1) % 100
        return rpg.crop((col * T, row * T, (col + 1) * T, (row + 1) * T))

    def modern_tile(g: int) -> object:
        tid = g - MODERN_FIRSTGID
        row, col = divmod(tid, MODERN_COLUMNS)
        return sheet.crop((col * T, row * T, (col + 1) * T, (row + 1) * T))

    def any_tile(g: int) -> object:
        return modern_tile(g) if g >= MODERN_FIRSTGID else rpg_tile(g)

    # -- part 1: labeled grid of every modern tile
    names = sorted(IDS.items(), key=lambda kv: kv[1])
    per_row = 8
    cell = T * Z + 26
    rows = (len(names) + per_row - 1) // per_row
    grid_h = rows * (cell + 14)

    # -- part 2: integration strip — a tiny street scene mixing both sheets
    rng = random.Random(5)
    scene_w, scene_h = 26, 10
    grid = [[0] * scene_w for _ in range(scene_h)]
    for y in range(scene_h):
        for x in range(scene_w):
            grid[y][x] = rng.choice(R.GRASS.fill)
    over: list[tuple[int, int, int]] = []
    # horizontal road rows 4-6 with sidewalk rows 3 and 7
    for x in range(scene_w):
        over.append((x, 3, rng.choice(SIDEWALK.fill)))
        over.append((x, 3, mg("swk_n")))
        over.append((x, 7, mg("swk_s")))
        for y in (4, 5, 6):
            over.append((x, y, ASPHALT.fill[(x + y) % 4]))
    for x in range(scene_w):
        if x % 4 == 1:
            over.append((x, 5, mg("dash_h")))
    for y in (4, 5, 6):
        over.append((12, y, mg("crosswalk_h")))
    over.append((16, 5, mg("storm_drain")))
    scene = Image.new("RGBA", (scene_w * T, scene_h * T))
    for y in range(scene_h):
        for x in range(scene_w):
            scene.alpha_composite(any_tile(grid[y][x]), (x * T, y * T))
    for x, y, g in over:
        scene.alpha_composite(any_tile(g), (x * T, y * T))

    def stamp_on(scene, stamp, tx, ty):
        for r, c, g in stamp.cells():
            scene.alpha_composite(any_tile(g), ((tx + c) * T, (ty + r) * T))

    stamp_on(scene, R.LAMPPOST, 2, 0)  # registry lamppost on sidewalk
    for x, name in (
        (5, "hydrant"),
        (7, "mailbox"),
        (9, "trash_bin"),
        (15, "planter_box"),
        (17, "newsbox"),
        (19, "bench_h"),
    ):
        scene.alpha_composite(modern_tile(mg(name)), (x * T, 2 * T))
    stamp_on(scene, BUS_SIGN, 21, 1)
    stamp_on(scene, R.PLANTER_YELLOW, 23, 2)
    # registry path joining the road, for direct style comparison
    for y in (8, 9):
        for x in range(4, 8):
            scene.alpha_composite(any_tile(rng.choice(R.PATH_TAN.fill)), (x * T, y * T))
    stamp_on(scene, R.SIGNS_STANDING[2], 10, 8)
    scene_z = scene.resize((scene.width * Z, scene.height * Z), Image.NEAREST)

    # -- part 3: building strip — new roofs/diner next to rpg-tileset houses
    bw, bh = 46, 9
    bscene = Image.new("RGBA", (bw * T, bh * T))
    brng = random.Random(9)
    for y in range(bh):
        for x in range(bw):
            bscene.alpha_composite(any_tile(brng.choice(R.GRASS.fill)), (x * T, y * T))

    def put(g: int, tx: int, ty: int) -> None:
        bscene.alpha_composite(any_tile(g), (tx * T, ty * T))

    def put_stamp(stamp, tx: int, ty: int) -> None:
        for r, c, g in stamp.cells():
            put(g, tx + c, ty + r)

    def _pad(stamp, w: int, h: int):
        rows_ = stamp.gids
        Hs, Ws = len(rows_), len(rows_[0])
        cols = [0] + [1 + i % (Ws - 2) for i in range(max(0, w - 2))] + ([Ws - 1] if w > 1 else [])
        rws = [0] + [1 + i % (Hs - 2) for i in range(max(0, h - 2))] + ([Hs - 1] if h > 1 else [])
        return TileStamp(
            f"{stamp.name}_{w}x{h}", tuple(tuple(rows_[r][c] for c in cols) for r in rws)
        )

    def wall_rows(stamp, w: int, rows: list[int]) -> list[list[int]]:
        cols = [0] + [5 + (i % 2) for i in range(w - 2)] + [stamp.w - 1]
        return [[stamp.gids[r][c] for c in cols] for r in rows]

    def put_rows(rows: list[list[int]], tx: int, ty: int) -> None:
        for r, row in enumerate(rows):
            for c, g in enumerate(row):
                if g:
                    put(g, tx + c, ty + r)

    # A) OLD language for comparison: dark deck pad over a brick front
    put_stamp(_pad(R.DECK_DARK, 7, 3), 1, 1)
    put_rows(wall_rows(R.FACADE_BRICK, 7, [3, 4, 5]), 1, 4)
    put_stamp(R.DOOR_WOOD, 3, 5)
    # B) colonial: terracotta shingles + cream front + shutters + door
    put_stamp(shingle_stamp("terracotta", 8, 3), 9, 1)
    put_rows(wall_rows(R.FACADE_CREAM, 8, [2, 3, 4, 5]), 9, 4)
    put_stamp(SHUTTER_WINDOW, 10, 4)
    put_stamp(SHUTTER_WINDOW, 14, 4)
    put_stamp(R.DOOR_WOOD, 12, 6)
    # C) colonial, slate colorway
    put_stamp(shingle_stamp("slate", 8, 4), 18, 0)
    put_rows(wall_rows(R.FACADE_CREAM, 8, [2, 3, 4, 5]), 18, 4)
    put_stamp(SHUTTER_WINDOW, 19, 4)
    put_stamp(SHUTTER_WINDOW, 23, 4)
    put_stamp(R.DOOR_WOOD, 21, 6)
    # D) tudor boutique: cedar shingles + timber band + red door + window
    put_stamp(shingle_stamp("cedar", 7, 3), 27, 1)
    put_stamp(_pad(R.WALL_TIMBER_BAND, 7, 2), 27, 4)
    put_rows(wall_rows(R.FACADE_CREAM, 7, [4, 5]), 27, 6)
    put_stamp(R.DOOR_RED, 29, 6)
    put_stamp(WINDOW, 31, 6)
    # E) chrome diner
    for r, kind in enumerate(("roof", "sign", "window", "wall", "wall")):
        for c, g in enumerate(diner_row(kind, 9)):
            put(g, 36 + c, 1 + r)
    put_stamp(DINER_DOOR, 40, 4)
    bscene_z = bscene.resize((bscene.width * Z, bscene.height * Z), Image.NEAREST)

    # -- part 4: kit strip — rows 17-29 assembled in context
    kscene = _kit_scene(any_tile, R)
    kscene_z = kscene.resize((kscene.width * Z, kscene.height * Z), Image.NEAREST)

    W = max(per_row * cell + 20, scene_z.width + 20, bscene_z.width + 20, kscene_z.width + 20)
    H = grid_h + scene_z.height + bscene_z.height + kscene_z.height + 140
    out = Image.new("RGBA", (W, H), (24, 26, 32, 255))
    draw = ImageDraw.Draw(out)
    draw.text((10, 4), "TOWNSHIP-MODERN TILES (quantized to rpg palette)", fill=(255, 200, 80))
    y0 = 20
    for i, (name, tid) in enumerate(names):
        r, c = divmod(i, per_row)
        x = 10 + c * cell
        y = y0 + r * (cell + 14)
        timg = modern_tile(MODERN_FIRSTGID + tid).resize((T * Z, T * Z), Image.NEAREST)
        bg = Image.new("RGBA", timg.size, (96, 172, 80, 255))
        bg.alpha_composite(timg)
        out.alpha_composite(bg, (x, y))
        draw.text((x, y + T * Z + 2), name, fill=(230, 230, 230))
    y_strip = y0 + rows * (cell + 14)
    draw.text(
        (10, y_strip), "INTEGRATION STRIP (modern + registry side by side)", fill=(255, 200, 80)
    )
    out.alpha_composite(scene_z, (10, y_strip + 16))
    y_b = y_strip + 16 + scene_z.height + 8
    draw.text(
        (10, y_b),
        "BUILDING STRIP (old deck roof | colonials | tudor | diner)",
        fill=(255, 200, 80),
    )
    out.alpha_composite(bscene_z, (10, y_b + 16))
    y_k = y_b + 16 + bscene_z.height + 8
    draw.text(
        (10, y_k),
        "KIT STRIP (lot + vehicles | street furniture | hedges | grass_dark / worn | set-pieces | suburb)",
        fill=(255, 200, 80),
    )
    out.alpha_composite(kscene_z, (10, y_k + 16))
    SHEET_PATH.parent.mkdir(parents=True, exist_ok=True)
    out.save(SHEET_PATH)
    print(f"wrote {SHEET_PATH}")


def _kit_scene(any_tile, R):
    """A 46x17-tile scene placing every row 17-29 piece in context (used by
    the contact sheet and by the scratch inspection renders)."""
    from PIL import Image

    W, H = 46, 17
    scene = Image.new("RGBA", (W * T, H * T))
    rng = random.Random(17)

    def put(g: int, tx: int, ty: int) -> None:
        if g and 0 <= tx < W and 0 <= ty < H:
            scene.alpha_composite(any_tile(g), (tx * T, ty * T))

    def stamp(s: TileStamp, tx: int, ty: int) -> None:
        for r, c, g in s.cells():
            put(g, tx + c, ty + r)

    def blob(b: Blob, cells: set[tuple[int, int]]) -> None:
        """The build_maps autotiler rules: edges / convex corners inside the
        mask, hole fillets just outside its concave bends."""
        for x, y in cells:
            n, s_, w_, e = (
                (x, y - 1) not in cells,
                (x, y + 1) not in cells,
                (x - 1, y) not in cells,
                (x + 1, y) not in cells,
            )
            if n and w_:
                g = b.nw
            elif n and e:
                g = b.ne
            elif s_ and w_:
                g = b.sw
            elif s_ and e:
                g = b.se
            elif n:
                g = b.n[0]
            elif s_:
                g = b.s[0]
            elif w_:
                g = b.w[0]
            elif e:
                g = b.e[0]
            else:
                g = rng.choice(b.fill)
            put(g, x, y)
        if not b.hole_nw:
            return
        for x, y in cells:
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    px_, py_ = x + dx, y + dy
                    if (px_, py_) in cells:
                        continue
                    nin, sin = (px_, py_ - 1) in cells, (px_, py_ + 1) in cells
                    win, ein = (px_ - 1, py_) in cells, (px_ + 1, py_) in cells
                    if nin and win and (px_ - 1, py_ - 1) in cells:
                        put(b.hole_nw, px_, py_)
                    elif nin and ein and (px_ + 1, py_ - 1) in cells:
                        put(b.hole_ne, px_, py_)
                    elif sin and win and (px_ - 1, py_ + 1) in cells:
                        put(b.hole_sw, px_, py_)
                    elif sin and ein and (px_ + 1, py_ + 1) in cells:
                        put(b.hole_se, px_, py_)

    def blob_rect(b: Blob, x: int, y: int, w: int, h: int) -> None:
        blob(b, {(xx, yy) for xx in range(x, x + w) for yy in range(y, y + h)})

    for y in range(H):
        for x in range(W):
            put(rng.choice(R.GRASS.fill), x, y)

    # A) parking lot with every vehicle
    for y in range(1, 9):
        for x in range(1, 24):
            put(ASPHALT.fill[(x + y) % 4], x, y)
    for x in range(1, 24):
        put(mg("asp_n"), x, 1)
        put(mg("asp_s"), x, 8)
    for i, c in enumerate(CAR_COLORS):
        stamp(CAR_H[c], 2 + i * 3, 2)
        stamp(CAR_V[c], 2 + i * 2, 4)
    stamp(PICKUP_H, 17, 2)
    stamp(PICKUP_V, 12, 4)
    stamp(BUS_H, 14, 4)
    stamp(SCHOOLBUS_H, 14, 6)
    stamp(BUS_V, 19, 4)
    put(mg("bike_a"), 21, 2)
    put(mg("bike_b"), 22, 2)
    stamp(BIKE_RACK, 22, 4)
    # B) sidewalk with the street kit and the shelter
    for y in range(1, 4):
        for x in range(25, 46):
            put(rng.choice(SIDEWALK.fill), x, y)
    stamp(SHELTER, 26, 1)
    stamp(POLE, 30, 1)
    for x in range(31, 35):
        put(mg("wire_h"), x, 1)
    stamp(POLE, 35, 1)
    for y in range(3, 5):
        put(mg("wire_v"), 35, y)
    stamp(SIGNAL, 37, 1)
    stamp(SIGNAL_GREEN, 38, 1)
    stamp(STOP_SIGN, 40, 1)
    stamp(STREET_BLADE, 42, 1)
    stamp(EXIT_SIGN, 44, 1)
    put(mg("steps"), 32, 3)
    # C) hedge runs: an open run with a corner, and a closed rectangle
    stamp(HEDGE["end_w"], 1, 10)
    for x in range(2, 6):
        stamp(HEDGE["h"], x, 10)
    stamp(HEDGE["corner_ne"], 6, 10)
    stamp(HEDGE["v"], 6, 11)
    stamp(HEDGE["end_s"], 6, 12)
    stamp(HEDGE["corner_nw"], 9, 10)
    stamp(HEDGE["h"], 10, 10)
    stamp(HEDGE["h"], 11, 10)
    stamp(HEDGE["corner_ne"], 12, 10)
    stamp(HEDGE["v"], 9, 11)
    stamp(HEDGE["v"], 12, 11)
    stamp(HEDGE["corner_sw"], 9, 12)
    stamp(HEDGE["h"], 10, 12)
    stamp(HEDGE["h"], 11, 12)
    stamp(HEDGE["corner_se"], 12, 12)
    stamp(HEDGE["end_n"], 2, 13)
    stamp(HEDGE["v"], 2, 14)
    stamp(HEDGE["end_s"], 2, 15)
    stamp(HEDGE["end_w"], 4, 15)
    stamp(HEDGE["end_e"], 5, 15)
    # D) an L-shaped GRASS_DARK lawn (hole fillets at the concave bend) with
    # a fountain; a WORN desire line joining a worn patch
    lawn = {(x, y) for x in range(14, 21) for y in range(10, 15)}
    lawn |= {(x, y) for x in range(18, 22) for y in range(14, 17)}
    blob(GRASS_DARK, lawn)
    stamp(FOUNTAIN, 15, 11)
    blob(
        WORN,
        {(x, 10) for x in range(23, 29)} | {(x, y) for x in range(24, 27) for y in range(11, 16)},
    )
    # E) backstop, mulch bed with litter and clover, building shadows
    stamp(BACKSTOP, 29, 10)
    put(mg("mulch_a"), 33, 10)
    put(mg("mulch_b"), 34, 10)
    put(mg("mulch_b"), 33, 11)
    put(mg("mulch_a"), 34, 11)
    put(mg("clover_a"), 35, 10)
    put(mg("clover_b"), 36, 10)
    put(mg("litter_a"), 35, 11)
    put(mg("litter_b"), 36, 11)
    put(mg("litter_a"), 34, 12)
    put(mg("clover_b"), 33, 12)
    # F) suburb: garage door + steps + plaque + AC on a cream wall, shed
    stamp(shingle_stamp("slate", 6, 2), 38, 9)
    for r, row_ in enumerate(R.FACADE_CREAM.gids[2:5]):
        for c in range(6):
            put(row_[[0, 5, 6, 5, 6, 7][c]], 38 + c, 11 + r)
    stamp(GARAGE_DOOR, 39, 12)
    stamp(R.DOOR_WOOD, 42, 12)
    put(mg("house_num"), 42, 11)
    put(mg("ac_window"), 41, 11)
    put(mg("steps"), 42, 14)
    put(mg("sh_full"), 44, 12)
    put(mg("sh_full"), 44, 13)
    put(mg("sh_corner"), 44, 11)
    for x in range(39, 44):
        put(mg("sh_fade_n"), x, 15)
    put(mg("sh_fade_w"), 38, 15)
    put(mg("sh_full"), 44, 14)
    put(mg("sh_fade_n"), 44, 15)
    stamp(SHED, 30, 13)
    put(mg("sh_fade_w"), 32, 13)
    put(mg("sh_full"), 32, 14)
    put(mg("sh_fade_n"), 30, 15)
    put(mg("sh_fade_n"), 31, 15)
    put(mg("sh_corner"), 32, 15)
    stamp(R.TREE_ROUND_SMALL, 27, 14)
    return scene


if __name__ == "__main__":
    generate()
