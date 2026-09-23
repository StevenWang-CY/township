"""Hand-tuned layout for Dover, NJ (nj11-2026) — 75x50 tiles.

Reading of the town: majority-Hispanic working-class downtown. Blackwell
Street is the spine — a dense brick storefront row with awnings and signs.
The memorable set-piece is the south-west quarter: the market plaza spilling
toward the NJ Transit station, whose platform and track corridor run along
the bottom of the map. Warm terracotta accents (awnings, banners, planters)
carry Dover's accent color.

Grid plan (cols x rows):
  - Blackwell St ....... horizontal road rows 23-25, west+east map exits
  - Warren St .......... vertical road cols 17-19, Blackwell -> station,
                         level crossing over the rails, south map exit;
                         a bus bay notched into its east side by the plaza
  - Bergen St .......... vertical road cols 45-47, north + south map exits
                         (with its own level crossing), signals at Blackwell
  - storefront rows .... rows 16-21 north of Blackwell: three shops west of
                         the housing lane, La Finca + bodegas east of it
  - housing ............ four cream cottages rows 6-13 on one walk (row
                         14) from cols 8 to 41, the eastern pair with
                         garages and driveways; a lane drops to Blackwell
  - plaza set-piece .... cols 21-29, rows 28-34 (market stall, banners),
                         the bus shelter on its south-west corner
  - station set-piece .. building cols 6-14, platform rows 38-41 abutting
                         the NJ Transit double-track corridor rows 42-46,
                         which runs the full map width (rails rows 43+45)
  - park ............... cols 24-38, rows 35-41 (well, trees, benches)
  - church ............. cols 48-55 north-east, front garden with statue
  - factory ............ cols 58-70 north-east, yard lot rows 5-9 off a
                         lane from Bergen St, smokestack; a cottage on the
                         yard's east side
  - east village ....... a four-shop strip rows 28-33 and a stone
                         apartment block rows 35-40 south of Blackwell east
                         of Bergen, walks tying them to Bergen St
"""

from __future__ import annotations

from mapgen import moderntiles as M
from mapgen import tiles as R
from mapgen.build_maps import (
    MapCanvas,
    apron,
    bench,
    bus_shelter,
    church,
    cottage,
    driveway,
    emit_edge_ring,
    emit_ground_shade,
    emit_ground_wear,
    facade_wall,
    garage,
    grand,
    hedge_line,
    market_stall,
    noticeboard,
    park_stalls,
    path,
    path_rect,
    patio,
    platform,
    poles,
    shed,
    signal,
    stop_sign,
    storefront,
    vehicle,
)

#: Roads leaving the map: (side, road segment's first row / column, sign).
EXITS = [
    ("w", 23, "TO WHARTON"),
    ("e", 23, "TO ROCKAWAY"),
    ("n", 45, "TO RT 46"),
    ("s", 45, "TO RANDOLPH"),
    ("s", 17, "TO RT 10"),
]


def compose(m: MapCanvas) -> None:
    rng = m.rng

    # ================= ground tone =================
    m.base_grass()
    m.meadow(26, 35, 12, 7)  # park lawn
    m.meadow(50, 35, 6, 6)  # SE pocket by the pond
    m.meadow(3, 3, 12, 4)  # behind housing

    # ================= rail corridor (before roads/buildings) =============
    # NJ Transit double-track line across the full map width; the rails
    # themselves are laid after paint_roads() so the two level crossings
    # (Warren St, Bergen St) read as embedded track.
    m.blob_rect("ground-detail", 0, 42, 75, 5, R.GRAVEL, holes=False)
    m.reserve(0, 42, 75, 5)  # no sidewalk ring inside ballast
    m.collide(0, 42, 17, 5)  # keep agents off the tracks...
    m.collide(20, 42, 25, 5)  # ...except at the two crossings
    m.collide(48, 42, 27, 5)

    # ================= roads =================
    m.road_h(23, 0, 74, width=3)  # Blackwell Street
    m.road_v(17, 25, 49, width=3)  # Warren St -> station, rail
    #                                       crossing, south map exit
    m.road_v(45, 0, 49, width=3)  # Bergen St, north+south exits
    # bus bay notched into Warren St's east side at the station forecourt
    for yy in range(33, 38):
        for xx in (20, 21):
            m.road_mask.add((xx, yy))

    # ================= plaza set-piece =====================================
    # cream concrete, painted as one continuous piece with the street
    # sidewalks by paint_roads()
    m.pave(21, 27, 9, 8)

    # concrete door-walks, poured together with the road sidewalks
    m.pave(9, 14, 33, 1)  # housing walk: all four cottage doors + garages...
    m.pave(12, 15, 2, 7)  # ...and the lane down to Blackwell
    m.pave(51, 17, 2, 6)  # St Mary's door walk to Blackwell
    m.pave(49, 7, 9, 2)  # factory yard lane off Bergen St
    m.pave(64, 10, 9, 1)  # yard cottage's walk to the lot
    m.pave(49, 34, 18, 1)  # east shop strip's walk to Bergen St
    m.pave(49, 41, 24, 1)  # apartment block's walk to Bergen St
    m.pave(57, 35, 1, 6)  # ...joined north-south past the pond

    # ================= buildings (reserve before paint_roads) =============
    # -- storefront rows north of Blackwell, doors on the sidewalk
    storefront(m, 2, 16, 5, 6, facade="brick", roof="slate", sign=1)  # laundromat
    storefront(m, 8, 16, 4, 6, facade="cream", roof="terracotta", awning=True)  # bakery
    storefront(m, 14, 16, 8, 6, facade="brick", roof="terracotta", sign=2)  # botica
    storefront(
        m,
        22,
        16,
        6,
        6,
        facade="brick",
        roof="terracotta",
        awning=True,
        landmark="La Finca Restaurant",
    )
    # Bodega Row (the landmark rect spans the bodega and the taqueria)
    storefront(
        m, 31, 16, 4, 6, facade="cream", roof="terracotta", awning=True, landmark="Bodega Row"
    )
    storefront(
        m,
        35,
        16,
        4,
        6,
        facade="brick",
        roof="terracotta",
        sign=4,
        window=False,
        landmark="Bodega Row",
    )
    storefront(m, 39, 16, 4, 6, facade="cream", roof="terracotta", awning=True)  # barber
    # -- St. Mary's Church
    church(m, 48, 10, 8, 7, variant="stone", landmark="St. Mary's Church")
    # -- Factory & warehouse district
    grand(m, 58, 14, 9, 8, facade="stone_large", windows=True, landmark="Factory")
    # brick smokestack rising above the roofline + rooftop vent
    m.stamp("buildings-top", facade_wall("stone_small", 2, rows=[0, 1, 1, 2]), 64, 11)
    m.anchor("smoke", 64.5, 10)
    m.stamp("buildings-top", R.METAL_GRATE, 59, 14)
    storefront(m, 67, 16, 4, 6, facade="stone_small", roof="stone", window=False)
    # -- Public housing cottages: the original pair on the walk, two more
    #    with garages and driveways on the lane behind the storefronts
    cottage(m, 8, 6, 6, 8, landmark="Public Housing")
    cottage(m, 15, 6, 6, 8, landmark="Public Housing")
    cottage(m, 22, 6, 6, 8, landmark="Public Housing")
    garage(m, 28, 9, roof="cedar")
    driveway(m, 28, 12, 2, 2)
    cottage(m, 32, 6, 6, 8, roof="slate", landmark="Public Housing")
    garage(m, 38, 9, roof="slate", door_dx=1)
    driveway(m, 38, 12, 2, 2)
    # -- a cottage on the factory yard's east side, a shed behind the pen
    cottage(m, 66, 3, 7, 7, roof="cedar")
    shed(m, 3, 3)
    # -- Public Library
    grand(m, 34, 29, 9, 6, facade="stone_large", windows=True, landmark="Public Library")
    # -- Dover Station
    grand(
        m, 6, 31, 9, 7, facade="stone_large", roof="stone", door="metal", landmark="Dover Station"
    )
    m.stamp("buildings-base", R.SIGNS_WALL[3], 7, 35)
    # -- east village: a shop strip and a stone apartment block south of
    #    Blackwell, east of Bergen, on their own walks
    storefront(m, 50, 28, 5, 6, facade="brick", roof="slate", sign=2)  # botanica
    storefront(m, 55, 28, 5, 6, facade="cream", roof="terracotta", awning=True)  # panaderia
    storefront(m, 60, 28, 5, 6, facade="brick", roof="cedar", sign=3)  # check cashing
    storefront(m, 66, 28, 6, 6, facade="cream", roof="slate", awning=True)  # pizzeria
    grand(m, 60, 35, 9, 6, facade="stone_gray", windows=True)  # Dover Mills apartments
    storefront(m, 70, 35, 3, 6, facade="brick", roof="slate", window=False, sign=None)

    # ================= factory yard lot (paved with the sidewalks) ========
    park_stalls(m, 58, 5, 8, 5, "h", landmark="Factory", fill=0.7)

    # ================= paint the road network =================
    m.paint_roads()

    # ================= railway (rails over ballast + crossings) ===========
    crossing = set(range(17, 20)) | set(range(45, 48))
    for y in (43, 45):
        for x in range(0, 75):
            m.set("ground-detail", x, y, M.mg("rail_x") if x in crossing else M.mg("rail_h"))

    # ================= station platform (abuts the ballast) ===============
    platform(m, 3, 38, 14, 4, landmark="Dover Station")
    m.lamp(4, 38)
    m.lamp(15, 38)
    bench(m, 14, 39, landmark="Dover Station")
    # forecourt bus stop: the shelter beside the bay, a bus pulled in
    bus_shelter(m, 22, 35, landmark="Dover Station")
    m.stamp("deco-below", M.BUS_SIGN, 22, 33)
    m.collide(22.3, 34.3, 0.4, 0.7)
    vehicle(m, "bus", 20, 34, "v", facing="n")

    # ================= plaza dressing =================
    market_stall(m, 22, 29, landmark="Town Park")
    m.stamp("deco-below", R.MENU_BOARD, 28, 30)
    m.collide(28, 30, 2, 2)
    m.stamp("deco-below", R.CRATE, 23, 33)
    m.stamp("deco-below", R.BARREL, 25, 33)
    m.collide(23, 33, 4, 2)
    m.stamp("deco-below", R.PLANTER_YELLOW, 27, 33)
    m.collide(27, 33, 2, 2)
    # papel-picado-adjacent banner posts at the plaza corners
    for bx, banner in ((21, R.BANNER_RED_A), (28, R.BANNER_RED_B)):
        m.stamp("deco-below", R.POST_WOOD_A, bx, 27)
        m.stamp("buildings-top", banner, bx, 26)
    m.lamp(20, 28)
    m.lamp(29, 27)

    # ================= La Finca outdoor seating =================
    patio(
        m,
        28,
        19,
        3,
        3,
        stools=((0, 0), (1, 1)),
        landmark="La Finca Restaurant",
        blocks=((0, 0, 3, 2),),
    )
    m.stamp("deco-below", R.PLANTER_PURPLE, 30, 18)
    m.stamp("deco-below", R.SIGNS_STANDING[1], 28, 21)

    # ================= church garden =================
    # (door walk to Blackwell is paved with the sidewalks, see pave above)
    m.stamp("deco-below", R.STATUE, 48, 18)
    m.collide(48, 19, 2, 2)
    m.stamp("deco-below", R.PLANTER_YELLOW, 54, 18)
    m.collide(54, 18, 2, 2)
    m.flowers(49, 21, n=7, spread=2)
    m.flowers(55, 20, n=5, spread=2)
    hedge_line(m, 49, 17, 50, 17)  # clipped hedges flanking the walk
    hedge_line(m, 53, 17, 55, 17)

    # ================= factory yard =================
    # ranch fence with proper end posts screening the yard from the lot
    fy = R.FENCE_WOOD
    m.stamp("deco-below", fy["corner_nw"], 57, 11)
    for i, fx in enumerate(range(59, 62)):
        m.stamp("deco-below", fy["rail_h_a" if i % 2 == 0 else "rail_h_b"], fx, 11)
    m.stamp("deco-below", fy["corner_ne"], 62, 11)
    m.collide(57, 11, 7, 2)
    m.stamp("deco-below", R.CRATE, 71, 17)
    m.stamp("deco-below", R.CRATE, 71, 19)
    m.stamp("deco-below", R.BARREL, 72, 21)
    m.collide(71, 17, 3, 5)
    m.set("ground-detail", 57, 25, M.mg("storm_drain"))
    m.set("ground-detail", 12, 25, M.mg("storm_drain"))
    # on-street parking by the factory
    for x in range(58, 68, 2):
        m.set("ground-detail", x, 25, M.mg("parking_stall"))
    m.stamp("deco-below", R.BUSH_ROUND, 70, 5)
    m.tree(72, 12, stamp="tree_round_small")

    # ================= housing block =================
    # (door walk + lane to Blackwell are paved with the sidewalks above)
    # garden pen west of the cottages
    f = R.FENCE_WOOD
    m.stamp("deco-below", f["corner_nw"], 2, 9)
    m.stamp("deco-below", f["corner_ne"], 6, 9)
    m.stamp("deco-below", f["corner_sw"], 2, 13)
    m.stamp("deco-below", f["corner_se"], 6, 13)
    for i, x in enumerate(range(4, 6)):
        m.stamp("deco-below", f["rail_h_a" if i % 2 == 0 else "rail_h_b"], x, 9)
        m.stamp("deco-below", f["rail_h_a" if i % 2 else "rail_h_b"], x, 13)
    m.stamp("deco-below", f["rail_v"], 2, 11)
    m.stamp("deco-below", f["rail_v"], 6, 11)
    m.collide(2, 9, 6, 1)
    m.collide(2, 13, 6, 1)
    m.collide(2, 10, 1, 3)
    m.collide(7, 10, 1, 3)
    for gx in range(3, 6):
        m.set("deco-below", gx, 11, rng.choice(R.CROP_TILES))
        m.set("deco-below", gx, 12, rng.choice(R.CROP_TILES))
    m.stamp("deco-below", R.PLANTER_PURPLE, 21, 12)
    m.collide(21, 12, 2, 2)
    # property hedges between the lane houses
    hedge_line(m, 31, 7, 31, 13)
    hedge_line(m, 41, 7, 41, 13)
    m.flowers(43, 11, n=4, spread=1)

    # ================= library frontage =================
    apron(m, 37, 35, 3, 1)
    path_rect(m, 38, 36, 2, 2)  # doorstep lane to the park loop
    noticeboard(m, 32, 35, landmark="Town Park")
    m.stamp("deco-below", R.SIGNS_STANDING[0], 43, 33)
    m.collide(43, 34, 2, 1)

    # ================= town park =================
    park_path = set()
    for x in range(26, 37):
        park_path.update({(x, 37), (x, 40)})
    for y in range(37, 41):
        park_path.update({(26, y), (36, y)})
    for y in range(35, 37):
        park_path.add((30, y))  # entrance from the plaza side
        park_path.add((31, y))
    for x in range(37, 44):
        park_path.add((x, 38))  # entrance from Bergen St
        park_path.add((x, 39))
    path(m, park_path)
    m.stamp("deco-below", R.WELL, 30, 37)
    m.collide(30, 38, 4, 3)
    m.tree(27, 36, stamp="tree_round_small")
    m.tree(35, 36, stamp="tree_round_small")
    m.tree(24, 40, stamp="tree_fruit_a")
    bench(m, 28, 38, landmark="Town Park")
    bench(m, 34, 38, landmark="Town Park")
    m.flowers(28, 41, n=6, spread=2)
    m.flowers(34, 36, n=5, spread=1)
    m.anchor("flower", 25, 38)
    m.lamp(26, 41)
    m.lamp(36, 37)

    # ================= east village dressing =================
    m.stamp("deco-below", R.POND_STONE, 52, 36)
    m.anchor("water-foam", 54, 38)
    m.collide(52, 36, 5, 5)
    bench(m, 50, 38)
    m.flowers(50, 36, n=4, spread=1)
    m.set("deco-below", 65, 34, M.mg("trash_bin"))
    m.collide(65.2, 34.3, 0.6, 0.7)
    m.set("deco-below", 56, 34, M.mg("newsbox"))
    m.collide(56.2, 34.3, 0.6, 0.7)
    m.lamp(49, 33)
    m.lamp(66, 33)
    m.lamp(58, 40)
    m.lamp(70, 40)
    hedge_line(m, 58, 36, 58, 40)  # hedge along the block's west walk

    # ================= tree fringes (clustered, not scattered) ============
    north_forest = [(2, 5), (7, 4), (28, 4), (36, 3), (30, 3), (41, 3)]
    for x, y in north_forest:
        m.tree(x, y, stamp=rng.choice(("tree_light", "tree_dark")))
    for x, y in ((3, 30), (6, 28), (2, 36), (9, 29)):
        m.tree(x, y, stamp=rng.choice(("tree_light", "tree_dark")))
    m.stamp("deco-below", R.ROCK_MED, 4, 33)
    # low green fringe south of the rail corridor (kept small so the
    # tracks stay visible)
    for x, y in ((5, 49), (24, 49), (55, 49), (70, 49)):
        m.tree(x, y, stamp="tree_round_small")
    m.stamp("deco-below", R.BUSH_ROUND, 12, 48)
    m.stamp("deco-below", R.BUSH_ROUND, 33, 48)
    m.stamp("deco-below", R.BUSH_ROUND, 63, 48)
    m.stamp("deco-below", R.BUSH_ROUND, 42, 7)
    m.stamp("deco-below", R.BUSH_ROUND, 21, 7)
    m.stamp("deco-below", R.FERN, 2, 27)
    m.stamp("deco-below", R.FERN, 66, 48)
    # loose flower drifts along the verges (clustered)
    m.flowers(46, 20, n=4, spread=1)
    m.flowers(64, 27, n=5, spread=2)
    m.flowers(23, 48, n=4, spread=1)
    m.flowers(48, 48, n=5, spread=1)

    # ================= street furniture along Blackwell ===================
    for x in (7, 26, 38, 54, 68):
        m.lamp(x, 21)
    for x in (10, 32, 50, 62):
        m.lamp(x, 26)
    m.set("deco-below", 29, 22, M.mg("hydrant"))
    m.collide(29.2, 22.3, 0.6, 0.7)
    m.set("deco-below", 34, 22, M.mg("mailbox"))
    m.collide(34.2, 22.2, 0.6, 0.8)
    m.set("deco-below", 43, 22, M.mg("trash_bin"))
    m.collide(43.2, 22.3, 0.6, 0.7)
    m.set("deco-below", 30, 26, M.mg("newsbox"))
    m.collide(30.2, 26.3, 0.6, 0.7)
    m.set("deco-below", 21, 22, M.mg("planter_box"))
    m.collide(21.1, 22.3, 0.8, 0.7)
    m.set("deco-below", 42, 22, M.mg("planter_box"))
    m.collide(42.1, 22.3, 0.8, 0.7)
    m.stamp("deco-below", M.BUS_SIGN, 49, 26)
    m.collide(49.3, 27.3, 0.4, 0.7)
    # signals at Blackwell & Bergen, a stop sign where Warren St tees in,
    # utility poles down the south verge with the wires over the sidewalk
    signal(m, 45, 23, 47, 25)
    stop_sign(m, 20, 27)
    poles(m, [(x, 27) for x in range(3, 73)])

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
