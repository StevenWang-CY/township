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
                         level crossing over the rails, south map exit
  - Bergen St .......... vertical road cols 45-47, north + south map exits
                         (with its own level crossing)
  - storefront row ..... rows 17-21 north of Blackwell (La Finca + bodegas)
  - plaza set-piece .... cols 21-29, rows 28-34 (market stall, banners)
  - station set-piece .. building cols 6-14, platform rows 38-41 abutting
                         the NJ Transit double-track corridor rows 42-46,
                         which runs the full map width (rails rows 43+45)
  - park ............... cols 24-38, rows 35-41 (well, trees, benches)
  - church ............. cols 48-55 north-east, front garden with statue
  - factory ............ cols 58-70 north-east edge, fenced yard, smokestack
  - housing ............ two cream cottages cols 8-18 top-left
"""

from __future__ import annotations

from mapgen import moderntiles as M
from mapgen import tiles as R
from mapgen.build_maps import (
    MapCanvas,
    apron,
    cottage,
    facade_wall,
    grand,
    pad_stamp,
    path,
    path_rect,
    storefront,
)


def compose(m: MapCanvas) -> None:
    rng = m.rng

    # ================= ground tone =================
    m.base_grass()
    m.meadow(26, 35, 12, 7)  # park lawn
    m.meadow(50, 29, 14, 9)  # SE meadow
    m.meadow(3, 3, 12, 4)  # behind housing
    m.meadow(58, 3, 12, 6)  # NE fringe

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

    # ================= plaza set-piece =====================================
    # cream concrete, painted as one continuous piece with the street
    # sidewalks by paint_roads()
    m.pave(21, 27, 9, 8)

    # concrete door-walks, poured together with the road sidewalks
    m.pave(9, 15, 10, 1)  # housing: joins both cottage doors
    m.pave(12, 16, 2, 7)  # ...and runs down to Blackwell
    m.pave(51, 17, 2, 6)  # St Mary's door walk to Blackwell

    # ================= buildings (reserve before paint_roads) =============
    # -- storefront row, north of Blackwell, doors on the sidewalk
    storefront(m, 22, 16, 6, 6, facade="brick", roof="terracotta", awning=True)  # La Finca
    storefront(m, 31, 16, 4, 6, facade="cream", roof="terracotta", awning=True)  # bodega
    storefront(m, 35, 16, 4, 6, facade="brick", roof="terracotta", sign=4, window=False)  # taqueria
    storefront(m, 39, 16, 4, 6, facade="cream", roof="terracotta", awning=True)  # barber
    # -- St. Mary's Church
    grand(m, 48, 10, 8, 7, facade="stone_gray")
    # -- Factory & warehouse district
    grand(m, 58, 14, 9, 8, facade="stone_large", windows=True)
    # brick smokestack rising above the roofline + rooftop vent
    m.stamp("buildings-top", facade_wall("stone_small", 2, rows=[0, 1, 1, 2]), 64, 11)
    m.anchor("smoke", 64.5, 10)
    m.stamp("buildings-top", R.METAL_GRATE, 59, 14)
    storefront(m, 67, 16, 4, 6, facade="stone_small", roof="stone", window=False)
    # -- Public housing cottages
    cottage(m, 8, 7, 6, 8)
    cottage(m, 15, 7, 6, 8)
    # -- Public Library
    grand(m, 34, 29, 9, 6, facade="stone_large", windows=True)
    # -- Dover Station
    grand(m, 6, 31, 9, 7, facade="stone_large", roof="stone", door="metal")
    m.stamp("buildings-base", R.SIGNS_WALL[3], 7, 35)

    # ================= paint the road network =================
    m.paint_roads()

    # ================= railway (rails over ballast + crossings) ===========
    crossing = set(range(17, 20)) | set(range(45, 48))
    for y in (43, 45):
        for x in range(0, 75):
            m.set("ground-detail", x, y, M.mg("rail_x") if x in crossing else M.mg("rail_h"))

    # ================= station platform (abuts the ballast) ===============
    m.stamp("ground-detail", pad_stamp(R.DECK_LIGHT, 14, 4), 3, 38)
    m.lamp(4, 38)
    m.lamp(15, 38)
    m.set("deco-below", 14, 39, M.mg("bench_h"))
    m.collide(14, 39, 1, 1)
    m.stamp("deco-below", M.BUS_SIGN, 20, 36)  # bus stop at the forecourt
    m.collide(20.3, 37.3, 0.4, 0.7)

    # ================= plaza dressing =================
    m.stamp("deco-below", R.MARKET_STALL, 22, 29)
    m.collide(22, 30, 6, 2)
    m.stamp("deco-below", R.MENU_BOARD, 28, 30)
    m.collide(28, 30, 2, 2)
    m.stamp("deco-below", R.CRATE, 21, 33)
    m.stamp("deco-below", R.BARREL, 23, 33)
    m.collide(21, 33, 4, 2)
    m.stamp("deco-below", R.PLANTER_YELLOW, 27, 33)
    m.collide(27, 33, 2, 2)
    # papel-picado-adjacent banner posts at the plaza corners
    for bx, banner in ((21, R.BANNER_RED_A), (28, R.BANNER_RED_B)):
        m.stamp("deco-below", R.POST_WOOD_A, bx, 27)
        m.stamp("buildings-top", banner, bx, 26)
    m.lamp(20, 28)
    m.lamp(29, 27)

    # ================= La Finca outdoor seating =================
    m.fill("ground-detail", 28, 19, 3, 3, R.STONE_FLOOR_FILL)
    m.stamp("deco-below", R.STOOL, 28, 19)
    m.stamp("deco-below", R.STOOL, 29, 20)
    m.stamp("deco-below", R.PLANTER_PURPLE, 30, 18)
    m.collide(28, 19, 3, 2)
    m.stamp("deco-below", R.SIGNS_STANDING[1], 28, 21)

    # ================= church garden =================
    # (door walk to Blackwell is paved with the sidewalks, see pave above)
    m.stamp("deco-below", R.STATUE, 48, 18)
    m.collide(48, 19, 2, 2)
    m.stamp("deco-below", R.PLANTER_YELLOW, 54, 18)
    m.collide(54, 18, 2, 2)
    m.flowers(49, 21, n=7, spread=2)
    m.flowers(55, 20, n=5, spread=2)
    m.tree(55, 8, stamp="tree_dark")

    # ================= factory yard =================
    # ranch fence with proper end posts screening the yard from the meadow
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
    m.flowers(9, 17, n=6, spread=2)
    m.flowers(17, 17, n=5, spread=2)
    m.stamp("deco-below", R.PLANTER_PURPLE, 21, 12)
    m.collide(21, 12, 2, 2)

    # ================= library frontage =================
    apron(m, 37, 35, 3, 1)
    path_rect(m, 38, 36, 2, 2)  # doorstep lane to the park loop
    m.set("deco-below", 33, 34, M.mg("newsbox"))
    m.collide(33, 34, 1, 1)
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
    m.set("deco-below", 28, 38, M.mg("bench_h"))
    m.set("deco-below", 34, 38, M.mg("bench_h"))
    m.collide(28, 38, 1, 1)
    m.collide(34, 38, 1, 1)
    m.flowers(28, 41, n=6, spread=2)
    m.flowers(34, 36, n=5, spread=1)
    m.anchor("flower", 25, 38)
    m.lamp(26, 41)
    m.lamp(36, 37)

    # ================= SE meadow: garden + pond =================
    m.stamp("deco-below", R.POND_STONE, 55, 36)
    m.anchor("water-foam", 57, 38)
    m.collide(55, 36, 5, 5)
    for gx in range(52, 57, 2):
        m.stamp("deco-below", R.BEANPOLES, gx, 30)
    for gx in range(52, 58):
        m.set("deco-below", gx, 32, rng.choice(R.CROP_TILES))
        m.set("deco-below", gx, 33, rng.choice(R.CROP_BERRY_TILES))
    m.collide(52, 30, 6, 4)
    m.tree(63, 33, stamp="tree_fruit_a")
    m.tree(67, 35, stamp="tree_fruit_a")
    m.tree(70, 31, stamp="tree_dark")
    m.tree(61, 40, stamp="tree_light")
    m.flowers(60, 36, n=6, spread=3)

    # ================= tree fringes (clustered, not scattered) ============
    north_forest = [(2, 5), (7, 4), (23, 5), (28, 4), (33, 5), (26, 6), (40, 5), (36, 3)]
    for x, y in north_forest:
        m.tree(x, y, stamp=rng.choice(("tree_light", "tree_dark")))
    m.tree(30, 3, stamp="tree_small")
    m.tree(41, 3, stamp="tree_round_small")
    for x, y in ((3, 30), (6, 28), (2, 36), (9, 29)):
        m.tree(x, y, stamp=rng.choice(("tree_light", "tree_dark")))
    m.stamp("deco-below", R.ROCK_MED, 4, 33)
    for x, y in ((52, 5), (57, 7), (71, 8), (69, 4)):
        m.tree(x, y, stamp=rng.choice(("tree_dark", "tree_light")))
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
    # NW verge: quiet corner between housing and Blackwell
    m.tree(3, 19, stamp="tree_round_small")
    m.stamp("deco-below", R.BUSH_ROUND, 5, 19)
    m.stamp("deco-below", R.ROCK_SMALL, 1, 21)
    m.flowers(4, 17, n=4, spread=2)
    # loose flower drifts along the verges (clustered)
    m.flowers(24, 14, n=5, spread=2)
    m.flowers(46, 20, n=4, spread=1)
    m.flowers(64, 27, n=5, spread=2)
    m.flowers(23, 48, n=4, spread=1)
    m.flowers(48, 48, n=5, spread=1)

    # ================= street furniture along Blackwell ===================
    for x in (5, 26, 38, 54, 68):
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
    m.set("deco-below", 44, 22, M.mg("planter_box"))
    m.collide(44.1, 22.3, 0.8, 0.7)
    m.stamp("deco-below", M.BUS_SIGN, 49, 26)
    m.collide(49.3, 27.3, 0.4, 0.7)

    # map edge collision walls
    m.collide(0, -1, m.w, 1)
    m.collide(0, m.h, m.w, 1)
    m.collide(-1, 0, 1, m.h)
    m.collide(m.w, 0, 1, m.h)

    # landmark labels for the scene
    for lm in m.landmarks.values():
        m.anchor("label", lm.x + lm.w / 2 - 0.5, lm.y + lm.h / 2 - 1, name=lm.name, text=lm.name)
