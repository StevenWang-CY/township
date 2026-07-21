"""Named GID registry for the vendored a16z ai-town RPG tileset.

Tileset: ``frontend/public/assets/tilesets/rpg-tileset.png``
1600x1600 px, 16 px tiles, 100 columns x 100 rows = 10,000 tiles.

Grid convention
---------------
    GID = row * 100 + col + 1          (Tiled firstgid = 1, row/col 0-based)

Use :func:`gid` / :func:`rc` to convert. Tiled layer data may carry flip
flags in the top 3 bits (FLIP_H / FLIP_V / FLIP_D); mask raw values with
``GID_MASK`` to get the base GID, and OR the flags onto a base GID to place
a flipped tile.

Autotile ("blob") convention
----------------------------
Every organic ground material in this tileset ships as TWO pieces, always in
the same layout (verified visually for each material below):

1. A rounded *patch blob*, ~4-6 tiles wide: rows of [NW, N..., NE] /
   [W, fill..., E] / [SW, S..., SE], usually with 1-tile decorative *fringe*
   tiles above/below/beside that overhang onto the neighbouring terrain.
2. A solid 4x4 *hole block* to its right: 16 fill-ish tiles with a 2x2
   transparent hole in the middle. The four tiles around the hole centre are
   the INVERSE corners (place ``hole_nw`` at the hole's top-left, etc.) —
   these are what you need at concave bends, e.g. an L-turn of a path.

:class:`Blob` captures both pieces. Fill variants are interchangeable — pick
randomly for organic texture (the ai-town example map does exactly this).

Every named entry in this file was visually confirmed against
``scripts/mapgen/_inspect/`` contact sheets / zoom crops, and the acceptance
sheet ``_inspect/registry_sheet.png`` (render it with
``python3 scripts/mapgen/validate_registry.py``).

Re-running inspection
---------------------
    python3 scripts/mapgen/inspect_tiles.py                     # full sheets
    python3 scripts/mapgen/inspect_tiles.py --crop R0 R1 C0 C1  # zoom crop

Provenance of ground truth: ``frontend/public/assets/maps/tilemap.json``
(the ai-town example map) — its terrain/deco layers pin down the grass fill,
water fill, tan path, wood fence kit, both big trees, the well, rocks, log,
fern and flower tiles used here.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass

TILESET_IMAGE = "frontend/public/assets/tilesets/rpg-tileset.png"
TILE_SIZE = 16
COLS = 100
ROWS = 100
FIRST_GID = 1

# Tiled flip flags (top 3 bits of a raw layer GID).
FLIP_H = 0x80000000  # horizontal flip
FLIP_V = 0x40000000  # vertical flip
FLIP_D = 0x20000000  # anti-diagonal flip (rotation building block)
GID_MASK = 0x0FFFFFFF


def gid(row: int, col: int) -> int:
    """GID of the tile at (row, col), 0-based, firstgid 1."""
    if not (0 <= row < ROWS and 0 <= col < COLS):
        raise ValueError(f"tile ({row},{col}) outside {ROWS}x{COLS} grid")
    return row * COLS + col + 1


def rc(g: int) -> tuple[int, int]:
    """(row, col) of a base GID."""
    base = g & GID_MASK
    return (base - 1) // COLS, (base - 1) % COLS


def flip_h(g: int) -> int:
    return g | FLIP_H


def flip_v(g: int) -> int:
    return g | FLIP_V


def base_gid(raw: int) -> int:
    """Strip Tiled flip flags from a raw layer value."""
    return raw & GID_MASK


def _rect(row: int, col: int, w: int, h: int) -> tuple[tuple[int, ...], ...]:
    """w x h grid of GIDs whose top-left tile is (row, col)."""
    return tuple(tuple(gid(row + r, col + c) for c in range(w)) for r in range(h))


@dataclass(frozen=True)
class TileStamp:
    """A rectangular multi-tile object. ``gids[r][c]`` is a base GID, 0 = skip.

    Stamps are placed on an object/deco layer; transparent margin tiles are
    part of the art (shadows, canopy overhang) and simply paste nothing.
    """

    name: str
    gids: tuple[tuple[int, ...], ...]

    @property
    def w(self) -> int:
        return len(self.gids[0])

    @property
    def h(self) -> int:
        return len(self.gids)

    def cells(self) -> Iterator[tuple[int, int, int]]:
        """Yield (row_offset, col_offset, gid) for non-empty cells."""
        for r, row in enumerate(self.gids):
            for c, g in enumerate(row):
                if g:
                    yield r, c, g

    @classmethod
    def rect(cls, name: str, row: int, col: int, w: int, h: int) -> TileStamp:
        return cls(name, _rect(row, col, w, h))


@dataclass(frozen=True)
class Blob:
    """An organic terrain patch: blob edges + interchangeable fill + inverse
    ("hole") corners. See the module docstring for the layout convention.

    Edge semantics: ``n`` tiles sit on the top edge of the patch, ``nw`` on
    its top-left corner, and so on. ``fringe_*`` are optional overhang tiles
    drawn OUTSIDE the patch (they overlap the neighbour terrain). ``hole_nw``
    is placed at the top-left tile of a 2x2 concave hole cut into this
    material (i.e. it is the inverse corner piece).
    """

    name: str
    fill: tuple[int, ...]
    n: tuple[int, ...] = ()
    s: tuple[int, ...] = ()
    w: tuple[int, ...] = ()
    e: tuple[int, ...] = ()
    nw: int = 0
    ne: int = 0
    sw: int = 0
    se: int = 0
    fringe_n: tuple[int, ...] = ()
    fringe_s: tuple[int, ...] = ()
    fringe_w: tuple[int, ...] = ()
    fringe_e: tuple[int, ...] = ()
    hole_nw: int = 0
    hole_ne: int = 0
    hole_sw: int = 0
    hole_se: int = 0

    def edge_tiles(self) -> dict[str, object]:
        return {
            "nw": self.nw,
            "n": self.n,
            "ne": self.ne,
            "w": self.w,
            "e": self.e,
            "sw": self.sw,
            "s": self.s,
            "se": self.se,
            "hole_nw": self.hole_nw,
            "hole_ne": self.hole_ne,
            "hole_sw": self.hole_sw,
            "hole_se": self.hole_se,
        }


# =========================================================================
# TERRAIN — blob autotiles (rows 0-28 and 36-47, left half of the sheet)
# =========================================================================

#: Main mid-green grass. Fill == the 8 tiles the ai-town example map floods
#: as its base terrain (each used ~150x there).
GRASS = Blob(
    name="grass",
    fill=(202, 203, 204, 205, 302, 303, 304, 305),
    nw=102,
    n=(103, 104),
    ne=105,
    w=(202, 302),
    e=(205, 305),
    sw=402,
    s=(403, 404),
    se=405,
    fringe_n=(3, 4),
    fringe_s=(503, 504),
    fringe_w=(201, 301),
    fringe_e=(206, 306),
    hole_nw=108,
    hole_ne=109,
    hole_sw=208,
    hole_se=209,
)

#: Lighter lime "spring meadow" grass patch (rows 18-22, cols 0-9).
GRASS_LIGHT = Blob(
    name="grass_light",
    fill=(2003, 2004, 2103, 2104),
    nw=1902,
    n=(1903, 1904),
    ne=1905,
    w=(2002, 2102),
    e=(2005, 2105),
    sw=2202,
    s=(2203, 2204),
    se=2205,
    fringe_n=(1803, 1804),
    fringe_s=(2303, 2304),
    fringe_w=(2001, 2101),
    fringe_e=(2006, 2106),
    hole_nw=1908,
    hole_ne=1909,
    hole_sw=2008,
    hole_se=2009,
)

#: Bright saturated grass singles from the compact biome block (rows 60-64,
#: cols 64-81). Matches the grass baked into POND_GRASS / PATH_PAD_TAN.
GRASS_BRIGHT_FILL = (6066, 6071, 6076, 6081, 6176, 6181, 6276, 6376, 6476)

#: Deep blue water blob (rows 0-4, cols 11-19). Pure-water fills.
WATER_DEEP = Blob(
    name="water_deep",
    fill=(213, 214, 313, 314),
    nw=112,
    n=(113, 114),
    ne=115,
    w=(212, 312),
    e=(215, 315),
    sw=412,
    s=(413, 414),
    se=415,
    hole_nw=118,
    hole_ne=119,
    hole_sw=218,
    hole_se=219,
)

#: Lighter blue lake water used by the example map (fill only; shorelines
#: come from POND_GRASS / the channel pieces around it).
WATER_LAKE_FILL = (6268, 6269, 6368, 6369)

#: Cyan shallow water / lagoon blob (rows 85-89, cols 42-50).
WATER_SHALLOW = Blob(
    name="water_shallow",
    fill=(8744, 8745, 8844, 8845),
    nw=8643,
    n=(8644, 8645),
    ne=8646,
    w=(8743, 8843),
    e=(8746, 8846),
    sw=8943,
    s=(8944, 8945),
    se=8946,
    fringe_n=(8544, 8545),
    hole_nw=8649,
    hole_ne=8650,
    hole_sw=8749,
    hole_se=8750,
)

#: Red magma / crimson ground blob (rows 0-4, cols 21-29). Not town-useful,
#: kept for completeness.
MAGMA = Blob(
    name="magma",
    fill=(223, 224, 323, 324),
    nw=122,
    n=(123, 124),
    ne=125,
    w=(222, 322),
    e=(225, 325),
    sw=422,
    s=(423, 424),
    se=425,
    fringe_e=(226, 326),
    hole_nw=128,
    hole_ne=129,
    hole_sw=228,
    hole_se=229,
)

#: Tan dirt path — THE road material of the example map (rows 18-22,
#: cols 10-19). Fill tiles are its most-used deco GIDs.
PATH_TAN = Blob(
    name="path_tan",
    fill=(2013, 2014, 2113, 2114),
    nw=1912,
    n=(1913, 1914),
    ne=1915,
    w=(2012, 2112),
    e=(2015, 2115),
    sw=2212,
    s=(2213, 2214),
    se=2215,
    fringe_n=(1813, 1814),
    fringe_w=(2111,),
    fringe_e=(2116,),
    hole_nw=1918,
    hole_ne=1919,
    hole_sw=2018,
    hole_se=2019,
)

#: Brown cobblestone pad with light-gray outline (rows 0-5, cols 31-37).
COBBLE_PAD = Blob(
    name="cobble_pad",
    fill=(233, 234, 235, 236, 333, 334, 335, 336),
    nw=32,
    n=(33, 34, 35, 36),
    ne=37,
    w=(132, 232, 332, 432),
    e=(137, 237, 337, 437),
    sw=532,
    s=(533, 534, 535, 536),
    se=537,
)

#: Seamless brown cobblestone fill block (rows 0-3, cols 37-40).
COBBLE_FILL = (38, 39, 40, 41, 238, 239, 240, 241, 338, 339, 340, 341)

#: Large tan cobble plaza fill (interior of the huge plaza shape at
#: rows 6-15, cols 31-45).
PLAZA_COBBLE_FILL = (
    1036,
    1037,
    1038,
    1039,
    1040,
    1136,
    1137,
    1138,
    1139,
    1140,
    1236,
    1237,
    1238,
    1239,
    1240,
)

#: Gray stone / gravel blob (rows 24-28, cols 0-9).
GRAVEL = Blob(
    name="gravel",
    fill=(2603, 2604, 2703, 2704),
    nw=2502,
    n=(2503, 2504),
    ne=2505,
    w=(2602, 2702),
    e=(2605, 2705),
    sw=2802,
    s=(2803, 2804),
    se=2805,
    hole_nw=2508,
    hole_ne=2509,
    hole_sw=2608,
    hole_se=2609,
)

#: Golden wheat / hay field blob (rows 23-27, cols 31-41).
WHEAT = Blob(
    name="wheat",
    fill=(2534, 2535, 2634, 2635),
    nw=2433,
    n=(2434, 2435),
    ne=2436,
    w=(2533, 2633),
    e=(2536, 2636),
    sw=2733,
    s=(2734, 2735),
    se=2736,
    fringe_n=(2334, 2335),
    fringe_w=(2532, 2632),
    fringe_e=(2537, 2637),
    hole_nw=2439,
    hole_ne=2440,
    hole_sw=2539,
    hole_se=2540,
)

#: Tilled farm field (vertical furrows, rows 18-22, cols 20-30).
FIELD_TILLED = Blob(
    name="field_tilled",
    fill=(2023, 2024, 2123, 2124),
    nw=1922,
    n=(1923, 1924),
    ne=1925,
    w=(2022, 2122),
    e=(2025, 2125),
    sw=2222,
    s=(2223, 2224),
    se=2225,
    fringe_n=(1823, 1824),
    fringe_e=(2026, 2126),
    fringe_s=(2323, 2324),
    hole_nw=1928,
    hole_ne=1929,
    hole_sw=2028,
    hole_se=2029,
)

#: Dark forest soil blob (rows 36-41, cols 0-9).
SOIL_DARK = Blob(
    name="soil_dark",
    fill=(3803, 3804, 3903, 3904),
    nw=3702,
    n=(3703, 3704),
    ne=3705,
    w=(3802, 3902),
    e=(3805, 3905),
    sw=4002,
    s=(4003, 4004),
    se=4005,
    fringe_n=(3603, 3604),
    fringe_e=(3806, 3906),
    fringe_s=(4103, 4104),
    hole_nw=3708,
    hole_ne=3709,
    hole_sw=3808,
    hole_se=3809,
)

#: Dense dark-green canopy / hedge mass (rows 36-40, cols 19-30).
CANOPY_DARK = Blob(
    name="canopy_dark",
    fill=(3823, 3824, 3923, 3924),
    nw=3722,
    n=(3723, 3724),
    ne=3725,
    w=(3822, 3922),
    e=(3825, 3925),
    sw=4022,
    s=(4023, 4024),
    se=4025,
    fringe_n=(3623, 3624),
    hole_nw=3728,
    hole_ne=3729,
    hole_sw=3828,
    hole_se=3829,
)

#: Plain tan-brown dirt fill (rows 24-27, cols 46-49); speckled variants on
#: rows 22-23.
DIRT_TAN_FILL = (2447, 2448, 2449, 2450, 2647, 2648, 2649, 2650)
DIRT_TAN_SPECKLED = (2247, 2248, 2249, 2250, 2347, 2348, 2349, 2350)

#: Dark rounded-boulders ground mass fill (rows 37-40, cols 11-15).
ROCKS_DARK_FILL = (3813, 3814, 3913, 3914)

#: Cave dirt floor fill (brown, rows 60-62, cols 22-28 of the cave kit).
CAVE_DIRT_FILL = (6024, 6025, 6026, 6027, 6124, 6125, 6126, 6127)


# =========================================================================
# COMPACT BIOME STAMPS (rows 59-64, cols 64-81) — grass-baked pads
# =========================================================================

#: Rock-rimmed pond ON bright grass, white foam edge — the example map's
#: lake style. 6x5, grass baked into the outer ring.
POND_GRASS = TileStamp.rect("pond_grass", 60, 65, 6, 5)

#: Rounded tan path pad ON bright grass, 5x5 (rows 60-64, cols 76-80).
PATH_PAD_TAN = TileStamp.rect("path_pad_tan", 60, 76, 5, 5)


# =========================================================================
# PONDS (stone-rimmed kits, rows 6-16)
# =========================================================================

#: Closed pond with gray-stone rim (rows 6-10, cols 1-5).
POND_STONE = TileStamp.rect("pond_stone", 6, 1, 5, 5)

#: Closed pond with terracotta rim (rows 12-16, cols 21-25).
POND_TERRACOTTA = TileStamp.rect("pond_terracotta", 12, 21, 5, 5)

#: Compact 4x5 gray-stone pond (rows 6-10, cols 21-24) whose bottom rim row
#: is swapped for the channel-exit row of the stream kit beside it (row 9,
#: cols 6-9): a calm 2-wide stream leaves through the south rim between the
#: curved rim tails. Continue the course with STREAM_V.
POND_STONE_OUTLET_S = TileStamp(
    "pond_stone_outlet_s",
    (
        _rect(6, 21, 4, 1)[0],
        _rect(7, 21, 4, 1)[0],
        _rect(8, 21, 4, 1)[0],
        _rect(9, 21, 4, 1)[0],
        _rect(9, 6, 4, 1)[0],
    ),
)

#: Straight vertical stream, exactly 2 wide: (left, right) column tiles of
#: calm pond-kit water with a white foam shoreline on the outer edge of
#: each. Repeat down the course; both tile seamlessly with themselves and
#: with the POND_STONE_OUTLET_S exit row.
STREAM_V = (gid(9, 7), gid(9, 8))


# =========================================================================
# CLIFFS (bright-grass plateau kit, rows 80-90, cols 0-6 — example map)
# =========================================================================

#: Tall lime grass on the plateau top (example map floods these).
CLIFF_PLATEAU_FILL = (8202, 8203, 8204, 8205, 8302, 8303, 8304, 8305, 8402, 8403, 8404, 8405)

#: Cliff kit rows, top to bottom, as used at the example map's top-left:
#: organic plateau top edge, plateau fill rows, grass-to-rock lip, rock face,
#: rock bottom edge finishing in grass.
CLIFF_GRASS = {
    "top_edge": (8101, 8102, 8103, 8104, 8105, 8106),
    "west_edge": (8201, 8301, 8401, 8501),
    "east_edge": (8206, 8306, 8406, 8506),
    "lip": (8601, 8602, 8603, 8604, 8605, 8606),  # grass over rock
    "face_upper": (8701, 8702, 8703, 8704, 8705, 8706),  # bare rock
    "face_lower": (8801, 8802, 8803, 8804, 8805, 8806),
    "face_base": (8901, 8902, 8903, 8904, 8905, 8906),
    "bottom_edge": (9001, 9002, 9003, 9004, 9005, 9006),  # rock into grass
}

#: Large rocky outcrops on grass (decorative ridges, rows 85-89).
ROCK_OUTCROP_A = TileStamp.rect("rock_outcrop_a", 85, 19, 5, 5)
ROCK_OUTCROP_B = TileStamp.rect("rock_outcrop_b", 85, 27, 5, 5)


# =========================================================================
# TREES & VEGETATION
# =========================================================================

#: Big light-green tree: canopy + orange trunk + rock base + soft shadow.
#: Exactly the 6x7 block the example map stamps for its light trees.
TREE_LIGHT = TileStamp.rect("tree_light", 49, 2, 6, 7)

#: Big dark-green tree, same construction (example map's dark trees).
TREE_DARK = TileStamp.rect("tree_dark", 49, 8, 6, 7)

#: Small tree, 2x4: round canopy, orange trunk on pebbles.
TREE_SMALL = TileStamp.rect("tree_small", 48, 0, 2, 4)

#: Smaller round-canopy tree, 2x2 (canopy + trunk/pebbles).
TREE_ROUND_SMALL = TileStamp.rect("tree_round_small", 52, 0, 2, 2)

#: Round bush with drop shadow, 2x2.
BUSH_ROUND = TileStamp.rect("bush_round", 54, 0, 2, 2)

#: Fruit trees: broad canopy with orange fruit + brown trunk + shadow
#: (rows 77-81, cols 33-44). Three variants; B has the tallest trunk.
TREE_FRUIT_A = TileStamp.rect("tree_fruit_a", 77, 33, 4, 4)
TREE_FRUIT_B = TileStamp.rect("tree_fruit_b", 77, 37, 4, 5)
TREE_FRUIT_C = TileStamp.rect("tree_fruit_c", 77, 41, 4, 5)

#: NOTE: there are no standalone 1-tile green sprout tiles in this tileset;
#: the tiny nubs at path edges in the example map are PATH_TAN fringe tiles
#: (2111/2116). Use FERN / SNOWDROP / FLOWER_PATCH for small greenery.

#: Leafy fern, 2x2 (example map, right of the fence pen).
FERN = TileStamp.rect("fern", 48, 24, 2, 2)

#: White 4-petal flower singles (example map scatters these on grass).
#: Only the visibly-flowered variants; siblings 5425/5523/5526 are
#: near-empty single-dot tiles and were dropped.
FLOWERS_WHITE = (5423, 5424, 5426, 5524, 5525)

#: 2x2 white-flower cluster (the example map places this as a block).
FLOWER_PATCH = TileStamp.rect("flower_patch", 52, 24, 2, 2)

#: Snowdrop plant with looping stem, 2x2.
SNOWDROP = TileStamp.rect("snowdrop", 52, 26, 2, 2)

#: Carrot / seedling crop singles (rows 48-51, cols 26-27).
CROP_TILES = (4827, 4828, 4927, 4928, 5027, 5028, 5127, 5128)
#: Purple berry crop singles.
CROP_BERRY_TILES = (4829, 4830, 4929, 4930)
#: Climbing bean poles, 2x2.
BEANPOLES = TileStamp.rect("beanpoles", 50, 28, 2, 2)


# =========================================================================
# ROCKS, STUMPS, LOGS
# =========================================================================

#: Big mossy boulder, 3x4 incl. shadow (example map's large rock).
ROCK_BIG = TileStamp.rect("rock_big", 48, 21, 3, 4)
#: Medium round boulder, 2x2.
ROCK_MED = TileStamp.rect("rock_med", 48, 18, 2, 2)
#: Small boulder, 2x2 (example map, under the top-right tree).
ROCK_SMALL = TileStamp.rect("rock_small", 50, 18, 2, 2)
#: Two small stones + pebble singles.
STONES_SMALL = TileStamp.rect("stones_small", 52, 20, 2, 2)
ROCK_TINY_A = 5223
ROCK_TINY_B = 5224
PEBBLE = 5324

#: Blocky gray boulders, 2x2 (rows 83-84).
BOULDER_GRAY_A = TileStamp.rect("boulder_gray_a", 83, 35, 2, 2)
BOULDER_GRAY_B = TileStamp.rect("boulder_gray_b", 83, 37, 2, 2)
#: Round pale-purple boulders, 1x2 each.
BOULDER_PURPLE = tuple(
    TileStamp.rect(f"boulder_purple_{i}", 83, c, 1, 2) for i, c in enumerate((40, 42, 44, 46))
)

#: Wide tree stump, 2x2 (example map, bottom right).
STUMP_WIDE = TileStamp.rect("stump_wide", 50, 16, 2, 2)
#: Tall narrow stump, 1x2.
STUMP_TALL = TileStamp.rect("stump_tall", 48, 17, 1, 2)
#: Fallen log, 2x2 (example map, next to the middle tree).
LOG = TileStamp.rect("log", 50, 24, 2, 2)
#: Long horizontal log, 5x1 (row 33, cols 38-42).
LOG_LARGE = TileStamp.rect("log_large", 33, 38, 5, 1)


# =========================================================================
# FENCES
# =========================================================================

#: Wooden ranch fence kit — layout taken verbatim from the example map's
#: animal pen. Corners/rails are 2 tiles tall (post + shadow row).
#: Horizontal runs alternate rail_h_a / rail_h_b columns; vertical runs
#: stack rail_v blocks.
FENCE_WOOD = {
    "corner_nw": TileStamp("fence_nw", ((2936, 2937), (3036, 3037))),
    "corner_ne": TileStamp("fence_ne", ((2940, 2941), (3040, 3041))),
    "corner_sw": TileStamp("fence_sw", ((3136, 3137), (3236, 3237))),
    "corner_se": TileStamp("fence_se", ((3140, 3141), (3240, 3241))),
    "rail_h_a": TileStamp("fence_h_a", ((3138,), (3238,))),
    "rail_h_b": TileStamp("fence_h_b", ((3139,), (3239,))),
    "rail_v": TileStamp("fence_v", ((2740, 2741), (2840, 2841))),
    "post_pair": TileStamp("fence_posts", ((2738, 2739), (2838, 2839))),
}

#: Industrial metal railing pieces (rows 30-39, cols 80-91).
FENCE_METAL = {
    "bars_v": TileStamp("metal_bars_v", ((3081,), (3181,))),
    "rail_h": TileStamp("metal_rail_h", ((3384, 3385),)),
    "post": TileStamp("metal_post", ((3587,), (3687,), (3787,))),
    "gate": TileStamp.rect("metal_gate", 34, 87, 2, 6),
}

#: Thin horizontal metal bar riding the bottom ~6 px of the tile (metal
#: railing kit, row 33; verified via zoom crop). 3388/3389 tile seamlessly
#: left-right; RAIL_BAR_CAP_W closes a bar's west end, RAIL_BAR_CAP_E its
#: east end. Two parallel courses over a PLANKS_V_DARK tie band read as
#: railroad rails (this tileset has no dedicated rail tiles).
RAIL_BAR_H = (3388, 3389)
RAIL_BAR_CAP_W = 3386
RAIL_BAR_CAP_E = 3387

#: Freestanding bark posts (pergola / hitching posts), 1x2 each.
POST_WOOD_A = TileStamp.rect("post_wood_a", 52, 28, 1, 2)
POST_WOOD_B = TileStamp.rect("post_wood_b", 52, 29, 1, 2)


# =========================================================================
# BUILDINGS — facades, walls, doors, windows
# =========================================================================
# NOTE: this tileset has NO pitched-roof exterior house kit. Buildings are
# composed from these facade walls plus a flat "roof" pad (wood decks /
# dark stone pad below) — see the capability report.

#: Large light-gray brick facade with dark cornice + rounded footer,
#: 6 wide x 6 tall (rows 30-35, cols 20-25).
FACADE_STONE_LARGE = TileStamp.rect("facade_stone_large", 30, 20, 6, 6)

#: Small-brick gray facade variant, 4 wide x 6 tall (cols 26-29).
FACADE_STONE_SMALL = TileStamp.rect("facade_stone_small", 30, 26, 4, 6)

#: Cream stucco facade with terracotta arch doorway, 8 wide x 6 tall
#: (rows 41-46, cols 69-76). Arch spans cols 71-73.
FACADE_CREAM = TileStamp.rect("facade_cream", 41, 69, 8, 6)

#: Timber-braced cream wall band (tudor-ish), 6 wide x 2 tall (rows 39-40).
WALL_TIMBER_BAND = TileStamp.rect("wall_timber_band", 39, 69, 6, 2)

#: Orange brick facade with brick arch + wooden double door, 8 wide x 6 tall
#: (rows 41-46, cols 77-84). Arch spans cols 78-81.
FACADE_BRICK = TileStamp.rect("facade_brick", 41, 77, 8, 6)

#: Gray slate-brick facade with dark arch doorway, 8 wide x 6 tall
#: (rows 41-46, cols 85-92). Arch spans cols 87-90.
FACADE_STONE_GRAY = TileStamp.rect("facade_stone_gray", 41, 85, 8, 6)

#: Banded stone wall section (stacked slabs), 5 wide x 2 tall each;
#: blue-gray and cream variants (rows 30-33, cols 13-17).
WALL_BANDED_BLUE = TileStamp.rect("wall_banded_blue", 30, 13, 5, 2)
WALL_BANDED_CREAM = TileStamp.rect("wall_banded_cream", 32, 13, 5, 2)

#: Rough gray-blue cobbled wall fill (rows 30/33, cols 6-9; middle rows
#: carry a blast-hole motif, avoided here).
WALL_ROUGH_FILL = (3007, 3008, 3009, 3010, 3307, 3308, 3309, 3310)

#: Doors (2x2 unless noted).
DOOR_WOOD = TileStamp.rect("door_wood", 30, 85, 2, 2)
DOOR_METAL = TileStamp.rect("door_metal", 30, 87, 2, 2)
#: Dark open doorway with lit floor gradient, 2x3.
DOORWAY_DARK = TileStamp.rect("doorway_dark", 30, 89, 2, 3)
#: Red door with gold trim, 2x2 (rows 47-48, cols 64-65).
DOOR_RED = TileStamp.rect("door_red", 47, 64, 2, 2)

#: Teal glass window, 2x2 (front view).
WINDOW_TEAL = TileStamp.rect("window_teal", 49, 50, 2, 2)


# =========================================================================
# ROOF-SUBSTITUTE PADS & FLOORS
# =========================================================================

#: Light wood deck pad w/ rounded corners, 5 wide x 6 tall (rows 1-6).
DECK_LIGHT = TileStamp.rect("deck_light", 1, 81, 5, 6)
#: Dark wood deck pad (vertical planks), 5 wide x 6 tall.
DECK_DARK = TileStamp.rect("deck_dark", 1, 87, 5, 6)
#: Horizontal plank strips (boardwalk), light and dark.
PLANKS_LIGHT = (782, 783, 784, 785, 882, 883, 884, 885)
PLANKS_DARK = (788, 789, 790, 791, 888, 889, 890, 891)
#: Interior fill of DECK_DARK (seamless VERTICAL planks with staggered
#: joints). Flooded as a horizontal band it reads as railroad cross-ties;
#: overlay RAIL_BAR_H courses on deco-below to complete a track.
PLANKS_V_DARK = (289, 290, 291, 389, 390, 391, 489, 490, 491, 589, 590, 591)
#: Dark slate stone pad w/ rounded top, 5 wide x 5 tall (rows 1-5, cols 93-97).
STONE_PAD_DARK = TileStamp.rect("stone_pad_dark", 1, 93, 5, 5)

#: Light gray-green cobblestone floor fill (plaza / sidewalk), rows 57-59.
STONE_FLOOR_FILL = (5707, 5708, 5709, 5710, 5807, 5808, 5809, 5810, 5907, 5908, 5909, 5910)
#: Bordered stone-floor room pad, 6x3.
STONE_FLOOR_PAD = TileStamp.rect("stone_floor_pad", 57, 0, 6, 3)

#: Dark square slab floor (interior), 16 variants (rows 10-13, cols 81-84).
SLAB_FLOOR = (
    1082,
    1083,
    1084,
    1085,
    1182,
    1183,
    1184,
    1185,
    1282,
    1283,
    1284,
    1285,
    1382,
    1383,
    1384,
    1385,
)

#: Ornate red carpet, 4x4 (rows 10-13, cols 87-90).
CARPET_RED = TileStamp.rect("carpet_red", 10, 87, 4, 4)


# =========================================================================
# BRIDGES
# =========================================================================

#: Horizontal stone bridge with end posts, 5 wide x 3 tall (rows 85-87).
BRIDGE_STONE = TileStamp.rect("bridge_stone", 85, 35, 5, 3)


# =========================================================================
# STREET & MARKET PROPS
# =========================================================================

#: Victorian street lamp: glass lantern + pole + base shadow, 2x5
#: (rows 39-43, cols 64-65).
LAMPPOST = TileStamp.rect("lamppost", 39, 64, 2, 5)

#: Torch (flame on stick), three animation frames, 2x2 each.
TORCH_FRAMES = tuple(TileStamp.rect(f"torch_{i}", 49, c, 2, 2) for i, c in enumerate((52, 54, 56)))

#: Gray metal grate / vent block, 2x2.
METAL_GRATE = TileStamp.rect("metal_grate", 49, 58, 2, 2)

#: Market stall: red/cream striped awning over a counter, 6 wide x 3 tall
#: (rows 35-37, cols 56-61).
MARKET_STALL = TileStamp.rect("market_stall", 35, 56, 6, 3)

#: Standing shop signboards on posts w/ shadow, 2x2 each (rows 29-30,
#: cols 46-55). Icons, left to right: plank sign, utensils, mug,
#: tent/triangle, pretzel/bakery.
SIGNS_STANDING = tuple(
    TileStamp.rect(f"sign_standing_{i}", 29, c, 2, 2) for i, c in enumerate((46, 48, 50, 52, 54))
)
#: Same five boards, wall-mounted (1 row, rows 31, cols 46-55).
SIGNS_WALL = tuple(
    TileStamp.rect(f"sign_wall_{i}", 31, c, 2, 1) for i, c in enumerate((46, 48, 50, 52, 54))
)
#: Same boards on legged stall frames, 2x2 (rows 33-34).
SIGNS_STALL = tuple(
    TileStamp.rect(f"sign_stall_{i}", 33, c, 2, 2) for i, c in enumerate((46, 48, 50, 52, 54))
)

#: 2x2 container props.
BUCKET = TileStamp.rect("bucket", 29, 56, 2, 2)
CRATE = TileStamp.rect("crate", 29, 58, 2, 2)
BARREL = TileStamp.rect("barrel", 29, 60, 2, 2)
JUG = TileStamp.rect("jug", 29, 62, 2, 2)

#: Menu board / open ledger, 2x2.
MENU_BOARD = TileStamp.rect("menu_board", 31, 56, 2, 2)
#: Stone statue of a robed figure, 2x3.
STATUE = TileStamp.rect("statue", 31, 58, 2, 3)
#: Terracotta planters, 2x2: empty, yellow flowers, purple flowers.
PLANTER_EMPTY = TileStamp.rect("planter_empty", 31, 60, 2, 2)
PLANTER_YELLOW = TileStamp.rect("planter_yellow", 31, 62, 2, 2)
PLANTER_PURPLE = TileStamp.rect("planter_purple", 31, 64, 2, 2)
#: Hanging vertical banners, 1x2, two variants.
BANNER_RED_A = TileStamp.rect("banner_red_a", 33, 56, 1, 2)
BANNER_RED_B = TileStamp.rect("banner_red_b", 33, 57, 1, 2)

#: Food plates, 2x2 each (market dressing).
PLATE_EMPTY = TileStamp.rect("plate_empty", 33, 60, 2, 2)
PLATE_BREAD = TileStamp.rect("plate_bread", 33, 62, 2, 2)
PLATE_SALAD = TileStamp.rect("plate_salad", 33, 64, 2, 2)
PLATE_BERRIES = TileStamp.rect("plate_berries", 35, 62, 2, 2)
PLATE_FISH = TileStamp.rect("plate_fish", 35, 64, 2, 2)

#: Haystack, 4x4 (rows 29-32, cols 31-34).
HAYSTACK = TileStamp.rect("haystack", 29, 31, 4, 4)

#: Stone well with terracotta roof, 4x4 (rows 52-55 — example map).
WELL = TileStamp.rect("well", 52, 16, 4, 4)

#: Spider webs, 2x2, plain + with spider.
WEB_SPIDER = TileStamp.rect("web_spider", 54, 26, 2, 2)
WEB_PLAIN = TileStamp.rect("web_plain", 54, 28, 2, 2)

#: Round side stool, 2x2 (rows 45-46, cols 64-65).
STOOL = TileStamp.rect("stool", 45, 64, 2, 2)


# =========================================================================
# REGISTRY INDICES (for validation / tooling)
# =========================================================================

BLOBS: dict[str, Blob] = {
    b.name: b
    for b in (
        GRASS,
        GRASS_LIGHT,
        WATER_DEEP,
        WATER_SHALLOW,
        MAGMA,
        PATH_TAN,
        COBBLE_PAD,
        GRAVEL,
        WHEAT,
        FIELD_TILLED,
        SOIL_DARK,
        CANOPY_DARK,
    )
}

FILLS: dict[str, tuple[int, ...]] = {
    "grass_bright": GRASS_BRIGHT_FILL,
    "water_lake": WATER_LAKE_FILL,
    "cobble": COBBLE_FILL,
    "plaza_cobble": PLAZA_COBBLE_FILL,
    "dirt_tan": DIRT_TAN_FILL,
    "dirt_tan_speckled": DIRT_TAN_SPECKLED,
    "rocks_dark": ROCKS_DARK_FILL,
    "cave_dirt": CAVE_DIRT_FILL,
    "cliff_plateau": CLIFF_PLATEAU_FILL,
    "stone_floor": STONE_FLOOR_FILL,
    "slab_floor": SLAB_FLOOR,
    "planks_light": PLANKS_LIGHT,
    "planks_dark": PLANKS_DARK,
    "planks_v_dark": PLANKS_V_DARK,
}

STAMPS: dict[str, TileStamp] = {
    s.name: s
    for s in (
        POND_GRASS,
        PATH_PAD_TAN,
        POND_STONE,
        POND_TERRACOTTA,
        POND_STONE_OUTLET_S,
        ROCK_OUTCROP_A,
        ROCK_OUTCROP_B,
        TREE_LIGHT,
        TREE_DARK,
        TREE_SMALL,
        TREE_ROUND_SMALL,
        BUSH_ROUND,
        TREE_FRUIT_A,
        TREE_FRUIT_B,
        TREE_FRUIT_C,
        FERN,
        SNOWDROP,
        BEANPOLES,
        FLOWER_PATCH,
        ROCK_BIG,
        ROCK_MED,
        ROCK_SMALL,
        STONES_SMALL,
        BOULDER_GRAY_A,
        BOULDER_GRAY_B,
        *BOULDER_PURPLE,
        STUMP_WIDE,
        STUMP_TALL,
        LOG,
        LOG_LARGE,
        *FENCE_WOOD.values(),
        *FENCE_METAL.values(),
        POST_WOOD_A,
        POST_WOOD_B,
        FACADE_STONE_LARGE,
        FACADE_STONE_SMALL,
        FACADE_CREAM,
        WALL_TIMBER_BAND,
        FACADE_BRICK,
        FACADE_STONE_GRAY,
        WALL_BANDED_BLUE,
        WALL_BANDED_CREAM,
        DOOR_WOOD,
        DOOR_METAL,
        DOORWAY_DARK,
        DOOR_RED,
        WINDOW_TEAL,
        DECK_LIGHT,
        DECK_DARK,
        STONE_PAD_DARK,
        STONE_FLOOR_PAD,
        CARPET_RED,
        BRIDGE_STONE,
        LAMPPOST,
        *TORCH_FRAMES,
        METAL_GRATE,
        MARKET_STALL,
        *SIGNS_STANDING,
        *SIGNS_WALL,
        *SIGNS_STALL,
        BUCKET,
        CRATE,
        BARREL,
        JUG,
        MENU_BOARD,
        STATUE,
        PLANTER_EMPTY,
        PLANTER_YELLOW,
        PLANTER_PURPLE,
        BANNER_RED_A,
        BANNER_RED_B,
        PLATE_EMPTY,
        PLATE_BREAD,
        PLATE_SALAD,
        PLATE_BERRIES,
        PLATE_FISH,
        HAYSTACK,
        WELL,
        WEB_SPIDER,
        WEB_PLAIN,
        STOOL,
    )
}

SINGLES: dict[str, int] = {
    "rock_tiny_a": ROCK_TINY_A,
    "rock_tiny_b": ROCK_TINY_B,
    "pebble": PEBBLE,
    "rail_bar_a": RAIL_BAR_H[0],
    "rail_bar_b": RAIL_BAR_H[1],
    "rail_bar_cap_w": RAIL_BAR_CAP_W,
    "rail_bar_cap_e": RAIL_BAR_CAP_E,
    "stream_v_left": STREAM_V[0],
    "stream_v_right": STREAM_V[1],
}
SINGLES.update({f"flower_white_{i}": g for i, g in enumerate(FLOWERS_WHITE)})
SINGLES.update({f"crop_{i}": g for i, g in enumerate(CROP_TILES)})
SINGLES.update({f"crop_berry_{i}": g for i, g in enumerate(CROP_BERRY_TILES)})
