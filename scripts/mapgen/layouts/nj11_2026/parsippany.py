"""Hand-tuned layout for Parsippany-Troy Hills (nj11-2026) — 75x50 tiles.

Reading of the town: the district's largest municipality — a modern,
comfortable suburb whose soul is Lake Parsippany. The memorable set-piece is
the north-west quarter: a two-lobed lake pinched at a narrows crossed by the
stone bridge, with a swimming dock, a plank boardwalk along the south shore,
a waterside path loop and ducks (water-foam anchors). Around it the town
reads corporate-suburban: Route 46 runs coast to coast as a wide commercial
strip under a signal at Smith Road; a glass-and-stone corporate campus with
a striped, nearly full parking lot fills the NE beside a second office
block; the Hindu temple sits behind a formal garden (banners, statue,
reflecting pond, fruit trees); a strip mall with its own lot fronts Route
46; garden apartments and driveway cottages fill the SW; and the SE holds
the community center + school sharing the rec field, with a condo block on
the field's east side.

Grid plan (cols x rows):
  - Route 46 ........... horizontal road rows 21-23, west+east map exits
  - Smith Rd .......... vertical road cols 48-50, top + bottom map exits,
                        signals at Route 46
  - Vail Rd ........... vertical road cols 33-35, Route 46 -> bottom exit
  - lake set-piece .... cols 4-22, rows 2-18: ONE water body pinched to a
                        narrows (cols 14-18, rows 10-11) fully under the
                        stone bridge at (14,9), so the bridge visibly
                        crosses water; lakeside trail rows 10-11 exits the
                        west map edge; dock cols 18-19; boardwalk row 19
                        past a lakeside cottage cols 2-7
  - strip mall ........ shops cols 25-34, rows 9-14, apron row 15, lot
                        rows 16-19 opening onto Route 46
  - Hindu temple ...... building cols 36-43 rows 7-13, garden rows 14-19
                        (approach path cols 38-40 fused into the Route 46
                        sidewalk, POND_GRASS reflecting pond cols 41-46)
  - corporate campus .. building cols 51-62 rows 7-15, striped lot rows
                        16-19; a second office block cols 64-72 rows 12-19
  - garden apartments . seven attached row houses cols 4-31 rows 26-31 on
                        a walk (row 32); three cottages with driveways
                        rows 34-40 below them; lane rows 41-42 tees into
                        Vail Rd
  - library ........... cols 24-31 rows 34-40, door on the lane
  - transit stop ...... awning shelter cols 41-46 rows 26-31 (+ a shop
                        beside it), concrete platform rows 32-33 out to
                        Smith Rd, bus bay cols 45-47 rows 34-39 notched
                        into Smith Rd with a bus pulled in
  - community/school .. cols 55-71 rows 26-32, plaza rows 33-34, fenced
                        rec field rows 36-45, condo block cols 65-72
"""

from __future__ import annotations

from mapgen import moderntiles as M
from mapgen import tiles as R
from mapgen.build_maps import (
    MapCanvas,
    bench,
    cottage,
    driveway,
    emit_edge_ring,
    emit_ground_shade,
    emit_ground_wear,
    grand,
    hedge_line,
    noticeboard,
    park_stalls,
    path,
    path_rect,
    platform,
    signal,
    storefront,
    street_blade,
    vehicle,
)

#: Roads leaving the map: (side, road segment's first row / column, sign).
EXITS = [
    ("w", 21, "TO DENVILLE"),
    ("e", 21, "TO I-287"),
    ("n", 48, "TO BOONTON"),
    ("s", 48, "TO RT 10"),
    ("s", 33, "TO MORRIS PLAINS"),
]

#: District Atlas postcard: top-left tile of the 14x9 crop framing the
#: set-piece (the stone bridge over the lake's narrows).
POSTCARD = (9, 6)

# Lake Parsippany water mask: row -> (x0, x1) inclusive. ONE connected
# water body: two broad convex lobes merged through a narrows (cols 14-18,
# rows 10-11) that sits entirely under the 5x3 stone bridge, so open water
# laps both the bridge's top and bottom edges and the crossing reads as a
# bridge over the lake's waist, not a dam on grass. Both lobes stay convex
# on purpose: the POND_GRASS kit has no usable concave fillet tiles, and
# every concave bend of this mask lands under the bridge stamp or the
# lakeside trail, which are painted over it.
LAKE_SPANS: dict[int, tuple[int, int]] = {
    2: (8, 18),
    3: (6, 20),
    4: (5, 21),
    5: (4, 22),
    6: (4, 22),
    7: (5, 21),
    8: (6, 20),
    9: (8, 18),
    10: (14, 18),
    11: (14, 18),
    12: (11, 20),
    13: (10, 21),
    14: (9, 21),
    15: (8, 22),
    16: (9, 22),
    17: (10, 21),
    18: (12, 20),
}

#: swimming dock (deck pad pasted over the water; its base row 19 is shore)
DOCK_CELLS = {(x, y) for x in (18, 19) for y in range(16, 19)}
#: narrows row hidden under the bridge's walkable deck (agents cross here)
DECK_CELLS = {(x, 10) for x in range(14, 19)}

#: ai-town lake shoreline, sliced from the registered POND_GRASS kit the
#: same way the example map builds its sea: bright opaque water fill with a
#: grass-backed rocky rim + white foam on every edge. No hole corners: the
#: kit's X-shaped hole block needs paired transition tiles the autotiler
#: cannot place, so the mask above avoids visible concave bends instead.
LAKE_BLOB = R.Blob(
    name="lake_pond",
    fill=R.WATER_LAKE_FILL,
    nw=R.gid(61, 66),
    n=(R.gid(61, 67), R.gid(61, 68)),
    ne=R.gid(61, 69),
    w=(R.gid(62, 65), R.gid(63, 65)),
    e=(R.gid(62, 70), R.gid(63, 70)),
    sw=R.gid(64, 66),
    s=(R.gid(64, 67), R.gid(64, 68)),
    se=R.gid(64, 69),
)


def _lake(m: MapCanvas) -> None:
    cells = {(x, y) for y, (x0, x1) in LAKE_SPANS.items() for x in range(x0, x1 + 1)}
    m.blob("ground-detail", cells, LAKE_BLOB, holes=False)
    # swimming dock jutting into the south lobe, base row on the shore;
    # its tip is a standing spot looking out over the water
    platform(m, 18, 16, 2, 4, landmark="Lake Parsippany", edge="n")
    # stone bridge over the narrows: row 10 is the walkable deck; water
    # fill (not grass-backed rim) meets both parapets at rows 9 and 12
    m.stamp("deco-below", R.BRIDGE_STONE, 14, 9)
    # collision: maximal runs per row, skipping dock + bridge deck
    walkable = DOCK_CELLS | DECK_CELLS
    for y, (x0, x1) in LAKE_SPANS.items():
        run = None
        for x in range(x0, x1 + 2):
            blocked = x <= x1 and (x, y) not in walkable
            if blocked and run is None:
                run = x
            elif not blocked and run is not None:
                m.collide(run, y, x - run, 1)
                run = None
    # ducks / ripples
    for fx, fy in ((11, 4), (17, 3), (11, 16), (20, 16), (14, 13)):
        m.anchor("water-foam", fx, fy)


def _fence_rect(
    m: MapCanvas, x: int, y: int, w: int, h: int, gate_cols: tuple[int, ...] = ()
) -> None:
    """Ranch-fence perimeter with optional gate gaps on the top rail."""
    f = R.FENCE_WOOD
    m.stamp("deco-below", f["corner_nw"], x, y)
    m.stamp("deco-below", f["corner_ne"], x + w - 2, y)
    m.stamp("deco-below", f["corner_sw"], x, y + h - 2)
    m.stamp("deco-below", f["corner_se"], x + w - 2, y + h - 2)
    for i, fx in enumerate(range(x + 2, x + w - 2)):
        rail = f["rail_h_a" if i % 2 == 0 else "rail_h_b"]
        if fx not in gate_cols:
            m.stamp("deco-below", rail, fx, y)
        m.stamp("deco-below", rail, fx, y + h - 2)
    for fy in range(y + 2, y + h - 2, 2):
        m.stamp("deco-below", f["rail_v"], x, fy)
        m.stamp("deco-below", f["rail_v"], x + w - 2, fy)
    # collision (leave the gate open)
    if gate_cols:
        g0, g1 = min(gate_cols), max(gate_cols)
        m.collide(x, y, g0 - x, 1)
        m.collide(g1 + 1, y, x + w - g1 - 1, 1)
    else:
        m.collide(x, y, w, 1)
    m.collide(x, y + h - 2, w, 1)
    m.collide(x, y + 1, 1, h - 3)
    m.collide(x + w - 1, y + 1, 1, h - 3)


def compose(m: MapCanvas) -> None:
    rng = m.rng

    # ================= ground tone =================
    m.base_grass()
    m.meadow(27, 2, 11, 5)  # north-center commons
    m.meadow(64, 4, 9, 6)  # NE verge
    m.meadow(37, 42, 8, 6)  # south commons
    m.meadow(3, 43, 26, 5)  # cul-de-sac woods floor

    # ================= Lake Parsippany set-piece =================
    _lake(m)

    # lakeside trail: east shore corridor -> narrows band -> bridge ->
    # west shore, exiting the west map edge
    lake_path: set[tuple[int, int]] = set()
    for y in range(12, 20):
        lake_path.update({(23, y), (24, y)})
    for x in range(19, 25):
        lake_path.update({(x, 10), (x, 11)})
    for x in range(0, 14):
        lake_path.update({(x, 10), (x, 11)})
    path(m, lake_path)

    # ================= roads =================
    m.road_h(21, 0, 74, width=3)  # Route 46
    m.road_v(48, 0, 49, width=3)  # Smith Rd, top+bottom exits
    m.road_v(33, 21, 49, width=3)  # Vail Rd, south exit

    # corporate parking lot joins the asphalt network (curbed ring forms
    # automatically); entrance drive cuts the Route 46 sidewalk
    for yy in range(16, 20):
        for xx in range(52, 63):
            m.road_mask.add((xx, yy))
    for xx in range(55, 58):
        m.road_mask.add((xx, 20))
    # transit bus bay: a pull-in lane notched into Smith Rd's west side,
    # continuous with the road asphalt (curbed ring wraps its outer edge)
    for yy in range(34, 40):
        for xx in range(45, 48):
            m.road_mask.add((xx, yy))

    # paved aprons/plazas (continuous with the road sidewalks)
    m.pave(24, 15, 12, 1)  # strip-mall apron (its lot is paved below)
    m.pave(36, 32, 12, 2)  # transit platform out to Smith Rd
    m.pave(52, 33, 20, 2)  # community/school esplanade
    m.pave(2, 32, 30, 1)  # garden apartments' walk to Vail Rd
    m.pave(64, 35, 1, 8)  # condo walk down from the esplanade...
    m.pave(64, 42, 9, 1)  # ...along the block's front

    # ================= buildings (reserve before paint_roads) =============
    # -- strip mall on Route 46, lot in front
    storefront(m, 25, 9, 4, 6, facade="cream", roof="stone", sign=1)  # deli
    storefront(m, 29, 9, 6, 6, facade="brick", roof="cedar", awning=True, landmark="Indian Grocery")
    park_stalls(m, 24, 16, 12, 4, "h", landmark="Indian Grocery", fill=0.6)
    # -- Hindu temple (cream, banners; garden composed below). The cream
    # facade's arch-adjacent tiles have transparent notches; backfill the
    # upper wall rows with its plain interior tile so no grass pokes
    # through the silhouette.
    cream_wall = R.FACADE_CREAM.gids[3][5]
    m.fill("deco-below", 36, 9, 8, 3, (cream_wall,))
    grand(m, 36, 7, 8, 7, facade="cream", banners=True, landmark="Hindu Temple")
    # -- corporate campus: biggest block in town, glass row added below,
    #    its lot striped and four-fifths full; a second office block east
    grand(
        m,
        51,
        7,
        12,
        9,
        facade="stone_large",
        windows=True,
        door="metal",
        landmark="Corporate Park",
    )
    # (stalls back onto the Route 46 curb either side of the entrance
    # drive; the aisle in front of the door stays clear)
    park_stalls(m, 52, 18, 3, 2, "v", fill=0.8, surface="asphalt", curb="s")
    park_stalls(m, 58, 18, 5, 2, "v", fill=0.8, surface="asphalt", curb="s")
    grand(m, 64, 12, 9, 8, facade="stone_large", windows=True, door="metal")
    # -- garden apartments: an attached terrace of narrow row houses
    for i, x in enumerate(range(4, 32, 4)):
        storefront(
            m,
            x,
            26,
            4,
            6,
            facade="cream" if i % 2 == 0 else "brick",
            roof="deck_light" if i % 2 == 0 else "deck_dark",
            window=False,
            sign=None,
            yard=True,
            landmark="Residential Area",
        )
    # -- residential cottages with driveways down to the lane (one grass
    #    row below the terrace walk, so their back reserve leaves it free)
    cottage(m, 2, 34, 6, 7, landmark="Residential Area")
    cottage(m, 9, 34, 6, 7, landmark="Residential Area")
    cottage(m, 16, 34, 6, 7, roof="slate", landmark="Residential Area")
    for dx in (8, 15, 22):
        driveway(m, dx, 34, 1, 7, car_at=(dx, 37))
    # -- public library, its arch onto the lane
    grand(m, 24, 34, 8, 7, facade="stone_large", windows=True, landmark="Public Library")
    # -- lakeside cottage on the boardwalk
    cottage(m, 2, 12, 6, 7, roof="slate")
    # -- NJ Transit shelter: striped awning over a brick waiting room,
    # door opening south onto the platform; a shop beside it
    storefront(
        m, 41, 26, 6, 6, facade="brick", roof="cedar", awning=True, landmark="NJ Transit Stop"
    )
    storefront(m, 36, 26, 5, 6, facade="cream", roof="stone", sign=3)  # dry cleaner
    # -- community center + school on the shared esplanade. The hall is
    #    registered first so it stays the polling front; the school sits
    #    inside the Community Center landmark rect and shares its spots.
    grand(m, 64, 26, 8, 7, facade="brick", landmark="Community Center")
    storefront(
        m,
        55,
        26,
        8,
        7,
        facade="stone_small",
        roof="deck_light",
        sign=1,
        landmark="Community Center",
    )
    # -- condo block on the rec field's east side
    grand(m, 65, 36, 8, 6, facade="brick", windows=True)

    # ================= paint the road network =================
    m.paint_roads()

    # ================= corporate campus dressing =================
    # extra teal glass along the ground floor
    m.stamp("buildings-base", R.WINDOW_TEAL, 54, 13)
    m.stamp("buildings-base", R.WINDOW_TEAL, 58, 13)
    # landscaping hedge screening the service yard
    m.blob_rect("deco-below", 51, 4, 12, 2, R.CANOPY_DARK, holes=False)
    m.collide(51, 4, 12, 2)
    m.stamp("deco-below", R.METAL_GRATE, 63, 13)
    m.collide(63, 13, 2, 2)
    # drain + entrance bollards
    m.set("ground-detail", 61, 19, M.mg("storm_drain"))
    m.set("deco-below", 54, 20, M.mg("bollard"))
    m.set("deco-below", 58, 20, M.mg("bollard"))
    m.collide(54.3, 20.3, 0.4, 0.7)
    m.collide(58.3, 20.3, 0.4, 0.7)
    hedge_line(m, 64, 11, 72, 11)  # hedge along the office block's back

    # ================= temple garden =================
    # arch door path runs all the way into the Route 46 sidewalk: the blob
    # gets side edges down to row 19, and its final row is overwritten with
    # interior fill so the tan mouth fuses with the pavement (no rounded
    # dead-end in mid-grass).
    path_rect(m, 38, 14, 3, 7)
    m.fill("ground-detail", 38, 20, 3, 1, R.PATH_TAN.fill)
    m.stamp("deco-below", R.STATUE, 35, 14)
    m.collide(35, 15, 2, 2)
    # reflecting pond: the same rock-rimmed POND_GRASS kit as the lake,
    # seated in a light-meadow bed east of the approach path with flowers
    # and a bench so it reads as landscaped garden water
    m.meadow(41, 13, 6, 7)
    m.stamp("ground-detail", R.POND_GRASS, 41, 14)
    m.collide(42, 15, 4, 4)
    m.anchor("water-foam", 43, 16)
    bench(m, 47, 17, landmark="Hindu Temple")
    m.stamp("deco-below", R.PLANTER_YELLOW, 35, 17)
    m.collide(35, 17, 2, 2)
    m.flowers(36, 18, n=5, spread=1)
    m.flowers(41, 19, n=4, spread=1)
    m.flowers(44, 19, n=4, spread=1)
    m.tree(34, 12, stamp="tree_fruit_a")
    m.tree(44, 4, stamp="tree_fruit_c")
    m.lamp(37, 18)
    hedge_line(m, 41, 13, 46, 13)

    # ================= strip mall apron =================
    m.set("deco-below", 24, 15, M.mg("planter_box"))
    m.collide(24.1, 15.3, 0.8, 0.7)
    m.set("deco-below", 28, 15, M.mg("newsbox"))
    m.collide(28.2, 15.3, 0.6, 0.7)
    m.set("deco-below", 35, 15, M.mg("trash_bin"))
    m.collide(35.2, 15.3, 0.6, 0.7)
    m.set("deco-below", 26, 20, M.mg("hydrant"))
    m.collide(26.2, 20.3, 0.6, 0.7)
    m.set("deco-below", 30, 20, M.mg("mailbox"))
    m.collide(30.2, 20.2, 0.6, 0.8)

    # ================= lakeside dressing =================
    # plank boardwalk along the south shore, from the lakeside cottage's
    # door to the shore trail, with two benches looking over the water
    m.fill("ground-detail", 2, 19, 21, 1, R.PLANKS_LIGHT)
    bench(m, 11, 19, landmark="Lake Parsippany")
    bench(m, 16, 19, landmark="Lake Parsippany")
    m.stamp("deco-below", R.SIGNS_STANDING[3], 21, 17)  # swim-dock board
    m.collide(21, 18, 2, 1)
    bench(m, 25, 15, landmark="Lake Parsippany")
    bench(m, 9, 12, landmark="Lake Parsippany")  # overlook bench
    m.lamp(22, 12)
    m.stamp("deco-below", R.ROCK_MED, 24, 5)
    m.flowers(25, 13, n=4, spread=1)
    m.flowers(7, 10, n=4, spread=1)

    # lakeshore greenery: bushes along the thin north shore, trees on the
    # west + east banks
    m.stamp("deco-below", R.BUSH_ROUND, 5, 0)
    m.stamp("deco-below", R.BUSH_ROUND, 12, 0)
    m.stamp("deco-below", R.BUSH_ROUND, 20, 0)
    m.flowers(9, 1, n=4, spread=1)
    for x, y in ((1, 3), (2, 8), (24, 3), (25, 5)):
        m.tree(x, y, stamp=rng.choice(("tree_light", "tree_dark")))
    m.stamp("deco-below", R.BUSH_ROUND, 9, 17)

    # ================= garden apartments + cottages =================
    hedge_line(m, 2, 26, 2, 31)  # hedge closing the terrace's west end
    m.set("deco-below", 3, 30, M.mg("mailbox"))
    m.collide(3.2, 30.2, 0.6, 0.8)
    m.flowers(23, 34, n=4, spread=1)
    # the lane: tees into Vail Rd on the east (junction cells overwritten
    # with interior fill so the tan meets the asphalt flush)
    lane = {(x, y) for x in range(2, 33) for y in (41, 42)}
    path(m, lane)
    m.fill("ground-detail", 32, 41, 1, 2, R.PATH_TAN.fill)  # Vail Rd mouth
    noticeboard(m, 24, 43, landmark="Public Library")
    m.collide(24.2, 43.3, 0.6, 0.7)
    bench(m, 30, 43, landmark="Public Library")
    m.lamp(31, 43)
    m.lamp(8, 43)
    m.lamp(20, 43)
    m.tree(4, 45, stamp="tree_fruit_b")
    m.tree(12, 46, stamp="tree_light")
    m.tree(18, 45, stamp="tree_round_small")
    m.tree(27, 46, stamp="tree_dark")
    m.flowers(15, 45, n=5, spread=2)

    # ================= NJ Transit stop =================
    # shelter (above) + concrete platform + bus bay: the platform runs from
    # the shelter door east into the Smith Rd sidewalk, the bay is asphalt
    # continuous with the road, and a bus waits at the pole sign.
    m.stamp("deco-below", M.BUS_SIGN, 46, 32)
    m.collide(46.3, 33.3, 0.4, 0.7)
    bench(m, 42, 33, landmark="NJ Transit Stop")
    m.set("deco-below", 45, 33, M.mg("trash_bin"))
    m.collide(45.2, 33.3, 0.6, 0.7)
    vehicle(m, "bus", 45, 35, "v")
    m.set("ground-detail", 46, 39, M.mg("storm_drain"))
    m.lamp(40, 33)
    m.tree(37, 36, stamp="tree_round_small")
    m.stamp("deco-below", R.BUSH_ROUND, 39, 38)
    m.flowers(38, 35, n=4, spread=1)

    # ================= community center + school =================
    bench(m, 53, 33, landmark="Community Center")
    m.set("deco-below", 63, 33, M.mg("trash_bin"))
    m.collide(63.2, 33.3, 0.6, 0.7)
    m.stamp("deco-below", R.PLANTER_YELLOW, 63, 30)
    m.collide(63, 30, 2, 2)
    m.stamp("deco-below", M.BUS_SIGN, 72, 33)  # school bus stop
    m.collide(72.3, 34.3, 0.4, 0.7)
    m.lamp(54, 34)
    m.lamp(71, 34)

    # rec field: fenced light meadow with goal posts
    m.meadow(55, 37, 8, 8)
    _fence_rect(m, 54, 36, 10, 10, gate_cols=(58, 59))
    path_rect(m, 58, 35, 2, 2)  # gate path from the esplanade
    for gx in (56, 61):
        m.stamp("deco-below", R.POST_WOOD_A, gx, 39)
        m.stamp("deco-below", R.POST_WOOD_B, gx, 42)
        m.collide(gx, 39, 1, 1)
        m.collide(gx, 42, 1, 1)
    bench(m, 52, 38, landmark="Community Center")
    m.lamp(66, 43)
    m.set("deco-below", 71, 43, M.mg("mailbox"))
    m.collide(71.2, 43.2, 0.6, 0.8)

    # ================= street furniture along Route 46 ====================
    for x in (5, 21, 45, 63):
        m.lamp(x, 19)
    for x in (12, 30, 40, 56, 68):
        m.lamp(x, 24)
    m.set("ground-detail", 30, 23, M.mg("storm_drain"))
    m.set("ground-detail", 59, 21, M.mg("storm_drain"))
    m.stamp("deco-below", M.BUS_SIGN, 26, 24)
    m.collide(26.3, 25.3, 0.4, 0.7)
    # Smith Rd + Vail Rd lamps
    m.lamp(47, 5)
    m.lamp(51, 11)
    m.lamp(32, 46)
    # signals at Route 46 & Smith Rd, a street blade where Vail Rd tees in
    signal(m, 48, 21, 50, 23)
    street_blade(m, 32, 25)

    # ================= tree fringes (clustered) =================
    for x, y in ((29, 4), (33, 3)):
        m.tree(x, y, stamp=rng.choice(("tree_light", "tree_dark")))
    m.tree(40, 3, stamp="tree_round_small")
    for x, y in ((65, 2), (69, 1), (73, 3), (67, 6), (72, 7)):
        m.tree(x, y, stamp=rng.choice(("tree_light", "tree_dark")))
    m.stamp("deco-below", R.BUSH_ROUND, 70, 9)
    for x, y in ((38, 44), (41, 46), (38, 30)):
        m.tree(x, y, stamp=rng.choice(("tree_light", "tree_dark")))
    for x, y in ((44, 47), (54, 48), (72, 46), (73, 42)):
        m.tree(x, y, stamp=rng.choice(("tree_light", "tree_dark", "tree_round_small")))
    m.stamp("deco-below", R.ROCK_SMALL, 46, 45)
    m.flowers(50, 46, n=4, spread=2)

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
