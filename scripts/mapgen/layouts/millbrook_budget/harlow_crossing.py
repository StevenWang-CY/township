"""Hand-tuned layout for Harlow Crossing (millbrook-budget) — 75x50 tiles.

Reading of the town: the growth side of the Stillwater. Route 9 is the spine
— the strip that carries 14,000 cars and every school bus in town under its
run of utility poles — and everything young about Harlow hangs off it: the
plaza shopping row behind its big parking lot (cars, a cart corral), Rocco's
Slice House, the 1968 brick elementary school with its fenced playfield and
a school bus at the door, the volunteer firehouse on its poured slab, the
Fairview loop of cream cottages with sheds, Orchard Street's new colonials
on the old orchard behind the plaza, the riverside inn, and the rec-league
Community Fields down at the river bend that flood every April.

The memorable set-piece is the center of the map: the namesake crossing —
one straight north-south street (Crossing Road) meeting Route 9 in a clean
four-way junction with a single zebra set and the town's only traffic
signal, the school on its NE shoulder and the firehouse (brick, twin metal
bay doors, red pancake-breakfast bunting) on its SE. The Stillwater river
runs the whole east edge — Route 9 crosses it on a stone bridge toward
Millbrook Village.

Grid plan (cols x rows):
  - Route 9 ............ horizontal road rows 24-26, west exit + east bridge
  - Crossing Road ...... vertical road cols 35-37 straight through the map
                         (north + south exits); its four-way junction with
                         Route 9 is the namesake crossing, zebras cols 34/38
  - Orchard Street ..... walk row 11 from the farmstead (cols 2-7) past
                         four colonials (cols 9-33) to Crossing Road; a
                         lane (col 8) drops to Route 9 past the barn
  - plaza strip ........ storefront row rows 13-18, walk row 19, parking lot
                         rows 20-22 (nose-in stalls, cart corral, hydrant)
  - Rocco's ............ cols 29-34 rows 15-20, striped awning
  - school ............. cols 41-51 rows 9-16, forecourt + bus, fenced
                         playground cols 52-59 (sand pit, climb bar)
  - riverside inn ...... cols 60-68 rows 3-9, walk down the church's east
                         side to Route 9
  - church ............. cols 56-62 rows 16-22, garden + open memorial plot
  - firehouse .......... cols 39-46 rows 29-35, wide apron rows 36-38; the
                         senior center east of it, cottages below the slab
  - Fairview loop ...... narrow streets cols 6-7 / 23-24 + lane rows 42-43,
                         three cottages with sheds, carriage houses west
  - Community Fields ... light-grass pitch cols 54-65 rows 33-41 with chalk
                         lines and metal goals, by the river bend
  - Stillwater river ... east edge, bend into the SE corner, stone bridge
"""

from __future__ import annotations

from mapgen import moderntiles as M
from mapgen import tiles as R
from mapgen.build_maps import (
    MapCanvas,
    bench,
    church,
    cottage,
    emit_edge_ring,
    emit_ground_shade,
    emit_ground_wear,
    facade_wall,
    grand,
    hedge_line,
    noticeboard,
    park_stalls,
    path,
    path_rect,
    patio,
    poles,
    road_sign,
    shadow_rect,
    shed,
    signal,
    storefront,
    vehicle,
)

#: Roads leaving the map: (side, road segment's first row / column, sign).
EXITS = [
    ("w", 24, "TO COUNTY RD 7"),
    ("n", 35, "TO RIDGE RD"),
    ("s", 35, "TO THE QUARRY"),
    ("w", 42, "TO FAIRVIEW HILL"),
]

FAIRVIEW = "Fairview Subdivision"

#: District Atlas postcard: top-left tile of the 14x9 crop framing the
#: set-piece (the namesake four-way crossing with its zebra set).
POSTCARD = (30, 22)


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
    m.meadow(41, 18, 12, 5)  # school front lawn
    m.meadow(26, 44, 14, 4)  # south band

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

    # plaza parking lot: rows 20-22 with a driveway onto Route 9 (stalls
    # and cars are dealt below, once the walk and buildings are placed)
    lot = {(x, y) for x in range(9, 28) for y in range(20, 23)}
    lot |= {(x, 23) for x in range(17, 20)}  # driveway mouth
    m.road_mask |= lot

    # ================= paved forecourts (join the sidewalk net) ==========
    m.pave(9, 19, 19, 1)  # walk in front of the plaza strip
    m.pave(38, 17, 18, 2)  # school forecourt, meets the road walk
    m.pave(38, 36, 10, 3)  # firehouse apron (the wide slab)
    m.pave(31, 21, 2, 2)  # Rocco's doorstep
    m.pave(2, 11, 33, 1)  # Orchard Street walk, farmstead -> Crossing Rd
    m.pave(8, 12, 1, 12)  # lane down the plaza's west side to Route 9
    m.pave(2, 18, 6, 1)  # barn apron to the lane
    m.pave(60, 10, 4, 1)  # inn's walk...
    m.pave(63, 10, 1, 14)  # ...down the church's east side to Route 9
    m.pave(39, 47, 15, 1)  # south cottages' walk to Crossing Rd
    m.pave(2, 34, 4, 1)  # upper carriage house to Fairview's sidewalk

    # ================= buildings (reserve before paint_roads) =============
    # -- plaza strip: pharmacy / bank / barber / laundromat
    plaza = "Harlow Plaza"
    storefront(m, 9, 13, 5, 6, facade="brick", sign=0, landmark=plaza)  # pharmacy
    storefront(
        m, 14, 13, 4, 6, facade="stone_small", roof="stone", window=False, sign=None, landmark=plaza
    )  # bank
    storefront(m, 18, 13, 4, 6, facade="cream", awning=True, landmark=plaza)  # barber
    storefront(m, 22, 13, 5, 6, facade="cream", roof="stone", sign=None, landmark=plaza)
    # -- Rocco's Slice House
    storefront(m, 29, 15, 6, 6, facade="brick", awning=True, landmark="Rocco's Slice House")
    # -- Orchard Street: the farmstead, four colonials on the old orchard
    cottage(m, 2, 3, 6, 8, roof="cedar")  # farmhouse
    storefront(m, 2, 12, 6, 6, facade="brick", roof="terracotta", window=False, sign=None)  # barn
    cottage(m, 9, 3, 6, 8, roof="slate")
    cottage(m, 16, 3, 6, 8, roof="deck_dark")
    cottage(m, 22, 3, 6, 8, roof="slate")
    cottage(m, 28, 3, 6, 8, roof="cedar")
    # -- Harlow Elementary School (1968 brick, arch entry)
    grand(m, 41, 9, 11, 8, facade="brick", windows=True, landmark="Harlow Elementary School")
    # -- the riverside inn above the church
    grand(m, 60, 3, 9, 7, facade="brick", windows=True)
    # -- Harlow Congregational Church (1841, whitewashed)
    church(m, 56, 15, 7, 8, variant="clapboard", landmark="Harlow Congregational Church")
    # -- Harlow Firehouse (hand-composed: twin metal bays + red bunting),
    #    on the crossing's SE shoulder, fronting Crossing Road's sidewalk
    m.reserve(39, 28, 8, 8)
    m.stamp("buildings-top", M.shingle_stamp("terracotta", 8, 4), 39, 29)
    m.stamp("buildings-base", facade_wall("brick", 8, rows=[3, 4, 5]), 39, 33)
    m.building_stamp(R.DOOR_METAL, 40, 34, top_rows=1)
    m.building_stamp(R.DOOR_METAL, 44, 34, top_rows=1)
    m.stamp("buildings-base", R.BANNER_RED_A, 42, 33)
    m.stamp("buildings-base", R.BANNER_RED_B, 43, 33)
    m.collide(39, 29, 8, 7)
    # both bay doors are fronts, so the apron spots spread across the slab
    for bay in (40, 44):
        m.register_front("Harlow Firehouse", 39, 29, 8, 7, bay, 35, 33)
    shadow_rect(m, 39, 29, 8, 7)
    # -- senior center beside the firehouse, cottages below the slab
    grand(m, 47, 28, 7, 7, facade="stone_small", roof="stone")
    cottage(m, 40, 40, 6, 7, roof="slate")
    cottage(m, 48, 40, 6, 7, roof="deck_dark")
    # -- Fairview cottages with sheds, carriage houses on the west verge
    cottage(m, 9, 33, 6, 8, landmark=FAIRVIEW)
    cottage(m, 16, 33, 6, 8, roof="deck_dark", landmark=FAIRVIEW)
    cottage(m, 26, 33, 6, 8, roof="slate", landmark=FAIRVIEW)
    shed(m, 18, 29)
    shed(m, 28, 29)
    storefront(
        m,
        2,
        29,
        3,
        5,
        facade="cream",
        roof="deck_light",
        window=False,
        sign=None,
        yard=True,
        landmark=FAIRVIEW,
    )
    storefront(
        m,
        2,
        36,
        3,
        5,
        facade="brick",
        roof="deck_dark",
        window=False,
        sign=None,
        yard=True,
        landmark=FAIRVIEW,
    )

    # ================= plaza lot: cart corral + nose-in stalls ============
    for bx, by in ((23, 20), (23, 21), (26, 20), (26, 21)):
        m.set("deco-below", bx, by, M.mg("bollard"))
        m.collide(bx + 0.3, by + 0.3, 0.4, 0.7)
    m.stamp("deco-below", R.FENCE_METAL["rail_h"], 24, 21)  # the carts
    m.collide(24, 20, 2, 2)
    park_stalls(m, 9, 20, 19, 3, "v", fill=0.65, surface="asphalt", curb="n")

    # ================= paint the road network =================
    # zebras on all four arms of the namesake crossing, and across Route 9
    # where the two side streets meet it (their T-junctions)
    m.paint_roads()

    # ================= stone bridge over the Stillwater ==================
    m.stamp("ground-detail", R.BRIDGE_STONE, 70, 24)
    m.collide(70, 24, 5, 1)
    m.collide(70, 26, 5, 1)
    road_sign(m, 68, 28, "TO MILLBROOK")

    # ================= plaza set-piece dressing =================
    m.set("ground-detail", 18, 22, M.mg("storm_drain"))
    m.lamp(28, 21)  # lot light on the sidewalk edge, clear of the stalls
    # street furniture on the storefront walk
    m.set("deco-below", 15, 19, M.mg("planter_box"))
    m.collide(15.1, 19.3, 0.8, 0.7)
    m.set("deco-below", 21, 19, M.mg("planter_box"))
    m.collide(21.1, 19.3, 0.8, 0.7)
    noticeboard(m, 27, 18, landmark="Harlow Plaza")
    m.collide(27.2, 19.3, 0.6, 0.7)
    m.set("deco-below", 9, 19, M.mg("mailbox"))
    m.collide(9.2, 19.2, 0.6, 0.8)
    m.set("deco-below", 26, 23, M.mg("hydrant"))
    m.collide(26.2, 23.3, 0.6, 0.7)
    m.stamp("deco-below", R.SIGNS_STANDING[0], 4, 22)  # plaza sign by the exit
    m.collide(4, 22.6, 2, 0.4)
    m.lamp(7, 20)

    # ================= Rocco's frontage =================
    m.stamp("deco-below", R.SIGNS_STANDING[1], 27, 20)  # utensils board
    m.collide(27, 21.6, 2, 0.4)
    patio(
        m,
        29,
        21,
        2,
        2,
        stools=((0, 0),),
        landmark="Rocco's Slice House",
        floor=False,
        blocks=((0, 0, 1, 1),),
    )
    # on-street stalls out front (the washboard curb)
    m.set("ground-detail", 30, 24, M.mg("parking_stall"))
    m.set("ground-detail", 32, 24, M.mg("parking_stall"))
    m.set("ground-detail", 13, 26, M.mg("storm_drain"))  # Culvert 9 grates
    m.set("ground-detail", 8, 26, M.mg("storm_drain"))

    # ================= Orchard Street =================
    for hx in (15, 21, 27):  # hedges between the lots
        hedge_line(m, hx, 5, hx, 10)
    m.tree(33, 5, stamp="tree_fruit_a")  # last of the orchard
    m.tree(33, 9, stamp="tree_fruit_c")
    m.flowers(11, 12, n=4, spread=1)
    m.set("deco-below", 34, 10, M.mg("mailbox"))
    m.collide(34.2, 10.2, 0.6, 0.8)
    m.stamp("deco-below", R.HAYSTACK, 4, 19)  # barn yard
    m.collide(4, 19, 4, 4)
    m.stamp("deco-below", R.BARREL, 2, 19)
    m.collide(2, 19, 2, 2)

    # ================= school zone =================
    m.stamp("deco-below", M.BUS_SIGN, 41, 17)  # bus loop stop
    m.collide(41.3, 18.3, 0.4, 0.7)
    vehicle(m, "schoolbus", 48, 18, "h", facing="w")  # bus at the door
    bench(m, 52, 18, landmark="Harlow Elementary School")
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
    bench(m, 57, 12, landmark="Harlow Elementary School")
    m.stamp("deco-below", R.FLOWER_PATCH, 53, 11)
    m.flowers(54, 12, n=3, spread=1)
    path(m, {(54, 14), (55, 14), (54, 15), (55, 15), (54, 16), (55, 16)})
    # school lawn sign by the zebra
    m.stamp("deco-below", R.SIGNS_STANDING[3], 41, 21)
    m.collide(41, 22.6, 2, 0.4)
    hedge_line(m, 44, 20, 50, 20)  # hedge along the lawn

    # ================= inn + church garden + cemetery =================
    bench(m, 66, 10)
    m.stamp("deco-below", R.FERN, 68, 9)
    path_rect(m, 58, 23, 2, 1)
    m.stamp("deco-below", R.PLANTER_YELLOW, 54, 21)
    m.collide(54, 21, 2, 2)
    m.flowers(55, 19, n=6, spread=1)
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
    m.set("deco-below", 40, 27, M.mg("hydrant"))  # hydrant by the corner
    m.collide(40.2, 27.3, 0.6, 0.7)
    # pancake-breakfast bunting posts at the apron's south corners
    for bx, banner in ((38, R.BANNER_RED_A), (46, R.BANNER_RED_B)):
        m.stamp("deco-below", R.POST_WOOD_A, bx, 38)
        m.stamp("buildings-top", banner, bx, 37)
        m.collide(bx + 0.25, 38.5, 0.5, 0.5)
    m.stamp("deco-below", R.SIGNS_STANDING[4], 42, 36)  # pancake board
    m.collide(42, 37.6, 2, 0.4)
    m.stamp("deco-below", R.MENU_BOARD, 48, 36)
    m.collide(48, 36.4, 2, 1.6)
    m.set("deco-below", 47, 38, M.mg("trash_bin"))
    m.collide(47.2, 38.3, 0.6, 0.7)
    m.set("ground-detail", 43, 26, M.mg("storm_drain"))
    m.lamp(46, 47)

    # ================= Fairview subdivision =================
    # shared garden pen on the loop's upper green
    _fence_pen(m, 11, 27, 6, 5)
    for gx in range(12, 15):
        m.set("deco-below", gx, 29, rng.choice(R.CROP_TILES))
    m.flowers(10, 31, n=4, spread=1)
    # curbside details
    m.set("deco-below", 8, 30, M.mg("mailbox"))
    m.collide(8.2, 30.2, 0.6, 0.8)
    m.set("deco-below", 22, 31, M.mg("mailbox"))
    m.collide(22.2, 31.2, 0.6, 0.8)
    m.lamp(8, 27)
    m.lamp(22, 41)
    m.lamp(30, 41)
    hedge_line(m, 32, 34, 32, 40)  # hedge between the east cottage and the road
    m.stamp("deco-below", R.BUSH_ROUND, 2, 44)

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
    # walk from the senior center's apron + spectator benches
    path(m, {(x, y) for x in range(47, 54) for y in (35, 36)} | {(x, 37) for x in range(50, 54)})
    for by in (34, 39):
        bench(m, 53, by, landmark="Community Fields")
    m.lamp(54, 44)
    m.stamp("deco-below", R.SIGNS_STANDING[3], 51, 38)  # rec-league board
    m.collide(51, 39.6, 2, 0.4)
    m.flowers(50, 41, n=4, spread=1)
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
    m.tree(40, 5, stamp="tree_light")  # lone tree on the school's shoulder
    m.tree(57, 4, stamp="tree_dark")
    m.tree(33, 13, stamp="tree_round_small")
    m.stamp("deco-below", R.BUSH_ROUND, 31, 12)
    # riverbank at the fields + south fringe
    for x, y in ((59, 31), (62, 46), (57, 45)):
        m.tree(x, y, stamp=rng.choice(("tree_light", "tree_dark")))
    for x, y in ((28, 46), (33, 46)):
        m.tree(x, y, stamp=rng.choice(("tree_light", "tree_dark", "tree_round_small")))
    m.stamp("deco-below", R.ROCK_MED, 31, 45)
    m.stamp("deco-below", R.FERN, 6, 45)
    m.tree(10, 46, stamp="tree_light")
    m.tree(17, 46, stamp="tree_round_small")
    # west verge
    for x, y in ((2, 21), (2, 26)):
        m.tree(x, y, stamp=rng.choice(("tree_light", "tree_round_small")))

    # ================= flower drifts =================
    m.flowers(31, 11, n=4, spread=1)
    m.flowers(48, 22, n=5, spread=2)
    m.flowers(30, 30, n=4, spread=2)
    m.flowers(58, 44, n=5, spread=2)
    m.flowers(4, 45, n=4, spread=2)

    # ================= Route 9 street furniture ==========================
    for x in (52, 67):
        m.lamp(x, 22)
    for x in (11, 30, 55, 66):
        m.lamp(x, 26)
    # the crossing's signal, poles down Route 9's south verge
    signal(m, 35, 24, 37, 26)
    poles(m, [(x, 28) for x in range(3, 68)])

    # map edge collision walls
    m.collide(0, -1, m.w, 1)
    m.collide(0, m.h, m.w, 1)
    m.collide(-1, 0, 1, m.h)
    m.collide(m.w, 0, 1, m.h)

    # ================= woods ring, ground tones, desire lines ============
    emit_edge_ring(m, EXITS)
    emit_ground_shade(m)
    emit_ground_wear(m)

    # landmark labels for the scene
    for lm in m.landmarks.values():
        m.anchor("label", lm.x + lm.w / 2 - 0.5, lm.y + lm.h / 2 - 1, name=lm.name, text=lm.name)
