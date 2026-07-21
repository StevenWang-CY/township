"""Hand-tuned layout for Parsippany-Troy Hills (nj11-2026) — 75x50 tiles.

Reading of the town: the district's largest municipality — a modern,
comfortable suburb whose soul is Lake Parsippany. The memorable set-piece is
the north-west quarter: a two-lobed lake pinched at a narrows crossed by the
stone bridge, with a swimming dock, a waterside path loop and ducks
(water-foam anchors). Around it the town reads corporate-suburban: Route 46
runs coast to coast as a wide commercial strip; a glass-and-stone corporate
campus with a striped parking lot fills the NE; the Hindu temple sits behind
a formal garden (banners, statue, terracotta reflecting pond, fruit trees);
a strip mall with a deep concrete apron fronts Route 46; and the SE holds
the community center + school sharing fenced rec fields.

Grid plan (cols x rows):
  - Route 46 ........... horizontal road rows 21-23, west+east map exits
  - Smith Rd .......... vertical road cols 48-50, top + bottom map exits
  - Vail Rd ........... vertical road cols 33-35, Route 46 -> bottom exit
  - lake set-piece .... cols 4-22, rows 2-18: ONE water body pinched to a
                        narrows (cols 14-18, rows 10-11) fully under the
                        stone bridge at (14,9), so the bridge visibly
                        crosses water; lakeside trail rows 10-11 exits the
                        west map edge; dock cols 18-19
  - strip mall ........ shops cols 25-34, rows 13-18, paved apron row 19
  - Hindu temple ...... building cols 36-43 rows 7-13, garden rows 14-19
                        (approach path cols 38-40 fused into the Route 46
                        sidewalk, POND_GRASS reflecting pond cols 41-46)
  - corporate campus .. building cols 51-62 rows 7-15, lot rows 16-19
  - library ........... cols 23-31 rows 31-36, plaza row 37
  - residential ....... cottages cols 9-21 rows 31-38; lane rows 39-40
                        cols 6-32 tees into Vail Rd, with a spur cols 6-7
                        north to Route 46 (a real through-street)
  - transit stop ...... awning shelter cols 41-46 rows 26-31, concrete
                        platform rows 32-33 out to Smith Rd, bus bay
                        cols 45-47 rows 34-39 notched into Smith Rd
  - community/school .. cols 55-71 rows 26-32, plaza rows 33-34,
                        fenced rec fields rows 36-45
"""

from __future__ import annotations

from mapgen import moderntiles as M
from mapgen import tiles as R
from mapgen.build_maps import (
    MapCanvas,
    cottage,
    grand,
    pad_stamp,
    path,
    path_rect,
    storefront,
)

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
    # swimming dock jutting into the south lobe, base row on the shore
    m.stamp("ground-detail", pad_stamp(R.DECK_LIGHT, 2, 4), 18, 16)
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
    m.meadow(27, 2, 11, 6)  # north-center commons
    m.meadow(64, 9, 9, 8)  # NE verge
    m.meadow(2, 26, 9, 4)  # SW lawns
    m.meadow(37, 42, 8, 6)  # south commons
    m.meadow(24, 44, 7, 4)

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
    m.pave(24, 19, 12, 1)  # strip-mall apron
    m.pave(24, 37, 9, 2)  # library plaza
    m.pave(41, 32, 7, 2)  # transit platform out to Smith Rd
    m.pave(52, 33, 20, 2)  # community/school esplanade

    # ================= buildings (reserve before paint_roads) =============
    # -- strip mall on Route 46
    storefront(m, 25, 13, 4, 6, facade="cream", roof="stone", sign=1)  # deli
    storefront(m, 29, 13, 6, 6, facade="brick", awning=True)  # grocery
    # -- Hindu temple (cream, banners; garden composed below). The cream
    # facade's arch-adjacent tiles have transparent notches; backfill the
    # upper wall rows with its plain interior tile so no grass pokes
    # through the silhouette.
    cream_wall = R.FACADE_CREAM.gids[3][5]
    m.fill("deco-below", 36, 9, 8, 3, (cream_wall,))
    grand(m, 36, 7, 8, 7, facade="cream", banners=True)
    # -- corporate campus: biggest block in town, glass row added below
    grand(m, 51, 7, 12, 9, facade="stone_large", windows=True, door="metal")
    # -- public library
    grand(m, 23, 31, 9, 6, facade="stone_large", windows=True)
    # -- residential cottages
    cottage(m, 9, 31, 6, 8)
    cottage(m, 16, 31, 6, 8)
    # -- NJ Transit shelter: striped awning over a brick waiting room,
    # door opening south onto the platform
    storefront(m, 41, 26, 6, 6, facade="brick", awning=True)
    # -- community center + school on the shared esplanade
    storefront(m, 55, 26, 8, 7, facade="stone_small", roof="deck_light", sign=1)
    grand(m, 64, 26, 8, 7, facade="brick")

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
    # parking stalls + drain + entrance bollards
    for x in range(53, 62, 2):
        m.set("ground-detail", x, 16, M.mg("parking_stall"))
    m.set("ground-detail", 61, 19, M.mg("storm_drain"))
    m.set("deco-below", 54, 20, M.mg("bollard"))
    m.set("deco-below", 58, 20, M.mg("bollard"))
    m.collide(54.3, 20.3, 0.4, 0.7)
    m.collide(58.3, 20.3, 0.4, 0.7)

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
    m.set("deco-below", 47, 17, M.mg("bench_h"))
    m.collide(47, 17, 1, 1)
    m.stamp("deco-below", R.PLANTER_YELLOW, 35, 17)
    m.collide(35, 17, 2, 2)
    m.flowers(36, 18, n=5, spread=1)
    m.flowers(41, 19, n=4, spread=1)
    m.flowers(44, 19, n=4, spread=1)
    m.tree(34, 12, stamp="tree_fruit_a")
    m.tree(44, 4, stamp="tree_fruit_c")
    m.lamp(37, 18)

    # ================= strip mall apron =================
    m.stamp("deco-below", R.SIGNS_STALL[4], 33, 18)  # produce table
    m.collide(33, 19, 2, 1)
    m.set("deco-below", 24, 19, M.mg("planter_box"))
    m.collide(24.1, 19.3, 0.8, 0.7)
    m.set("deco-below", 28, 19, M.mg("newsbox"))
    m.collide(28.2, 19.3, 0.6, 0.7)
    m.set("deco-below", 35, 19, M.mg("trash_bin"))
    m.collide(35.2, 19.3, 0.6, 0.7)
    m.set("deco-below", 26, 20, M.mg("hydrant"))
    m.collide(26.2, 20.3, 0.6, 0.7)
    m.set("deco-below", 30, 20, M.mg("mailbox"))
    m.collide(30.2, 20.2, 0.6, 0.8)

    # ================= lakeside dressing =================
    m.stamp("deco-below", R.SIGNS_STANDING[3], 15, 19)  # swim-dock board
    m.collide(15, 20, 2, 1)
    m.set("deco-below", 25, 15, M.mg("bench_h"))
    m.collide(25, 15, 1, 1)
    m.set("deco-below", 9, 12, M.mg("bench_h"))  # overlook bench
    m.collide(9, 12, 1, 1)
    m.lamp(22, 12)
    m.stamp("deco-below", R.ROCK_MED, 25, 7)
    m.stamp("deco-below", R.FERN, 26, 9)
    m.stamp("deco-below", R.ROCK_SMALL, 5, 18)
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
    m.tree(4, 14, stamp="tree_round_small")  # low, clear of the trail
    for x, y in ((6, 18), (3, 19)):
        m.tree(x, y, stamp=rng.choice(("tree_light", "tree_round_small")))
    m.stamp("deco-below", R.BUSH_ROUND, 7, 19)

    # ================= library plaza =================
    m.set("deco-below", 24, 37, M.mg("newsbox"))
    m.collide(24.2, 37.3, 0.6, 0.7)
    m.set("deco-below", 30, 37, M.mg("bench_h"))
    m.collide(30, 37, 1, 1)
    m.lamp(31, 37)

    # ================= residential lane =================
    # a real through-street: the lane tees into Vail Rd on the east and a
    # spur climbs north to Route 46 on the west. Junction cells are
    # overwritten with interior fill so the tan meets the asphalt flush
    # instead of ending in a grass-fringed blob.
    lane = {(x, y) for x in range(6, 33) for y in (39, 40)}
    lane |= {(x, y) for x in (6, 7) for y in range(24, 39)}
    path(m, lane)
    m.fill("ground-detail", 6, 24, 2, 1, R.PATH_TAN.fill)  # Route 46 mouth
    m.fill("ground-detail", 32, 39, 1, 2, R.PATH_TAN.fill)  # Vail Rd mouth
    m.anchor("smoke", 10, 31)
    m.anchor("smoke", 17, 31)
    m.stamp("deco-below", R.BUSH_ROUND, 3, 33)
    m.stamp("deco-below", R.BUSH_ROUND, 3, 36)
    m.stamp("deco-below", R.PLANTER_PURPLE, 22, 34)
    m.collide(22, 34, 2, 2)
    m.flowers(4, 34, n=6, spread=2)
    m.flowers(14, 36, n=4, spread=1)
    m.flowers(21, 37, n=4, spread=1)
    m.lamp(15, 38)
    m.tree(4, 42, stamp="tree_fruit_b")
    m.tree(2, 31, stamp="tree_round_small")

    # ================= NJ Transit stop =================
    # shelter (above) + concrete platform + bus bay: the platform runs from
    # the shelter door east into the Smith Rd sidewalk, the bay is asphalt
    # continuous with the road, and the pole sign marks the bay head.
    m.stamp("deco-below", M.BUS_SIGN, 46, 32)
    m.collide(46.3, 33.3, 0.4, 0.7)
    m.set("deco-below", 42, 33, M.mg("bench_h"))
    m.collide(42, 33, 1, 1)
    m.set("deco-below", 45, 33, M.mg("trash_bin"))
    m.collide(45.2, 33.3, 0.6, 0.7)
    for y in (35, 37):
        m.set("ground-detail", 45, y, M.mg("parking_stall"))
    m.set("ground-detail", 46, 39, M.mg("storm_drain"))
    m.lamp(40, 33)
    # green pocket between Vail Rd and the shelter (no leftover pavement)
    m.meadow(37, 26, 4, 6)
    m.flowers(38, 28, n=4, spread=1)
    m.tree(37, 36, stamp="tree_round_small")
    m.stamp("deco-below", R.BUSH_ROUND, 39, 38)

    # ================= community center + school =================
    m.set("deco-below", 53, 33, M.mg("bench_h"))
    m.collide(53, 33, 1, 1)
    m.set("deco-below", 63, 33, M.mg("trash_bin"))
    m.collide(63.2, 33.3, 0.6, 0.7)
    m.stamp("deco-below", R.PLANTER_YELLOW, 63, 30)
    m.collide(63, 30, 2, 2)
    m.stamp("deco-below", M.BUS_SIGN, 72, 33)  # school bus stop
    m.collide(72.3, 34.3, 0.4, 0.7)
    m.lamp(54, 34)
    m.lamp(71, 34)

    # rec fields: fenced light meadow with goal posts
    m.meadow(55, 37, 15, 8)
    _fence_rect(m, 54, 36, 17, 10, gate_cols=(61, 62, 63))
    path_rect(m, 61, 35, 3, 2)  # gate path from the esplanade
    for gx in (58, 66):
        m.stamp("deco-below", R.POST_WOOD_A, gx, 39)
        m.stamp("deco-below", R.POST_WOOD_B, gx, 42)
        m.collide(gx, 39, 1, 1)
        m.collide(gx, 42, 1, 1)
    m.set("deco-below", 52, 38, M.mg("bench_h"))
    m.collide(52, 38, 1, 1)

    # ================= street furniture along Route 46 ====================
    for x in (5, 21, 45, 63, 72):
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
    m.lamp(36, 30)
    m.lamp(32, 42)

    # ================= tree fringes (clustered) =================
    for x, y in ((29, 4), (33, 3), (31, 8)):
        m.tree(x, y, stamp=rng.choice(("tree_light", "tree_dark")))
    m.tree(40, 3, stamp="tree_round_small")
    for x, y in ((65, 2), (69, 1), (73, 3), (67, 6), (72, 7)):
        m.tree(x, y, stamp=rng.choice(("tree_light", "tree_dark")))
    m.stamp("deco-below", R.BUSH_ROUND, 70, 9)
    for x, y in ((66, 12), (70, 15)):
        m.tree(x, y, stamp="tree_round_small")
    m.flowers(68, 13, n=5, spread=2)
    m.tree(3, 30, stamp="tree_light")
    m.tree(24, 30, stamp="tree_light")
    m.tree(28, 28, stamp="tree_round_small")
    for x, y in ((38, 44), (41, 46), (38, 30)):
        m.tree(x, y, stamp=rng.choice(("tree_light", "tree_dark")))
    for x, y in (
        (8, 47),
        (15, 48),
        (22, 46),
        (27, 48),
        (44, 47),
        (54, 48),
        (66, 48),
        (72, 46),
        (73, 42),
    ):
        m.tree(x, y, stamp=rng.choice(("tree_light", "tree_dark", "tree_round_small")))
    m.stamp("deco-below", R.FERN, 2, 45)
    m.tree(3, 46, stamp="tree_dark")
    m.stamp("deco-below", R.ROCK_SMALL, 46, 45)
    m.flowers(30, 45, n=5, spread=2)
    m.flowers(50, 46, n=4, spread=2)
    # verge between the cottages and Route 46
    m.stamp("deco-below", R.BUSH_ROUND, 12, 27)
    m.stamp("deco-below", R.BUSH_ROUND, 15, 28)
    m.flowers(13, 29, n=5, spread=2)

    # map edge collision walls
    m.collide(0, -1, m.w, 1)
    m.collide(0, m.h, m.w, 1)
    m.collide(-1, 0, 1, m.h)
    m.collide(m.w, 0, 1, m.h)

    # landmark labels for the scene
    for lm in m.landmarks.values():
        m.anchor("label", lm.x + lm.w / 2 - 0.5, lm.y + lm.h / 2 - 1, name=lm.name, text=lm.name)
