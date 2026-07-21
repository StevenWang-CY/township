"""Hand-tuned layout for Millbrook Village (millbrook-budget) — 75x50 tiles.

Reading of the town: a New England mill village bisected by the Stillwater
River. The river is a wavy band across the top third of the map; the 1936
Main Street Bridge crosses it as a concrete deck between rough stone
parapets (the BRIDGE_STONE stamp is horizontal-only and FLIP_D is not
supported by the preview renderer, so the vertical bridge is composed from
deck fill + parapet columns). The memorable set-piece is the Harrow Mill
Ruins on the east riverbank: a roofless stone shell, a brick smokestack
standing over the dam, an exposed slab floor with moss and ferns growing
through it, rubble drifts, and a rusty metal railing along the fenced-off
south approach. Melancholy — no lamps east of the town hall block.

Grid plan (cols x rows):
  - Stillwater River ..... wavy water band rows 3-8, full map width
  - dam .................. stone weir cols 59-60 across the water
  - Main Street Bridge ... deck cols 34-36 / parapets cols 33+37, rows 2-9
  - Bridge Street ........ vertical road cols 34-36 (exits north edge),
                           jogs west on River Street rows 12-14, then south
                           on Mill Street cols 24-26 down to Main Street
  - Main Street .......... horizontal road rows 25-27, west + east exits
  - farmers market green . cols 11-21 rows 11-16 (stall, cider stand, jam
                           table on the old mill green)
  - Wheelhouse Diner ..... cols 16-22 rows 17-22, corner of Mill & Main
  - town hall + green .... hall cols 32-40 rows 17-23; memorial green with
                           statue cols 27-31
  - Harrow Mill Ruins .... cols 52-65 rows 10-19 + greenway path on the bank
  - shops south of Main .. Corbin's Hardware cols 21-27, general store
                           cols 29-33, library cols 40-47, all row 30 down
  - Chestnut Row ......... three attached row houses cols 4-15 rows 30-35
  - shops lane ........... row 37, exits the west edge and ties into Main
                           Street at cols 17-18 and cols 48-49
"""

from __future__ import annotations

import random

from mapgen import moderntiles as M
from mapgen import tiles as R
from mapgen.build_maps import (
    MapCanvas,
    apron,
    grand,
    path,
    path_rect,
    storefront,
)
from mapgen.tiles import TileStamp


def compose(m: MapCanvas) -> None:
    m.rng.seed(1874)  # deterministic builds (town hall's year)
    rng = m.rng

    # ================= ground tone =================
    m.base_grass()
    m.meadow(10, 10, 13, 7)  # farmers market green
    m.meadow(27, 17, 5, 7)  # memorial green by the town hall
    m.meadow(44, 0, 16, 3)  # far bank clearing
    m.meadow(52, 39, 16, 8)  # SE orchard meadow
    m.meadow(12, 40, 14, 7)  # south meadow
    m.meadow(2, 16, 8, 6)  # west woods clearing

    # ================= Stillwater River =================
    shore = random.Random(19)
    top, bot = 4, 8
    tops: dict[int, int] = {}
    bots: dict[int, int] = {}
    river: set[tuple[int, int]] = set()
    for x in range(m.w):
        if shore.random() < 0.22:
            top = 3 if top == 4 else 4
        if shore.random() < 0.22:
            bot = 7 if bot == 8 else 8
        tops[x], bots[x] = top, bot
        for y in range(top, bot + 1):
            river.add((x, y))
    m.blob("ground-detail", river, R.WATER_DEEP)
    for c in river:
        m.reserved.add(c)
    # water is impassable except under the bridge (cols 33-37)
    m.collide(0, 3, 33, 6)
    m.collide(38, 3, 37, 6)
    for fx in (7, 18, 28, 46, 55, 68):
        m.anchor("water-foam", fx, tops[fx] + 1)

    # ---- the dam (stone weir the mill once drew from)
    for x in (59, 60):
        for y in range(tops[x], bots[x] + 1):
            m.set("ground-detail", x, y, rng.choice(R.WALL_ROUGH_FILL))
    m.stamp("deco-below", R.ROCK_SMALL, 59, min(tops[59], tops[60]) - 2)
    m.stamp("deco-below", R.ROCK_SMALL, 59, max(bots[59], bots[60]) + 1)
    m.collide(59, max(bots[59], bots[60]) + 1, 2, 2)
    m.anchor("water-foam", 61, 5)
    m.anchor("water-foam", 61, 7)

    # ================= roads =================
    m.road_h(25, 0, 74, width=3)  # Main Street, west + east exits
    m.road_v(34, 0, 2, width=3)  # Bridge St north stub (exit)
    m.road_v(34, 10, 14, width=3)  # Bridge St south of the river
    m.road_h(12, 24, 36, width=3)  # River Street jog
    m.road_v(24, 12, 27, width=3)  # Mill Street down to Main

    # ================= buildings (reserve before paint_roads) =============
    # -- Millbrook Town Hall: white clapboard, 1874
    grand(m, 32, 17, 9, 7, facade="cream", roof="deck_light", windows=True)
    # -- The Wheelhouse Diner, corner of Mill & Main
    storefront(m, 16, 17, 7, 6, facade="brick", awning=True)
    # -- Corbin's Hardware
    storefront(m, 21, 30, 7, 5, facade="brick", sign=0)
    # -- small general store beside it
    storefront(m, 29, 30, 5, 5, facade="cream", roof="deck_light", awning=True)
    # -- Millbrook Free Library (Carnegie-style brick)
    grand(m, 40, 30, 8, 7, facade="brick", roof="stone", windows=True)
    # -- Chestnut Row: three attached mill row houses
    storefront(m, 4, 30, 4, 6, facade="brick", roof="deck_dark", window=False)
    storefront(m, 8, 30, 4, 6, facade="cream", roof="deck_light", window=False)
    storefront(m, 12, 30, 4, 6, facade="brick", roof="deck_dark", window=False)

    # ================= paint the road network =================
    m.paint_roads()

    # ================= Main Street Bridge =================
    # light concrete deck over the water, rough stone parapets both sides
    for y in range(3, 10):
        for x in (34, 35, 36):
            m.set("ground-detail", x, y, rng.choice(M.SIDEWALK.fill))
    for y in range(2, 10):
        m.set("buildings-base", 33, y, rng.choice(R.WALL_ROUGH_FILL))
        m.set("buildings-base", 37, y, rng.choice(R.WALL_ROUGH_FILL))
    m.collide(33, 2, 1, 8)
    m.collide(37, 2, 1, 8)
    m.lamp(32, 11)
    m.lamp(38, 11)

    # ================= Harrow Mill Ruins set-piece =================
    # exposed mill floor slab with ragged edges (pale mossy concrete)
    slab: set[tuple[int, int]] = set()
    for y in range(11, 18):
        for x in range(52, 65):
            edge = min(x - 52, 64 - x, y - 11, 17 - y)
            if edge >= 1 or rng.random() < 0.6:
                slab.add((x, y))
    for x, y in slab:
        m.set("ground-detail", x, y, rng.choice(R.PLAZA_COBBLE_FILL))
    # moss breaking through the old floor
    m.blob("ground-detail", {(55, 12), (56, 12), (55, 13), (56, 13)}, R.GRASS_LIGHT, holes=False)
    m.blob("ground-detail", {(61, 16), (62, 16), (61, 17), (62, 17)}, R.GRASS_LIGHT, holes=False)
    # -- the brick shell: FACADE_BRICK rows 2-5 are seamless brick and
    #    col 0 / col 5 are opaque at every row; rows 0-1 of cols 6-7 hold
    #    the roofline transparency and are avoided. Three stepped blocks
    #    collapse eastward toward the smokestack.
    br = R.FACADE_BRICK.gids
    tall = TileStamp(
        "ruin_tall",
        (
            (br[0][0], br[0][2], br[0][3]),
            (br[1][0], br[1][5], br[2][5]),
            (br[2][0], br[2][5], br[3][5]),
            (br[3][0], br[3][5], br[4][5]),
            (br[4][0], br[4][5], br[5][5]),
            (br[5][0], br[5][5], br[3][5]),
        ),
    )
    m.building_stamp(tall, 52, 11, top_rows=1)
    m.stamp("buildings-base", R.DOORWAY_DARK, 53, 14)  # gaping doorway
    m.collide(52, 11, 3, 6)
    mid = TileStamp("ruin_mid", tuple((br[r][5], br[r][6], br[r][7]) for r in (3, 4, 5)))
    m.stamp("buildings-base", mid, 55, 14)
    m.collide(55, 14, 3, 3)
    stub = TileStamp(
        "ruin_stub",
        (
            (0, br[4][5], 0),
            (br[4][6], br[5][5], br[5][6]),
        ),
    )
    m.stamp("buildings-base", stub, 59, 15)
    m.collide(59, 15, 3, 2)
    # the smokestack, still standing over the dam
    stack = TileStamp(
        "mill_stack",
        ((br[0][2], br[0][3]),)
        + tuple((br[2 + r % 4][5], br[2 + (r + 2) % 4][5]) for r in range(6)),
    )
    m.building_stamp(stack, 62, 7, top_rows=4)
    m.collide(62, 11, 2, 3)
    # rubble drifts, clustered at the broken wall ends
    m.stamp("deco-below", R.ROCK_MED, 56, 10)
    m.collide(56, 11, 2, 1)
    m.stamp("deco-below", R.STONES_SMALL, 60, 11)
    m.stamp("deco-below", R.ROCK_SMALL, 57, 16)
    m.collide(57, 16, 2, 1)
    m.set("deco-below", 61, 13, R.ROCK_TINY_A)
    m.set("deco-below", 59, 12, R.PEBBLE)
    m.set("deco-below", 57, 12, R.ROCK_TINY_B)
    m.stamp("deco-below", R.ROCK_BIG, 65, 13)
    m.collide(65, 14, 3, 3)
    # ferns and old timber reclaiming the floor
    m.stamp("deco-below", R.FERN, 59, 13)
    m.stamp("deco-below", R.FERN, 63, 14)
    m.stamp("deco-below", R.FERN, 53, 17)
    m.stamp("deco-below", R.LOG, 55, 18)
    m.stamp("deco-below", R.STUMP_WIDE, 67, 16)
    m.collide(67, 17, 2, 1)
    # rusty railing fencing off the south approach, gate gap at cols 56-57
    fm = R.FENCE_METAL
    for x in (52, 54):
        m.stamp("deco-below", fm["rail_h"], x, 18)
    for x in (58, 60, 62):
        m.stamp("deco-below", fm["rail_h"], x, 18)
    m.stamp("deco-below", fm["post"], 64, 16)
    m.collide(52, 18.4, 4, 0.6)
    m.collide(58, 18.4, 6, 0.6)
    m.collide(64, 17, 1, 2)
    m.stamp("deco-below", R.SIGNS_STANDING[0], 54, 19)  # DANGER — KEEP OUT
    m.collide(54, 20, 2, 1)
    path_rect(m, 56, 19, 2, 5)  # entrance path from Main Street
    # trees closing in around the ruins
    m.tree(48, 11, stamp="tree_dark")
    m.tree(49, 19, stamp="tree_dark")
    m.tree(68, 12, stamp="tree_dark")
    m.tree(70, 18, stamp="tree_light")

    # ---- riverside greenway path: bridge -> ruins -> east edge
    greenway: set[tuple[int, int]] = set()
    for x in range(38, 75):
        greenway.add((x, 9 if 56 <= x <= 66 else 10))
    for x in range(38, 47):
        greenway.add((x, 9))
    path(m, greenway)
    m.set("deco-below", 45, 9, M.mg("bench_h"))  # bench facing the water
    m.collide(45, 9, 1, 1)
    m.flowers(48, 11, n=5, spread=2)

    # ================= farmers market green =================
    m.stamp("deco-below", R.MARKET_STALL, 13, 12)
    m.collide(13, 13, 6, 2)
    m.stamp("deco-below", R.SIGNS_STALL[2], 11, 14)  # cider stand
    m.collide(11, 15, 2, 1)
    m.stamp("deco-below", R.SIGNS_STALL[4], 19, 14)  # jam table
    m.collide(19, 15, 2, 1)
    m.stamp("deco-below", R.MENU_BOARD, 11, 12)
    m.collide(11, 12, 2, 2)
    m.stamp("deco-below", R.CRATE, 12, 16)
    m.stamp("deco-below", R.BARREL, 14, 16)
    m.collide(12, 16, 4, 2)
    path_rect(m, 22, 13, 1, 2)  # market gate to Mill Street
    m.tree(11, 10, stamp="tree_dark")  # the old green's maple
    m.flowers(17, 16, n=6, spread=2)
    m.lamp(21, 15)

    # ================= town hall + memorial green =================
    apron(m, 32, 24, 9, 1)  # forecourt onto Main St sidewalk
    m.set("deco-below", 33, 24, M.mg("planter_box"))
    m.collide(33.1, 24.3, 0.8, 0.7)
    m.set("deco-below", 39, 24, M.mg("planter_box"))
    m.collide(39.1, 24.3, 0.8, 0.7)
    m.stamp("deco-below", R.STATUE, 28, 17)  # war memorial
    m.collide(28, 18, 2, 2)
    m.set("deco-below", 28, 20, M.mg("bench_h"))
    m.set("deco-below", 30, 20, M.mg("bench_h"))
    m.collide(28, 20, 1, 1)
    m.collide(30, 20, 1, 1)
    path_rect(m, 29, 21, 2, 3)  # green down to the sidewalk
    m.flowers(28, 22, n=6, spread=2)
    m.flowers(31, 18, n=4, spread=1)
    m.lamp(27, 21)

    # ================= diner corner =================
    apron(m, 18, 23, 2, 1)
    m.stamp("deco-below", R.SIGNS_STANDING[1], 21, 21)  # utensils board
    m.collide(21, 22, 2, 1)
    m.set("deco-below", 23, 16, M.mg("newsbox"))
    m.collide(23.2, 16.3, 0.6, 0.7)
    # side patio: two stools under the west window
    m.fill("ground-detail", 13, 19, 3, 3, R.STONE_FLOOR_FILL)
    m.stamp("deco-below", R.STOOL, 13, 19)
    m.stamp("deco-below", R.STOOL, 14, 20)
    m.collide(13, 19, 3, 2)
    m.stamp("deco-below", R.PLANTER_PURPLE, 13, 17)
    m.collide(13, 17, 2, 2)

    # ================= south shops row =================
    apron(m, 23, 35, 2, 1)  # hardware doorstep
    path_rect(m, 23, 36, 2, 1)
    m.stamp("deco-below", R.BARREL, 19, 33)  # nail barrels
    m.stamp("deco-below", R.CRATE, 19, 31)
    m.collide(19, 31, 2, 4)
    apron(m, 30, 35, 2, 1)  # general store doorstep
    path_rect(m, 30, 36, 2, 1)
    apron(m, 43, 37, 2, 1)  # library arch onto the lane
    m.set("deco-below", 39, 36, M.mg("newsbox"))
    m.collide(39.2, 36.3, 0.6, 0.7)
    m.stamp("deco-below", R.PLANTER_PURPLE, 51, 34)  # beside the lane bend
    m.collide(51, 34, 2, 2)

    # ================= Chestnut Row =================
    for hx in (5, 9, 13):
        apron(m, hx, 36, 2, 1, material="path")
    m.flowers(5, 38, n=4, spread=1)
    m.flowers(11, 38, n=4, spread=1)
    m.stamp("deco-below", R.PLANTER_YELLOW, 2, 34)
    m.collide(2, 34, 2, 2)

    # shops lane: Chestnut Row -> hardware -> library. Exits the west map
    # edge and ties into Main Street twice — a connector between Chestnut
    # Row and the hardware, and the curl east of the library — so the row
    # fronts a real loop street, not a dead-end rear path.
    lane: set[tuple[int, int]] = set()
    for x in range(-2, 50):  # off-map cells kill the end cap
        lane.add((x, 37))
    for y in range(28, 37):  # connector west of the hardware
        lane.add((17, y))
        lane.add((18, y))
    for y in range(28, 37):  # curl up to Main St east of library
        lane.add((48, y))
        lane.add((49, y))
    path(m, lane)
    # lane mouths butt flush against Main Street's asphalt curb
    for mx in (17, 18, 48, 49):
        m.set("ground-detail", mx, 28, rng.choice(R.PATH_TAN.fill))

    # ---- widows' vegetable garden south of the lane
    f = R.FENCE_WOOD
    m.stamp("deco-below", f["corner_nw"], 5, 40)
    m.stamp("deco-below", f["corner_ne"], 9, 40)
    m.stamp("deco-below", f["corner_sw"], 5, 44)
    m.stamp("deco-below", f["corner_se"], 9, 44)
    for i, x in enumerate(range(7, 9)):
        m.stamp("deco-below", f["rail_h_a" if i % 2 == 0 else "rail_h_b"], x, 40)
        m.stamp("deco-below", f["rail_h_a" if i % 2 else "rail_h_b"], x, 44)
    m.stamp("deco-below", f["rail_v"], 5, 42)
    m.stamp("deco-below", f["rail_v"], 9, 42)
    m.collide(5, 40, 6, 1)
    m.collide(5, 44, 6, 1)
    m.collide(5, 41, 1, 3)
    m.collide(10, 41, 1, 3)
    for gx in range(6, 9):
        m.set("deco-below", gx, 42, rng.choice(R.CROP_TILES))
        m.set("deco-below", gx, 43, rng.choice(R.CROP_BERRY_TILES))

    # ================= SE orchard =================
    for ox, oy, st in (
        (55, 41, "tree_fruit_a"),
        (59, 44, "tree_fruit_b"),
        (63, 40, "tree_fruit_a"),
        (67, 44, "tree_fruit_c"),
        (71, 41, "tree_fruit_a"),
    ):
        m.tree(ox, oy, stamp=st)
    m.flowers(61, 42, n=5, spread=2)
    m.stamp("deco-below", R.BEANPOLES, 55, 45)

    # ================= tree fringes (clustered) =================
    # far bank: dark woods across the river (the Crossing side)
    for x, y in (
        (2, 1),
        (6, 2),
        (12, 1),
        (17, 2),
        (22, 1),
        (27, 2),
        (41, 2),
        (47, 1),
        (52, 2),
        (58, 1),
        (64, 2),
        (70, 1),
        (73, 2),
    ):
        m.tree(x, y, stamp=rng.choice(("tree_dark", "tree_dark", "tree_light")))
    m.stamp("deco-below", R.BUSH_ROUND, 44, 1)
    m.stamp("deco-below", R.FERN, 30, 1)
    # west woods between the market and Chestnut Row
    for x, y in ((2, 12), (6, 14), (3, 19), (8, 20), (1, 23)):
        m.tree(x, y, stamp=rng.choice(("tree_light", "tree_dark")))
    m.stamp("deco-below", R.ROCK_MED, 6, 17)
    m.stamp("deco-below", R.BUSH_ROUND, 4, 16)
    # west riverbank strip
    m.stamp("deco-below", R.BUSH_ROUND, 12, 9)
    m.stamp("deco-below", R.BUSH_ROUND, 26, 9)
    m.stamp("deco-below", R.FERN, 5, 9)
    m.flowers(30, 10, n=4, spread=1)
    # riverbank meadow east of the hall
    m.tree(44, 14, stamp="tree_round_small")
    m.tree(47, 17, stamp="tree_light")
    m.stamp("deco-below", R.BUSH_ROUND, 42, 16)
    m.flowers(45, 19, n=5, spread=2)
    m.stamp("deco-below", R.BUSH_ROUND, 41, 19)
    m.flowers(43, 22, n=4, spread=1)
    # quiet block east of the library
    for x, y in ((58, 32), (63, 35), (70, 31)):
        m.tree(x, y, stamp=rng.choice(("tree_light", "tree_dark")))
    m.flowers(66, 33, n=4, spread=2)
    m.stamp("deco-below", R.BUSH_ROUND, 54, 34)
    # Main Street maples
    m.tree(16, 29, stamp="tree_light")
    m.tree(51, 29, stamp="tree_light")
    # south meadow clusters
    for x, y in ((17, 44), (21, 47), (30, 43), (37, 46), (44, 42)):
        m.tree(x, y, stamp=rng.choice(("tree_light", "tree_dark", "tree_round_small")))
    m.stamp("deco-below", R.ROCK_SMALL, 33, 45)
    m.stamp("deco-below", R.FERN, 26, 45)
    # bottom fringe, canopies cropped by the map edge
    for x, y in ((3, 49), (10, 48), (28, 49), (41, 49), (57, 49), (69, 48)):
        m.tree(x, y, stamp=rng.choice(("tree_light", "tree_dark")))
    m.flowers(18, 41, n=5, spread=2)
    m.flowers(35, 41, n=4, spread=2)
    m.flowers(46, 46, n=5, spread=2)

    # ================= Main Street furniture =================
    for x in (8, 30, 44, 58):
        m.lamp(x, 24)
    for x in (3, 19, 36, 47, 63, 72):
        m.lamp(x, 28)
    m.set("deco-below", 14, 24, M.mg("hydrant"))
    m.collide(14.2, 24.3, 0.6, 0.7)
    m.set("deco-below", 31, 24, M.mg("mailbox"))
    m.collide(31.2, 24.2, 0.6, 0.8)
    m.set("deco-below", 27, 28, M.mg("trash_bin"))
    m.collide(27.2, 28.3, 0.6, 0.7)
    m.set("ground-detail", 12, 27, M.mg("storm_drain"))
    m.set("ground-detail", 55, 25, M.mg("storm_drain"))
    # angled parking marks by the diner and across from the library
    for x in (17, 19, 21):
        m.set("ground-detail", x, 25, M.mg("parking_stall"))
    for x in (43, 45, 47):
        m.set("ground-detail", x, 25, M.mg("parking_stall"))

    # ================= map edge walls + labels =================
    m.collide(0, -1, m.w, 1)
    m.collide(0, m.h, m.w, 1)
    m.collide(-1, 0, 1, m.h)
    m.collide(m.w, 0, 1, m.h)

    # the river and bridge landmarks overlap, so their centered labels
    # collide on the bridge deck; nudge the river label to the west reach
    # and drop the bridge label to the south approach
    label_pos = {
        "Stillwater River": (13.0, 4.5),
        "Main Street Bridge": (34.5, 9.5),
    }
    for lm in m.landmarks.values():
        lx, ly = label_pos.get(lm.name, (lm.x + lm.w / 2 - 0.5, lm.y + lm.h / 2 - 1))
        m.anchor("label", lx, ly, name=lm.name, text=lm.name)
