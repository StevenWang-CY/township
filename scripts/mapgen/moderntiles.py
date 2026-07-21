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

T = 16
MODERN_FIRSTGID = 10001
MODERN_COLUMNS = 10
MODERN_ROWS = 6
MODERN_TILECOUNT = MODERN_COLUMNS * MODERN_ROWS
MODERN_IMAGE = "frontend/public/assets/tilesets/township-modern.png"

# ---------------------------------------------------------------------------
# Local tile ids (0-based position in this sheet; GID = MODERN_FIRSTGID + id)
# ---------------------------------------------------------------------------
IDS: dict[str, int] = {
    # asphalt
    "asphalt_0": 0, "asphalt_1": 1, "asphalt_2": 2, "asphalt_3": 3,
    "asp_nw": 4, "asp_n": 5, "asp_ne": 6, "asp_w": 7, "asp_e": 8,
    "asp_sw": 9, "asp_s": 10, "asp_se": 11,
    "asp_hole_nw": 12, "asp_hole_ne": 13, "asp_hole_sw": 14, "asp_hole_se": 15,
    # sidewalk (cream concrete, curb-style edges)
    "swk_0": 16, "swk_1": 17, "swk_2": 18, "swk_3": 19,
    "swk_nw": 20, "swk_n": 21, "swk_ne": 22, "swk_w": 23, "swk_e": 24,
    "swk_sw": 25, "swk_s": 26, "swk_se": 27,
    "swk_hole_nw": 28, "swk_hole_ne": 29, "swk_hole_sw": 30, "swk_hole_se": 31,
    # markings (baked onto asphalt)
    "crosswalk_h": 32,   # for a HORIZONTAL road (band runs N-S, bars E-W)
    "crosswalk_v": 33,   # for a VERTICAL road
    "dash_h": 34, "dash_v": 35,
    # curb corner overlays (transparent, quarter-arc curb line)
    "curb_nw": 36, "curb_ne": 37, "curb_sw": 38, "curb_se": 39,
    "parking_stall": 40, "storm_drain": 41,
    # props (transparent background)
    "hydrant": 42, "mailbox": 43, "bus_sign_top": 44, "trash_bin": 45,
    "planter_box": 46, "newsbox": 47, "bench_h": 48, "bollard": 49,
    # row 5: facade window (transparent bg — safe on any wall), railway
    "win_tl": 50, "win_tr": 51, "win_bl": 52, "win_br": 53,
    "bus_sign_bot": 54,
    "rail_h": 55,       # track on ballast (repeat horizontally)
    "rail_x": 56,       # track embedded in asphalt (level crossing)
}


def mg(name: str) -> int:
    """Absolute GID of a modern tile."""
    return MODERN_FIRSTGID + IDS[name]


# Blob views over the modern sheet, shaped like scripts.mapgen.tiles.Blob so
# the same autotiler drives both tilesets.
ASPHALT = Blob(
    name="asphalt",
    fill=tuple(mg(f"asphalt_{i}") for i in range(4)),
    nw=mg("asp_nw"), n=(mg("asp_n"),), ne=mg("asp_ne"),
    w=(mg("asp_w"),), e=(mg("asp_e"),),
    sw=mg("asp_sw"), s=(mg("asp_s"),), se=mg("asp_se"),
    hole_nw=mg("asp_hole_nw"), hole_ne=mg("asp_hole_ne"),
    hole_sw=mg("asp_hole_sw"), hole_se=mg("asp_hole_se"),
)

SIDEWALK = Blob(
    name="sidewalk",
    fill=tuple(mg(f"swk_{i}") for i in range(4)),
    nw=mg("swk_nw"), n=(mg("swk_n"),), ne=mg("swk_ne"),
    w=(mg("swk_w"),), e=(mg("swk_e"),),
    sw=mg("swk_sw"), s=(mg("swk_s"),), se=mg("swk_se"),
    hole_nw=mg("swk_hole_nw"), hole_ne=mg("swk_hole_ne"),
    hole_sw=mg("swk_hole_sw"), hole_se=mg("swk_hole_se"),
)

BUS_SIGN = TileStamp("bus_sign", ((mg("bus_sign_top"),), (mg("bus_sign_bot"),)))

#: 2x2 sash window on TRANSPARENT background — unlike the rpg tileset's
#: WINDOW_TEAL (which has grass baked around it), this drops onto any facade.
WINDOW = TileStamp("window_modern", ((mg("win_tl"), mg("win_tr")),
                                     (mg("win_bl"), mg("win_br"))))

MODERN_SINGLES: dict[str, int] = {
    n: mg(n) for n in (
        "crosswalk_h", "crosswalk_v", "dash_h", "dash_v",
        "curb_nw", "curb_ne", "curb_sw", "curb_se",
        "parking_stall", "storm_drain",
        "hydrant", "mailbox", "trash_bin", "planter_box", "newsbox",
        "bench_h", "bollard", "rail_h", "rail_x",
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
        "tilewidth": T, "tileheight": T,
        "columns": MODERN_COLUMNS, "tilecount": MODERN_TILECOUNT,
        "margin": 0, "spacing": 0,
    }


# ===========================================================================
# Generation (drawing code below runs only under __main__ / generate())
# ===========================================================================

# Intended colors; every opaque pixel is snapped to the rpg-tileset palette.
K = (45, 39, 34)          # outline
A1 = (84, 78, 73)         # asphalt warm grays
A2 = (80, 74, 69)
A3 = (88, 82, 76)
ASPECK = (97, 90, 82)
ADARK = (68, 62, 57)
C1 = (206, 192, 163)      # concrete creams
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
TEAL = (86, 178, 178)      # window glass (matches the rpg teal panes)
TEAL_D = (58, 138, 142)
# ballast grays sampled from the rpg GRAVEL fill tiles (2603/2604/...)
B1 = (125, 129, 136)
B2 = (148, 162, 163)
B3 = (108, 108, 132)
BSPECK = (167, 186, 185)
SHADOW = (30, 26, 22, 70)  # kept semi-transparent, not quantized


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

    def grid(self, art: list[str], cmap: dict[str, tuple], ox: int = 0,
             oy: int = 0) -> None:
        for y, row in enumerate(art):
            for x, ch in enumerate(row):
                if ch in cmap:
                    self.px(ox + x, oy + y, cmap[ch])


def _asphalt_base(rng, p: Painter) -> None:
    p.noise(rng, 0, 0, 15, 15, [A1, A1, A1, A2, A2, A3], speck=ASPECK,
            speck_p=0.015)
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
    cx, cy = {"nw": (r, r), "ne": (15 - r, r),
              "sw": (r, 15 - r), "se": (15 - r, 15 - r)}[corner]
    zone = {"nw": lambda x, y: x <= cx and y <= cy,
            "ne": lambda x, y: x >= cx and y <= cy,
            "sw": lambda x, y: x <= cx and y >= cy,
            "se": lambda x, y: x >= cx and y >= cy}[corner]
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


def _fillet(p: Painter, corner: str, base_tones, rng, r: int = 5,
            hi=None) -> None:
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
            _asphalt_base(random.Random(hash(name) % 9999), p)
            _outline_edge(p, side)
        make(name, f)
    for name, corner, sides in (("asp_nw", "nw", "nw"), ("asp_ne", "ne", "ne"),
                                ("asp_sw", "sw", "sw"), ("asp_se", "se", "se")):
        def f(p, corner=corner, sides=sides, name=name):
            _asphalt_base(random.Random(hash(name) % 9999), p)
            _outline_edge(p, sides)
            _round_cut(p, corner, r=4)
        make(name, f)
    for name, corner in (("asp_hole_nw", "nw"), ("asp_hole_ne", "ne"),
                         ("asp_hole_sw", "sw"), ("asp_hole_se", "se")):
        def f(p, corner=corner, name=name):
            _fillet(p, corner, [A1, A2, A3], random.Random(hash(name) % 9999),
                    r=5)
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
    for name, corner in (("swk_nw", "nw"), ("swk_ne", "ne"),
                         ("swk_sw", "sw"), ("swk_se", "se")):
        def f(p, corner=corner, name=name):
            _sidewalk_base(random.Random(hash(name) % 9999), p, joints=False)
            _outline_edge(p, corner)
            _round_cut(p, corner, r=4)
            # curb highlight just inside the arc
            cx, cy = {"nw": (4, 4), "ne": (11, 4),
                      "sw": (4, 11), "se": (11, 11)}[corner]
            for y in range(16):
                for x in range(16):
                    d2 = (x - cx) ** 2 + (y - cy) ** 2
                    if 2.3 ** 2 < d2 <= 3.6 ** 2 and \
                       p.img.getpixel((x, y))[3] == 255:
                        pass
        make(name, f)
    for name, corner in (("swk_hole_nw", "nw"), ("swk_hole_ne", "ne"),
                         ("swk_hole_sw", "sw"), ("swk_hole_se", "se")):
        def f(p, corner=corner, name=name):
            _fillet(p, corner, [C1, C2, C3], random.Random(hash(name) % 9999),
                    r=5, hi=CURB_HI)
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
    for name, corner in (("curb_nw", "nw"), ("curb_ne", "ne"),
                         ("curb_sw", "sw"), ("curb_se", "se")):
        def f(p, corner=corner):
            cx, cy = {"nw": (15, 15), "ne": (0, 15),
                      "sw": (15, 0), "se": (0, 0)}[corner]
            for y in range(16):
                for x in range(16):
                    d2 = (x - cx) ** 2 + (y - cy) ** 2
                    if 10.5 ** 2 < d2 <= 12.5 ** 2:
                        p.px(x, y, CURB_MID)
                    elif 12.5 ** 2 < d2 <= 13.8 ** 2:
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
        p.grid([
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
        ], {"o": K, "r": RED, "h": RED_HI, "s": SHADOW})
    make("hydrant", hydrant)

    def mailbox(p):
        p.grid([
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
        ], {"o": K, "b": BLUE, "h": BLUE_HI, "w": WHITE, "s": SHADOW})
    make("mailbox", mailbox)

    def bus_sign_top(p):
        p.grid([
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
        ], {"o": K, "b": BLUE, "w": WHITE, "g": GRAY_HI})
    make("bus_sign_top", bus_sign_top)

    def bus_sign_bot(p):
        p.grid([
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
        ], {"o": K, "g": GRAY, "s": SHADOW})
    make("bus_sign_bot", bus_sign_bot)

    def trash_bin(p):
        p.grid([
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
        ], {"o": K, "d": BIN_HI, "b": BIN, "h": BIN_HI, "s": SHADOW})
    make("trash_bin", trash_bin)

    def planter_box(p):
        p.grid([
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
        ], {"o": K, "w": WOOD, "d": WOOD_D, "L": LEAF, "g": LEAF_D,
            "s": SHADOW})
    make("planter_box", planter_box)

    def newsbox(p):
        p.grid([
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
        ], {"o": K, "N": ORANGE, "w": WHITE, "b": BLUE, "s": SHADOW})
    make("newsbox", newsbox)

    def bench_h(p):
        p.grid([
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
        ], {"o": K, "w": WOOD, "d": WOOD_D, "s": SHADOW})
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
        wrect(1, 1, 30, 2, CURB_HI)           # lintel highlight
        wrect(1, 27, 30, 28, CURB_HI)         # sill top lip
        wrect(1, 29, 30, 30, CJOINT)          # sill shadow
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
        p.noise(rng, 0, 0, 15, 15, [B1, B1, B2, B3], speck=BSPECK,
                speck_p=0.06)
        for tx in (1, 5, 9, 13):     # sleepers
            p.rect(tx, 1, tx + 1, 13, WOOD_D)
            p.rect(tx, 1, tx + 1, 1, WOOD)
        _rails(p)
    make("rail_h", rail_h)

    def rail_x(p):
        _asphalt_base(random.Random(56), p)
        _rails(p)
    make("rail_x", rail_x)

    def bollard(p):
        p.grid([
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
        ], {"o": K, "g": GRAY, "h": GRAY_HI, "s": SHADOW})
    make("bollard", bollard)

    return tiles_out


def generate() -> None:
    from PIL import Image
    palette = _load_palette()
    cache: dict[tuple[int, int, int], tuple[int, int, int]] = {}

    def q(c: tuple[int, int, int]) -> tuple[int, int, int]:
        if c not in cache:
            r, g, b = c
            cache[c] = min(palette,
                           key=lambda p: (p[0] - r) ** 2 + (p[1] - g) ** 2
                           + (p[2] - b) ** 2)
        return cache[c]

    sheet = Image.new("RGBA", (MODERN_COLUMNS * T, MODERN_ROWS * T),
                      (0, 0, 0, 0))
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

    stamp_on(scene, R.LAMPPOST, 2, 0)      # registry lamppost on sidewalk
    for x, name in ((5, "hydrant"), (7, "mailbox"), (9, "trash_bin"),
                    (15, "planter_box"), (17, "newsbox"), (19, "bench_h")):
        scene.alpha_composite(modern_tile(mg(name)), (x * T, 2 * T))
    stamp_on(scene, BUS_SIGN, 21, 1)
    stamp_on(scene, R.PLANTER_YELLOW, 23, 2)
    # registry path joining the road, for direct style comparison
    for y in (8, 9):
        for x in range(4, 8):
            scene.alpha_composite(any_tile(rng.choice(R.PATH_TAN.fill)),
                                  (x * T, y * T))
    stamp_on(scene, R.SIGNS_STANDING[2], 10, 8)
    scene_z = scene.resize((scene.width * Z, scene.height * Z), Image.NEAREST)

    W = max(per_row * cell + 20, scene_z.width + 20)
    H = grid_h + scene_z.height + 70
    out = Image.new("RGBA", (W, H), (24, 26, 32, 255))
    draw = ImageDraw.Draw(out)
    draw.text((10, 4), "TOWNSHIP-MODERN TILES (quantized to rpg palette)",
              fill=(255, 200, 80))
    y0 = 20
    for i, (name, tid) in enumerate(names):
        r, c = divmod(i, per_row)
        x = 10 + c * cell
        y = y0 + r * (cell + 14)
        timg = modern_tile(MODERN_FIRSTGID + tid).resize((T * Z, T * Z),
                                                         Image.NEAREST)
        bg = Image.new("RGBA", timg.size, (96, 172, 80, 255))
        bg.alpha_composite(timg)
        out.alpha_composite(bg, (x, y))
        draw.text((x, y + T * Z + 2), name, fill=(230, 230, 230))
    y_strip = y0 + rows * (cell + 14)
    draw.text((10, y_strip), "INTEGRATION STRIP (modern + registry side by side)",
              fill=(255, 200, 80))
    out.alpha_composite(scene_z, (10, y_strip + 16))
    SHEET_PATH.parent.mkdir(parents=True, exist_ok=True)
    out.save(SHEET_PATH)
    print(f"wrote {SHEET_PATH}")


if __name__ == "__main__":
    generate()
