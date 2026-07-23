#!/usr/bin/env python3
"""Generate the ``township-modern`` tileset (contemporary street furniture).

Renders ``frontend/public/assets/tilesets/township-modern.png`` — a 16 px
tileset that extends the vendored ai-town RPG tileset with the modern
material it lacks: asphalt, concrete sidewalk, road markings, and a handful
of small-town street props (hydrant, mailbox, bus sign, ...).

Style contract: every opaque pixel is quantized to the nearest color that
actually occurs in ``rpg-tileset.png`` (sampled at generation time), and all
shapes carry the same 1 px darker outline the source tileset uses, so the two
sheets sit next to each other without a style clash.

Grid: 10 columns, 16 px tiles. In Tiled maps this tileset is appended with
``firstgid = 10001``; all the ``Blob`` / ``TileStamp`` objects exported here
already carry absolute GIDs in that range.

Run:
    python3 -m scripts.mapgen.moderntiles      # writes the png + contact sheet
"""

from __future__ import annotations

import hashlib
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
MODERN_ROWS = 15
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
    )
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
    swk_edge = {"swk_n": "n", "swk_s": "s", "swk_w": "w", "swk_e": "e"}
    for name, side in swk_edge.items():

        def f(p, side=side, name=name):
            _sidewalk_base(random.Random(hash(name) % 9999), p, joints=False)
            _outline_edge(p, side, hi=CURB_HI)

        make(name, f)
    for name, corner in (("swk_nw", "nw"), ("swk_ne", "ne"), ("swk_sw", "sw"), ("swk_se", "se")):

        def f(p, corner=corner, name=name):
            _sidewalk_base(random.Random(hash(name) % 9999), p, joints=False)
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
            _fillet(p, corner, [C1, C2, C3], random.Random(hash(name) % 9999), r=5, hi=CURB_HI)

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

    make("hydrant", hydrant)

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

    make("mailbox", mailbox)

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

    make("trash_bin", trash_bin)

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

    make("planter_box", planter_box)

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

    make("newsbox", newsbox)

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

    make("bench_h", bench_h)

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

    make("bollard", bollard)

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

    # --- church kit ----------------------------------------------------------
    for name, img in _church_tiles().items():
        tiles_out[IDS[name]] = img

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
        # quantize opaque pixels to the rpg-tileset palette
        out = img.copy()
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

    W = max(per_row * cell + 20, scene_z.width + 20, bscene_z.width + 20)
    H = grid_h + scene_z.height + bscene_z.height + 110
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
    SHEET_PATH.parent.mkdir(parents=True, exist_ok=True)
    out.save(SHEET_PATH)
    print(f"wrote {SHEET_PATH}")


if __name__ == "__main__":
    generate()
