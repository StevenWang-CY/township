"""Hand-tuned layout for Harlow Crossing (millbrook-budget) — 75x50 tiles.

Reading of the town: the growth side of the Stillwater. Route 9 is the spine
— the strip that carries 14,000 cars and every school bus in town — and
everything young about Harlow hangs off it: the plaza shopping row behind its
big parking lot, Rocco's Slice House, the 1968 brick elementary school with
its fenced playfield, the volunteer firehouse on its poured slab, Fairview's
subdivision loop of cream cottages, and the rec-league Community Fields down
at the river bend that flood every April.

The memorable set-piece is the center of the map: the namesake crossing —
one straight north-south street (Crossing Road) meeting Route 9 in a clean
four-way junction with a single zebra set, the school on its NE shoulder and
the firehouse (brick, twin metal bay doors, red pancake-breakfast bunting)
on its SE. The Stillwater river runs the whole east edge — Route 9 crosses
it on a stone bridge toward Millbrook Village.

Grid plan (cols x rows):
  - Route 9 ............ horizontal road rows 24-26, west exit + east bridge
  - Crossing Road ...... vertical road cols 35-37 straight through the map
                         (north + south exits); its four-way junction with
                         Route 9 is the namesake crossing, zebras cols 34/38
  - plaza strip ........ storefront row rows 13-18, walk row 19, parking lot
                         rows 20-22 (stalls, cart corral, hydrant)
  - Rocco's ............ cols 29-34 rows 15-20, striped awning
  - school ............. cols 41-51 rows 9-16, forecourt + bus stop,
                         fenced playground cols 52-59 (sand pit, climb bar)
  - church ............. cols 56-62 rows 16-22, garden + open memorial plot
  - firehouse .......... cols 39-46 rows 29-35, wide apron rows 36-38
  - Fairview loop ...... narrow streets cols 6-7 / 23-24 + lane rows 42-43,
                         three flat-roof homes (door + window fronts)
  - Community Fields ... light-grass pitch cols 54-65 rows 33-41 with chalk
                         lines and metal goals, by the river bend
  - Stillwater river ... east edge, bend into the SE corner, stone bridge
"""

from __future__ import annotations

from mapgen import moderntiles as M
from mapgen import tiles as R
from mapgen.build_maps import (
    MapCanvas,
    facade_wall,
    grand,
    pad_stamp,
    path,
    path_rect,
    storefront,
)


def _river_cells(m: MapCanvas) -> set[tuple[int, int]]:
    """Stillwater river: straight along the east edge, bending west into
    the SE corner at the Community Fields."""
    cells: set[tuple[int, int]] = set()
    for y in range(m.h):
        if y <= 4:
            xw = 71
        elif y <= 30:
            xw = 70
        elif y <= 36:
            xw = 69
        elif y <= 39:
            xw = 68
        elif y <= 43:
            xw = 66
        else:
            xw = 65
        for x in range(xw, m.w):
            cells.add((x, y))
    return cells


def _fence_pen(
    m: MapCanvas, x: int, y: int, w: int, h: int, gate_cols: tuple[int, ...] = ()
) -> None:
    """Wood ranch-fence rectangle, dover-pen construction. (x, y) is the NW
    corner post; outer size w x h tiles (w >= 5, h >= 5). ``gate_cols``
    leaves openings in the south rail run."""
    f = R.FENCE_WOOD
    m.stamp("deco-below", f["corner_nw"], x, y)
    m.stamp("deco-below", f["corner_ne"], x + w - 2, y)
    m.stamp("deco-below", f["corner_sw"], x, y + h - 2)
    m.stamp("deco-below", f["corner_se"], x + w - 2, y + h - 2)
    for i, rx in enumerate(range(x + 2, x + w - 2)):
        m.stamp("deco-below", f["rail_h_a" if i % 2 == 0 else "rail_h_b"], rx, y)
        if rx not in gate_cols:
            m.stamp("deco-below", f["rail_h_a" if i % 2 else "rail_h_b"], rx, y + h - 2)
            m.collide(rx, y + h - 2, 1, 1)
    for ry in range(y + 2, y + h - 2, 2):
        m.stamp("deco-below", f["rail_v"], x, ry)
        m.stamp("deco-below", f["rail_v"], x + w - 2, ry)
    m.collide(x, y, w, 1)
    m.collide(x, y + h - 2, 2, 1)
    m.collide(x + w - 2, y + h - 2, 2, 1)
    m.collide(x, y, 1, h - 1)
    m.collide(x + w - 1, y, 1, h - 1)


def compose(m: MapCanvas) -> None:
    rng = m.rng

    # ================= ground tone =================
    m.base_grass()
    m.meadow(1, 1, 13, 9)  # NW orchard meadow
    m.meadow(27, 2, 9, 8)  # north-center clearing
    m.meadow(41, 18, 12, 5)  # school front lawn
    m.meadow(2, 28, 4, 12)  # west verge of Fairview
    m.meadow(26, 44, 14, 5)  # south band

    # ================= Stillwater river (before roads) =================
    river = _river_cells(m)
    m.blob("ground-detail", river, R.WATER_DEEP)
    for cell in river:
        m.reserved.add(cell)
    m.collide(65, 44, 10, 6)
    m.collide(66, 40, 9, 4)
    m.collide(68, 37, 7, 3)
    m.collide(69, 31, 6, 6)
    m.collide(70, 0, 5, 31)

    # ================= roads =================
    m.road_h(24, 0, 69, width=3)  # Route 9, west exit -> bridge
    # Crossing Road: ONE straight north-south street through Route 9 —
    # its four-way junction is the namesake crossing (no dogleg)
    m.road_v(35, 0, 49, width=3)
    # Fairview subdivision loop (narrow residential streets)
    m.road_v(6, 27, 43, width=2)
    m.road_v(23, 27, 43, width=2)
    m.road_h(42, 0, 24, width=2)  # Fairview Lane, west exit

    # plaza parking lot: rows 20-22 with a driveway onto Route 9
    lot = {(x, y) for x in range(9, 28) for y in range(20, 23)}
    lot |= {(x, 23) for x in range(17, 20)}  # driveway mouth
    m.road_mask |= lot

    # ================= paved forecourts (join the sidewalk net) ==========
    m.pave(9, 19, 19, 1)  # walk in front of the plaza strip
    m.pave(38, 17, 18, 2)  # school forecourt, meets the road walk
    m.pave(38, 36, 10, 3)  # firehouse apron (the wide slab)
    m.pave(31, 21, 2, 2)  # Rocco's doorstep

    # ================= buildings (reserve before paint_roads) =============
    # -- plaza strip: pharmacy / bank / barber / laundromat
    storefront(m, 9, 13, 5, 6, facade="brick", sign=0)  # pharmacy
    storefront(m, 14, 13, 4, 6, facade="stone_small", roof="stone", window=False, sign=None)  # bank
    storefront(m, 18, 13, 4, 6, facade="cream", awning=True)  # barber
    storefront(m, 22, 13, 5, 6, facade="cream", roof="stone", sign=None)  # laundromat
    # -- Rocco's Slice House
    storefront(m, 29, 15, 6, 6, facade="brick", awning=True)
    # -- Harlow Elementary School (1968 brick, arch entry)
    grand(m, 41, 9, 11, 8, facade="brick", windows=True)
    # -- Harlow Congregational Church (1841, whitewashed)
    grand(m, 56, 15, 7, 8, facade="cream", roof="stone")
    # -- Harlow Firehouse (hand-composed: twin metal bays + red bunting),
    #    on the crossing's SE shoulder, fronting Crossing Road's sidewalk
    m.reserve(39, 28, 8, 8)
    m.stamp("buildings-top", pad_stamp(R.DECK_DARK, 8, 4), 39, 29)
    m.stamp("buildings-base", facade_wall("brick", 8, rows=[3, 4, 5]), 39, 33)
    m.stamp("buildings-base", R.DOOR_METAL, 40, 34)
    m.stamp("buildings-base", R.DOOR_METAL, 44, 34)
    m.stamp("buildings-base", R.BANNER_RED_A, 42, 33)
    m.stamp("buildings-base", R.BANNER_RED_B, 43, 33)
    m.collide(39, 29, 8, 7)
    # -- Fairview homes: flat deck roofs over plain brick/cream fronts with
    #    a real door + window each, matching the town's building language
    storefront(m, 9, 34, 6, 7, facade="cream", roof="deck_light", door_dx=3, sign=None)
    storefront(m, 16, 34, 6, 7, facade="brick", roof="deck_dark", door_dx=3, sign=None)
    storefront(m, 26, 34, 6, 7, facade="cream", roof="stone", door_dx=3, sign=None)

    # ================= paint the road network =================
    m.paint_roads(crosswalks=False)
    # one zebra set flanking the namesake four-way crossing
    for x in (34, 38):
        for y in (24, 25, 26):
            m.set("ground-detail", x, y, M.mg("crosswalk_h"))

    # ================= stone bridge over the Stillwater ==================
    m.stamp("ground-detail", R.BRIDGE_STONE, 70, 24)
    m.collide(70, 24, 5, 1)
    m.collide(70, 26, 5, 1)

    # ================= plaza set-piece dressing =================
    # nose-in stalls against the storefront walk, second row along the aisle
    for x in (10, 12, 14, 20, 22, 24, 26):
        m.set("ground-detail", x, 20, M.mg("parking_stall"))
    for x in (10, 12, 14, 16, 20, 22):
        m.set("ground-detail", x, 22, M.mg("parking_stall") | R.FLIP_V)
    m.set("ground-detail", 18, 22, M.mg("storm_drain"))
    m.lamp(28, 21)  # lot light on the sidewalk edge, clear of the stalls
    # cart corral improvised from metal railing
    m.stamp("deco-below", R.FENCE_METAL["rail_h"], 24, 21)
    m.stamp("deco-below", R.FENCE_METAL["rail_h"], 24, 22)
    m.collide(24, 21.4, 2, 1.2)
    # street furniture on the storefront walk
    m.set("deco-below", 15, 19, M.mg("planter_box"))
    m.collide(15.1, 19.3, 0.8, 0.7)
    m.set("deco-below", 21, 19, M.mg("planter_box"))
    m.collide(21.1, 19.3, 0.8, 0.7)
    m.set("deco-below", 27, 19, M.mg("newsbox"))
    m.collide(27.2, 19.3, 0.6, 0.7)
    m.set("deco-below", 9, 19, M.mg("mailbox"))
    m.collide(9.2, 19.2, 0.6, 0.8)
    m.set("deco-below", 26, 23, M.mg("hydrant"))
    m.collide(26.2, 23.3, 0.6, 0.7)
    m.stamp("deco-below", R.SIGNS_STANDING[0], 15, 23)  # plaza sign
    m.collide(15, 23.6, 2, 0.4)
    m.lamp(8, 19)
    m.stamp("deco-below", M.BUS_SIGN, 4, 22)  # strip bus stop
    m.collide(4.3, 23.3, 0.4, 0.7)

    # ================= Rocco's frontage =================
    m.stamp("deco-below", R.SIGNS_STANDING[1], 33, 21)  # utensils board
    m.collide(33, 22.6, 2, 0.4)
    m.stamp("deco-below", R.STOOL, 29, 21)
    m.collide(29, 21, 1, 1)
    # on-street stalls out front (the washboard curb)
    m.set("ground-detail", 30, 24, M.mg("parking_stall"))
    m.set("ground-detail", 32, 24, M.mg("parking_stall"))
    m.set("ground-detail", 13, 26, M.mg("storm_drain"))  # Culvert 9 grates
    m.set("ground-detail", 8, 26, M.mg("storm_drain"))

    # ================= school zone =================
    m.stamp("deco-below", M.BUS_SIGN, 41, 17)  # bus loop stop
    m.collide(41.3, 18.3, 0.4, 0.7)
    m.set("deco-below", 51, 18, M.mg("bench_h"))
    m.collide(51, 18, 1, 1)
    m.set("deco-below", 49, 17, M.mg("planter_box"))
    m.collide(49.1, 17.3, 0.8, 0.7)
    m.lamp(40, 17)
    # fenced playground with a south gate onto the forecourt walk:
    # mown play lawn, sand pit, low climbing bar, bench — schoolyard, not
    # a lumber pen
    _fence_pen(m, 52, 7, 8, 8, gate_cols=(54, 55))
    m.meadow(53, 8, 6, 5)
    path(m, {(55, 9), (56, 9), (57, 9), (55, 10), (56, 10), (57, 10)})  # sand pit
    m.stamp("deco-below", R.FENCE_METAL["rail_h"], 53, 9)  # climbing bar
    m.collide(53, 9.4, 2, 0.6)
    m.set("deco-below", 57, 12, M.mg("bench_h"))
    m.collide(57, 12, 1, 1)
    m.stamp("deco-below", R.FLOWER_PATCH, 53, 11)
    m.flowers(54, 12, n=3, spread=1)
    path(m, {(54, 14), (55, 14), (54, 15), (55, 15), (54, 16), (55, 16)})
    # school lawn sign by the zebra
    m.stamp("deco-below", R.SIGNS_STANDING[3], 41, 21)
    m.collide(41, 22.6, 2, 0.4)

    # ================= church garden + cemetery =================
    path_rect(m, 58, 23, 2, 1)
    m.stamp("deco-below", R.PLANTER_YELLOW, 54, 21)
    m.collide(54, 21, 2, 2)
    m.stamp("deco-below", R.PLANTER_PURPLE, 63, 21)
    m.collide(63, 21, 2, 2)
    m.flowers(55, 19, n=6, spread=1)
    m.flowers(64, 19, n=5, spread=1)
    # tiny 1841 churchyard: OPEN memorial garden — statue on a rounded tan
    # plot with old stones and flower drifts, a walk down to Route 9 (no
    # fence; a caged monument reads as a mistake)
    path(
        m,
        {
            (65, 14),
            (66, 14),
            (64, 15),
            (65, 15),
            (66, 15),
            (67, 15),
            (64, 16),
            (65, 16),
            (66, 16),
            (67, 16),
            (65, 17),
            (66, 17),
        },
    )
    path(
        m,
        {
            (65, 18),
            (66, 18),
            (65, 19),
            (66, 19),
            (65, 20),
            (66, 20),
            (65, 21),
            (66, 21),
            (65, 22),
            (66, 22),
        },
    )  # memorial walk
    m.stamp("deco-below", R.STATUE, 65, 14)
    m.collide(65, 15, 2, 2)
    m.set("deco-below", 64, 16, R.ROCK_TINY_A)
    m.set("deco-below", 67, 15, R.ROCK_TINY_B)
    m.flowers(64, 13, n=4, spread=1)
    m.flowers(67, 17, n=3, spread=1)

    # ================= firehouse set-piece =================
    m.set("deco-below", 38, 27, M.mg("hydrant"))  # hydrant at the corner
    m.collide(38.2, 27.3, 0.6, 0.7)
    # pancake-breakfast bunting posts at the apron's south corners
    for bx, banner in ((38, R.BANNER_RED_A), (46, R.BANNER_RED_B)):
        m.stamp("deco-below", R.POST_WOOD_A, bx, 38)
        m.stamp("buildings-top", banner, bx, 37)
        m.collide(bx + 0.25, 38.5, 0.5, 0.5)
    m.stamp("deco-below", R.SIGNS_STANDING[4], 42, 36)  # pancake board
    m.collide(42, 37.6, 2, 0.4)
    m.stamp("deco-below", R.MENU_BOARD, 48, 38)
    m.collide(48, 38.4, 2, 1.6)
    m.set("deco-below", 47, 39, M.mg("trash_bin"))
    m.collide(47.2, 39.3, 0.6, 0.7)
    m.set("ground-detail", 43, 26, M.mg("storm_drain"))

    # ================= Fairview subdivision =================
    # shared garden pen on the loop's upper green
    _fence_pen(m, 11, 28, 6, 5)
    for gx in range(12, 15):
        m.set("deco-below", gx, 30, rng.choice(R.CROP_TILES))
    m.stamp("deco-below", R.BEANPOLES, 18, 29)
    m.collide(18, 29, 2, 2)
    m.flowers(10, 33, n=4, spread=1)
    m.flowers(20, 32, n=4, spread=1)
    # third cottage's path to the lane's sidewalk
    path(m, {(26, 41), (27, 41), (28, 41)})
    # curbside details
    m.set("deco-below", 8, 30, M.mg("mailbox"))
    m.collide(8.2, 30.2, 0.6, 0.8)
    m.set("deco-below", 22, 33, M.mg("mailbox"))
    m.collide(22.2, 33.2, 0.6, 0.8)
    m.set("deco-below", 3, 41, M.mg("trash_bin"))
    m.collide(3.2, 41.3, 0.6, 0.7)
    m.lamp(8, 27)
    m.lamp(22, 39)
    m.tree(3, 33, stamp="tree_round_small")
    m.stamp("deco-below", R.BUSH_ROUND, 2, 36)

    # ================= Community Fields =================
    # rec-league pitch: light-grass sward, worn tan boundary, rail goals,
    # bark corner flags — running N-S so the goals read as crossbars
    m.blob_rect("ground-detail", 54, 31, 11, 13, R.GRASS_LIGHT, holes=False)
    ring = {(x, 32) for x in range(55, 64)} | {(x, 42) for x in range(55, 64)}
    ring |= {(55, y) for y in range(33, 42)} | {(63, y) for y in range(33, 42)}
    path(m, ring)
    m.set("ground-detail", 59, 37, rng.choice(R.PATH_TAN.fill))  # center spot
    m.stamp("deco-below", R.FENCE_METAL["rail_h"], 58, 32)  # north goal
    m.collide(58, 32.4, 2, 0.6)
    m.stamp("deco-below", R.FENCE_METAL["rail_h"], 58, 42)  # south goal
    m.collide(58, 42.4, 2, 0.6)
    for fx, fy in ((55, 32), (63, 32), (55, 42), (63, 42)):  # corner flags
        m.stamp("deco-below", R.POST_WOOD_B, fx, fy - 1)
        m.collide(fx + 0.25, fy + 0.25, 0.5, 0.5)
    # walk from the firehouse apron + spectator benches
    path(m, {(x, y) for x in range(48, 54) for y in (36, 37)})
    for by in (35, 39):
        m.set("deco-below", 52, by, M.mg("bench_h"))
        m.collide(52, by, 1, 1)
    m.lamp(49, 34)
    m.stamp("deco-below", R.SIGNS_STANDING[3], 48, 32)  # rec-league board
    m.collide(48, 33.6, 2, 0.4)
    m.flowers(50, 40, n=4, spread=1)
    # practice diamond by the river bend
    m.blob(
        "ground-detail",
        {(66, 31), (67, 31), (65, 32), (66, 32), (67, 32), (65, 33), (66, 33), (67, 33)},
        R.PATH_TAN,
    )
    m.stamp("deco-below", R.FENCE_METAL["rail_h"], 65, 30)
    m.collide(65, 30.4, 2, 0.6)
    m.anchor("water-foam", 68, 41)
    m.anchor("water-foam", 67, 46)
    m.anchor("water-foam", 71, 20)

    # ================= trees (clustered) =================
    # NW orchard remnant — loosely planted rows
    for x, y in ((2, 6), (7, 6), (3, 11), (8, 11)):
        m.tree(x, y, stamp="tree_fruit_a")
    m.tree(12, 5, stamp="tree_fruit_c")
    # north-center clearing cluster (west of Crossing Road)
    for x, y in ((28, 5), (33, 4), (30, 8), (26, 6)):
        m.tree(x, y, stamp=rng.choice(("tree_light", "tree_dark")))
    m.tree(25, 3, stamp="tree_small")
    m.stamp("deco-below", R.BUSH_ROUND, 26, 9)
    m.tree(40, 5, stamp="tree_light")  # lone tree on the east shoulder
    # NE riverbank
    for x, y in ((64, 3), (68, 6), (62, 9)):
        m.tree(x, y, stamp=rng.choice(("tree_light", "tree_dark")))
    m.stamp("deco-below", R.FERN, 68, 9)
    # crossing-road verge
    m.tree(33, 12, stamp="tree_round_small")
    m.stamp("deco-below", R.BUSH_ROUND, 31, 12)
    # riverbank at the fields + south fringe
    for x, y in ((59, 31), (51, 48), (57, 49), (62, 46)):
        m.tree(x, y, stamp=rng.choice(("tree_light", "tree_dark")))
    m.tree(48, 46, stamp="tree_fruit_a")
    for x, y in ((3, 47), (10, 46), (17, 48), (28, 47), (33, 46), (41, 48)):
        m.tree(x, y, stamp=rng.choice(("tree_light", "tree_dark", "tree_round_small")))
    m.stamp("deco-below", R.ROCK_MED, 31, 45)
    m.stamp("deco-below", R.FERN, 6, 45)
    # west verge
    for x, y in ((2, 20), (2, 26)):
        m.tree(x, y, stamp=rng.choice(("tree_light", "tree_round_small")))

    # ================= flower drifts =================
    m.flowers(11, 8, n=5, spread=2)
    m.flowers(31, 11, n=4, spread=2)
    m.flowers(48, 21, n=5, spread=2)
    m.flowers(30, 30, n=4, spread=2)
    m.flowers(58, 44, n=5, spread=2)
    m.flowers(4, 44, n=4, spread=2)

    # ================= street lamps along Route 9 =================
    for x in (52, 67):
        m.lamp(x, 22)
    for x in (11, 30, 55, 66):
        m.lamp(x, 26)

    # map edge collision walls
    m.collide(0, -1, m.w, 1)
    m.collide(0, m.h, m.w, 1)
    m.collide(-1, 0, 1, m.h)
    m.collide(m.w, 0, 1, m.h)

    # landmark labels for the scene
    for lm in m.landmarks.values():
        m.anchor("label", lm.x + lm.w / 2 - 0.5, lm.y + lm.h / 2 - 1, name=lm.name, text=lm.name)
