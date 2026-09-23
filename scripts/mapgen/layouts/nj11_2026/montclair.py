"""Hand-tuned layout for Montclair, NJ (nj11-2026) — 75x50 tiles.

Reading of the town: leafy, progressive, affluent arts hub. Bloomfield Ave
is the spine — a tree-lined avenue with a DOUBLE row of street trees, tudor
timber-band boutiques behind clipped hedges, and brownstone-ish cream
rowhouses with metal stoop railings and garages off a rear alley. The
memorable set-piece is the NW quarter: the Montclair Art Museum — grand
stone facade with banners over a stone-floored plaza with a fountain on the
door axis, benches, planters, railings — with the members' parking lot
behind it. Autumn warmth via fruit trees, yellow planters and flower drifts.

Grid plan (cols x rows):
  - Bloomfield Ave ..... horizontal road rows 23-25, west+east map exits,
                         signals at Church St
  - Church St .......... vertical road cols 44-46, north exit -> Bloomfield
  - S. Fullerton Ave ... vertical road cols 27-29, Bloomfield -> south exit
  - Grove St ........... vertical road cols 51-53, Bloomfield -> station
  - museum set-piece ... building cols 10-19 rows 9-16, fountain plaza
                         rows 17-21 opening onto the avenue, lot rows 3-6
                         behind it off a lane down the west side
  - Claremont homes .... three cottages rows 3-9 on a walk (row 10) that
                         meets Church St, behind the boutiques
  - boutique row ....... tudor shops cols 21-34, rows 13-19, hedged gardens
  - town hall .......... cols 35-42, rows 12-18, paved forecourt
  - Anderson Park ...... cols 47-58 rows 8-21: bandshell, pond, sculptures
  - brownstones ........ two cream rowhouses cols 60-72 rows 13-20, stoops,
                         rear garages rows 9-11 off an alley (row 12)
  - Watchung Plaza ..... cafe + bookshop + deli rows 28-34, plaza rows 35-39
  - library ............ cols 19-26 rows 28-34, forecourt to Fullerton
  - St. Paul Baptist ... cols 8-15 rows 32-39, tan lane to the avenue,
                         a cottage on the lane's south leg
  - Bay St Station ..... cols 55-63 rows 30-36, platform + rail rows 42-46,
                         a brownstone east of it
  - Fullerton row ...... three row houses rows 41-46 on a walk (row 47)
                         between Fullerton and the rail terminal
"""

from __future__ import annotations

from mapgen import moderntiles as M
from mapgen import tiles as R
from mapgen.build_maps import (
    MapCanvas,
    awning_strip,
    bench,
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
    noticeboard,
    pad_stamp,
    park_stalls,
    path,
    patio,
    platform,
    shed,
    signal,
    storefront,
    street_blade,
)

#: Roads leaving the map: (side, road segment's first row / column, sign).
EXITS = [
    ("w", 23, "TO VERONA"),
    ("e", 23, "TO BLOOMFIELD"),
    ("n", 44, "TO UPPER MONTCLAIR"),
    ("s", 27, "TO WEST ORANGE"),
]


def tudor_shop(
    m: MapCanvas,
    x: int,
    y: int,
    w: int,
    door_dx: int | None = None,
    sign: int | None = None,
    awning: bool = False,
    door: str = "red",
    landmark: str | None = None,
) -> None:
    """Tudor boutique: cedar shingle roof (3) + timber band (2) + light
    cream shopfront (2). Footprint w x 7 — a red door pops against the
    cream, and every free bay gets a bright display window. ``landmark``
    registers the front for the spot pass."""
    m.reserve(x, y - 1, w, 8)
    m.stamp("buildings-top", M.shingle_stamp("cedar", w, 3), x, y)
    m.stamp("buildings-base", pad_stamp(R.WALL_TIMBER_BAND, w, 2), x, y + 3)
    m.stamp("buildings-base", facade_wall("cream", w, rows=[4, 5]), x, y + 5)
    dd = door_dx if door_dx is not None else (w - 2) // 2
    ds = R.DOOR_RED if door == "red" else R.DOOR_WOOD
    # top row overlays the wall on buildings-top: the arched door art has
    # transparent corners that must not punch grass holes into the facade
    m.building_stamp(ds, x + dd, y + 5, top_rows=1)
    # display-window rhythm: fill the shopfront bays the door leaves free
    placed = x - 2
    for wx in range(x + 1, x + w - 2):
        if wx < placed + 2 or (wx <= x + dd + 1 and x + dd <= wx + 1):
            continue
        m.stamp("buildings-base", M.WINDOW, wx, y + 5)
        placed = wx
    if awning:
        m.stamp("buildings-top", awning_strip(w), x, y + 3)
    elif sign is not None:
        if w >= 5:
            sx = x + w - 3 if dd <= 1 else x + 1
        else:
            sx = x + dd
        # buildings-top: the sign tile has transparent margins, so drawing
        # it over the band (instead of replacing the band tile) avoids
        # punching a grass-colored hole through the facade
        m.stamp("buildings-top", R.SIGNS_WALL[sign % len(R.SIGNS_WALL)], sx, y + 4)
    m.collide(x, y, w, 7)
    m.register_front(landmark, x, y, w, 7, x + dd, y + 6, y + 3)
    from mapgen.build_maps import shadow_rect

    shadow_rect(m, x, y, w, 7)


def compose(m: MapCanvas) -> None:
    rng = m.rng

    # ================= ground tone =================
    m.base_grass()
    m.meadow(47, 8, 13, 12)  # Anderson Park lawn
    m.meadow(3, 42, 5, 5)  # SW meadow remnant
    m.meadow(2, 26, 6, 6)  # west lawn by the avenue

    # ================= rail corridor (before roads/buildings) =============
    # NJT Montclair-Boonton line: gravel ballast runs off the EAST map edge
    # (phantom cells keep the fill seamless at x=74) and ends in a proper
    # terminal at the west end — rounded ballast apron, metal buffer
    # barrier, capped rails, freight barrel. Track = 3-row band of dark
    # vertical planks (cross-ties) + two seamless metal rail courses.
    ballast = {(x, y) for x in range(42, 77) for y in range(42, 47)}
    m.blob("ground-detail", ballast, R.GRAVEL, holes=False)
    for y in (43, 44, 45):  # cross-tie band
        for x in range(45, 75):
            m.set("ground-detail", x, y, rng.choice(R.PLANKS_V_DARK))
    for y in (43, 44):  # two rail courses
        m.set("deco-below", 45, y, R.RAIL_BAR_CAP_W)
        for x in range(46, 75):
            m.set("deco-below", x, y, rng.choice(R.RAIL_BAR_H))
    m.stamp("deco-below", R.FENCE_METAL["bars_v"], 44, 43)  # buffer stop
    m.stamp("deco-below", R.BARREL, 42, 45)  # freight clutter, apron
    m.collide(42, 42, 33, 5)
    m.reserve(42, 42, 33, 5)

    # ================= roads =================
    m.road_h(23, 0, 74, width=3)  # Bloomfield Avenue
    m.road_v(44, 0, 25, width=3)  # Church Street, north exit
    m.road_v(27, 25, 49, width=3)  # S. Fullerton Ave, south exit
    m.road_v(51, 25, 38, width=3)  # Grove St -> Bay Street Station

    # ================= paved walks (poured with the sidewalks) ============
    m.pave(7, 6, 2, 17)  # museum service lane, avenue -> members' lot
    m.pave(22, 10, 22, 1)  # Claremont homes' walk to Church St
    m.pave(60, 12, 13, 1)  # brownstones' rear alley
    m.pave(57, 21, 16, 1)  # brownstones' front walk to the park path
    m.pave(41, 35, 9, 1)  # deli's apron joining the plaza
    m.pave(65, 36, 7, 1)  # station brownstone's walk to the forecourt
    m.pave(30, 47, 12, 1)  # Fullerton row's walk
    m.pave(2, 47, 8, 1)  # lane cottage's walk...
    m.pave(8, 41, 2, 7)  # ...up to the church lane

    # ================= buildings (reserve before paint_roads) =============
    # -- Montclair Art Museum: grand stone facade with banners
    grand(m, 10, 9, 10, 8, facade="stone_large", roof="stone", windows=True, landmark="Art Museum")
    m.stamp("buildings-base", R.BANNER_RED_A, 13, 12)
    m.stamp("buildings-base", R.BANNER_RED_B, 16, 12)
    park_stalls(m, 10, 3, 10, 4, "h", landmark="Art Museum", fill=0.7)
    # -- Claremont homes behind the boutiques
    cottage(m, 22, 3, 7, 7, roof="slate")
    cottage(m, 30, 3, 6, 7, roof="deck_dark")
    cottage(m, 37, 3, 6, 7, roof="slate")
    # -- Boutique Row: two generous tudor shopfronts — cedar shingles,
    #    red doors, display windows between the timber bays
    tudor_shop(m, 21, 13, 7, awning=True, landmark="Boutique Row")
    tudor_shop(m, 28, 13, 7, sign=4, landmark="Boutique Row")  # bakery pretzel
    m.pave(23, 20, 2, 2)  # stoop paths across the front gardens
    m.pave(30, 20, 2, 2)
    # -- Town Hall: brick arch, civic banners, paved forecourt
    grand(m, 35, 12, 8, 7, facade="brick", landmark="Town Hall")
    m.pave(37, 19, 4, 3)
    # -- Brownstone rowhouses with stoops (railings added after paint),
    #    a shared driveway between them up to the rear alley and garages
    cottage(m, 60, 13, 6, 8, landmark="Anderson Park")
    cottage(m, 67, 13, 6, 8, roof="deck_dark", landmark="Anderson Park")
    driveway(m, 66, 13, 1, 9, car_at=(66, 17))
    garage(m, 61, 9, roof="slate")
    garage(m, 68, 9, roof="cedar", door_dx=1)
    # -- Watchung Plaza: cafe + tudor bookshop + a deli over a shared plaza
    storefront(m, 31, 28, 6, 7, facade="cream", awning=True, landmark="Watchung Plaza")  # cafe
    tudor_shop(m, 38, 28, 6, door_dx=3, sign=0, landmark="Watchung Plaza")  # bookshop
    storefront(m, 44, 28, 6, 7, facade="brick", roof="slate", sign=1)  # deli
    m.pave(30, 35, 11, 5)
    # -- Public Library
    grand(
        m, 19, 28, 8, 7, facade="stone_small", roof="stone", windows=True, landmark="Public Library"
    )
    m.pave(20, 35, 7, 2)
    # -- St. Paul Baptist Church, a cottage on the lane below the churchyard
    church(m, 8, 32, 8, 8, variant="clapboard", landmark="St. Paul Baptist")
    cottage(m, 2, 40, 6, 7, roof="slate")
    shed(m, 12, 44)
    # -- Bay Street Station, a brownstone east of it
    grand(
        m,
        55,
        30,
        9,
        7,
        facade="stone_large",
        roof="stone",
        door="metal",
        windows=True,
        landmark="Bay Street Station",
    )
    m.pave(54, 37, 12, 2)
    cottage(m, 66, 28, 6, 8, roof="deck_dark")
    # -- Fullerton row: three attached row houses above the rail terminal
    storefront(
        m,
        31,
        41,
        4,
        6,
        facade="cream",
        roof="deck_dark",
        window=False,
        yard=True,
        landmark="Watchung Plaza",
    )
    storefront(
        m,
        35,
        41,
        4,
        6,
        facade="brick",
        roof="slate",
        window=False,
        yard=True,
        landmark="Watchung Plaza",
    )
    storefront(
        m,
        39,
        41,
        3,
        6,
        facade="cream",
        roof="deck_dark",
        window=False,
        sign=None,
        yard=True,
        landmark="Watchung Plaza",
    )

    # ================= paint the road network =================
    m.paint_roads()

    # ================= museum fountain plaza (set-piece) ==================
    m.stamp("ground-detail", pad_stamp(R.STONE_FLOOR_PAD, 10, 5), 10, 17)
    m.stamp("deco-below", M.FOUNTAIN, 14, 18)  # on the door axis
    m.collide(14, 18, 2, 2)
    m.stamp("deco-below", R.PLANTER_YELLOW, 11, 17)
    m.stamp("deco-below", R.PLANTER_PURPLE, 17, 17)
    m.collide(11, 17, 2, 2)
    m.collide(17, 17, 2, 2)
    bench(m, 12, 20, landmark="Art Museum")
    bench(m, 17, 20, landmark="Art Museum")
    m.stamp("deco-below", R.BOULDER_PURPLE[0], 10, 19)  # sculptures
    m.stamp("deco-below", R.BOULDER_PURPLE[2], 19, 19)
    m.collide(10, 19, 1, 2)
    m.collide(19, 19, 1, 2)
    fm = R.FENCE_METAL
    for ry in (17, 19):  # garden railings
        m.stamp("deco-below", fm["bars_v"], 9, ry)
        m.stamp("deco-below", fm["bars_v"], 20, ry)
    m.collide(9.3, 17, 0.4, 4)
    m.collide(20.3, 17, 0.4, 4)
    m.lamp(10, 21)
    m.lamp(19, 21)
    # flower drifts on the west lawn
    m.flowers(4, 18, n=6, spread=2)
    m.flowers(4, 14, n=4, spread=2)
    m.stamp("deco-below", R.FLOWER_PATCH, 3, 20)
    hedge_line(m, 9, 7, 9, 15)  # hedge screening the lot lane from the museum lawn

    # ================= boutique front gardens =================
    hedge_line(m, 21, 21, 22, 21)
    hedge_line(m, 25, 21, 29, 21)
    hedge_line(m, 32, 21, 34, 21)
    m.flowers(25, 20, n=4, spread=1)
    # Claremont homes: hedges between the lots
    hedge_line(m, 29, 4, 29, 9)
    hedge_line(m, 36, 4, 36, 9)
    m.flowers(43, 5, n=4, spread=1)

    # ================= town hall forecourt =================
    m.set("deco-below", 36, 21, M.mg("planter_box"))
    m.set("deco-below", 41, 21, M.mg("planter_box"))
    m.collide(36.1, 21.3, 0.8, 0.7)
    m.collide(41.1, 21.3, 0.8, 0.7)
    m.flowers(36, 19, n=4, spread=1)
    m.flowers(42, 20, n=4, spread=1)

    # ================= brownstone stoops =================
    for rx in (59, 64, 71):
        m.stamp("deco-below", fm["rail_h"], rx, 21)
        m.collide(rx, 21.4, 2, 0.4)
    m.flowers(58, 19, n=3, spread=1)

    # ================= Anderson Park =================
    # bandshell stage: light deck + striped canopy + posts
    m.stamp("ground-detail", pad_stamp(R.DECK_LIGHT, 5, 3), 47, 11)
    m.stamp("buildings-top", awning_strip(5), 47, 10)
    m.stamp("deco-below", R.POST_WOOD_A, 47, 13)
    m.stamp("deco-below", R.POST_WOOD_B, 51, 13)
    m.collide(47, 14, 1, 1)
    m.collide(51, 14, 1, 1)
    bench(m, 48, 15, landmark="Anderson Park")
    bench(m, 50, 15, landmark="Anderson Park")
    # pond with foam shimmer
    m.stamp("deco-below", R.POND_GRASS, 53, 11)
    m.collide(53, 11, 6, 5)
    m.anchor("water-foam", 55, 13)
    # path loop: in from Church St, out to the avenue
    ppath = {(x, 16) for x in range(47, 57)}
    ppath |= {(x, 17) for x in range(47, 57)}
    ppath |= {(x, y) for x in (55, 56) for y in range(18, 22)}
    path(m, ppath)
    # sculptures on the lawn
    m.stamp("deco-below", R.BOULDER_PURPLE[1], 50, 19)
    m.stamp("deco-below", R.BOULDER_GRAY_A, 57, 19)
    m.collide(50, 19, 1, 2)
    m.collide(57, 19, 2, 2)
    m.flowers(52, 19, n=6, spread=2)
    m.flowers(58, 15, n=4, spread=1)
    m.stamp("deco-below", R.FLOWER_PATCH, 48, 18)
    m.tree(49, 8, stamp="tree_fruit_a")
    m.tree(57, 9, stamp="tree_light")
    m.tree(50, 20, stamp="tree_round_small")
    m.lamp(52, 18)

    # ================= Watchung Plaza dressing =================
    patio(
        m,
        31,
        36,
        3,
        2,
        stools=((0, 0), (2, 1)),
        landmark="Watchung Plaza",
        floor=False,
        blocks=((0, 0, 3, 2),),
    )
    m.stamp("deco-below", R.MENU_BOARD, 31, 38)
    m.collide(31, 38, 2, 2)
    m.stamp("deco-below", R.SIGNS_STANDING[2], 35, 36)  # cafe mug sign
    m.collide(35, 37, 2, 1)
    m.stamp("deco-below", R.PLANTER_PURPLE, 39, 38)
    m.collide(39, 38, 2, 2)
    bench(m, 37, 37, landmark="Watchung Plaza")
    m.lamp(30, 39)
    m.set("deco-below", 48, 35, M.mg("newsbox"))
    m.collide(48.2, 35.3, 0.6, 0.7)
    m.tree(43, 39, stamp="tree_round_small")

    # ================= library frontage =================
    noticeboard(m, 19, 36, landmark="Public Library")
    m.collide(19.2, 36.3, 0.6, 0.7)
    bench(m, 24, 36, landmark="Public Library")
    m.stamp("deco-below", R.PLANTER_YELLOW, 19, 37)
    m.collide(19, 37, 2, 2)
    m.flowers(23, 38, n=4, spread=2)

    # ================= St. Paul Baptist + churchyard =================
    lane = {(x, y) for x in (17, 18) for y in range(27, 42)}
    lane |= {(x, y) for x in range(10, 19) for y in (40, 41)}
    path(m, lane)
    # fenced memorial flower garden west of the church
    f = R.FENCE_WOOD
    m.stamp("deco-below", f["corner_nw"], 2, 33)
    m.stamp("deco-below", f["corner_ne"], 6, 33)
    m.stamp("deco-below", f["corner_sw"], 2, 37)
    m.stamp("deco-below", f["corner_se"], 6, 37)
    for i, x in enumerate(range(4, 6)):
        m.stamp("deco-below", f["rail_h_a" if i % 2 == 0 else "rail_h_b"], x, 33)
        m.stamp("deco-below", f["rail_h_a" if i % 2 else "rail_h_b"], x, 37)
    m.stamp("deco-below", f["rail_v"], 2, 35)
    m.stamp("deco-below", f["rail_v"], 6, 35)
    m.collide(2, 33, 6, 1)
    m.collide(2, 37, 6, 1)
    m.collide(2, 34, 1, 3)
    m.collide(7, 34, 1, 3)
    m.stamp("deco-below", R.FLOWER_PATCH, 3, 35)
    m.flowers(4, 36, n=5, spread=1)
    m.tree(4, 30, stamp="tree_dark")
    m.stamp("deco-below", R.PLANTER_YELLOW, 14, 42)
    m.collide(14, 42, 2, 2)
    m.flowers(15, 30, n=4, spread=1)
    m.flowers(11, 45, n=4, spread=1)

    # ================= Bay Street Station =================
    platform(m, 51, 39, 16, 3, landmark="Bay Street Station")
    m.collide(51, 41.6, 16, 0.4)
    # metal railings cap both platform ends so the deck reads as a
    # platform, not a floating wall
    m.stamp("deco-below", R.FENCE_METAL["bars_v"], 51, 39)
    m.stamp("deco-below", R.FENCE_METAL["bars_v"], 66, 39)
    m.collide(51, 39, 1, 2)
    m.collide(66, 39, 1, 2)
    m.lamp(52, 39)
    m.lamp(64, 39)
    bench(m, 58, 40, landmark="Bay Street Station")
    m.set("deco-below", 61, 40, M.mg("trash_bin"))
    m.collide(61.2, 40.3, 0.6, 0.7)
    m.stamp("deco-below", M.BUS_SIGN, 56, 26)  # bus stop on the avenue
    m.collide(56.3, 27.3, 0.4, 0.7)
    # commuter parking marks on the avenue's south edge
    for x in range(56, 64, 2):
        m.set("ground-detail", x, 25, M.mg("parking_stall"))
    m.tree(66, 38, stamp="tree_round_small")
    m.flowers(72, 33, n=4, spread=1)
    hedge_line(m, 65, 29, 65, 34)  # hedge between the station and the house

    # ================= Fullerton row =================
    m.set("deco-below", 43, 47, M.mg("mailbox"))
    m.collide(43.2, 47.2, 0.6, 0.8)
    m.flowers(36, 48, n=4, spread=1)

    # ================= double tree rows along Bloomfield ==================
    for x in (3, 8):  # west, both sides
        m.tree(x, 21, stamp="tree_round_small")
        m.tree(x, 27, stamp="tree_round_small")
    m.tree(13, 27, stamp="tree_round_small")
    m.tree(21, 27, stamp="tree_round_small")
    m.tree(37, 27, stamp="tree_round_small")
    m.tree(48, 21, stamp="tree_round_small")
    m.tree(53, 21, stamp="tree_round_small")
    m.tree(58, 21, stamp="tree_round_small")
    for x in (41, 49):
        m.tree(x, 27, stamp="tree_round_small")
    for x in (57, 62, 70):
        m.tree(x, 27, stamp="tree_round_small")

    # ================= tree clusters (leafy negative space) ===============
    m.tree(4, 6, stamp="tree_dark")
    m.tree(4, 10, stamp="tree_light")
    m.tree(42, 3, stamp="tree_round_small")
    m.stamp("deco-below", R.FERN, 2, 9)
    # Church St treeline north
    m.tree(43, 14, stamp="tree_round_small")
    m.tree(43, 18, stamp="tree_round_small")
    m.tree(48, 4, stamp="tree_dark")
    # NE woods behind the brownstones' alley
    for x, y in ((61, 5), (65, 4), (72, 6)):
        m.tree(x, y, stamp=rng.choice(("tree_light", "tree_dark")))
    m.stamp("deco-below", R.BUSH_ROUND, 59, 11)
    # SW meadow
    m.tree(13, 47, stamp="tree_light")
    m.stamp("deco-below", R.ROCK_MED, 17, 47)
    m.tree(20, 46, stamp="tree_dark")
    m.tree(24, 44, stamp="tree_round_small")
    m.flowers(24, 41, n=4, spread=2)

    # ================= street furniture along Bloomfield ==================
    for x in (5, 36, 50, 73):
        m.lamp(x, 21)
    for x in (15, 37, 64):
        m.lamp(x, 26)
    m.set("deco-below", 20, 22, M.mg("hydrant"))
    m.collide(20.2, 22.3, 0.6, 0.7)
    m.set("deco-below", 35, 22, M.mg("mailbox"))
    m.collide(35.2, 22.2, 0.6, 0.8)
    m.set("deco-below", 41, 22, M.mg("trash_bin"))
    m.collide(41.2, 22.3, 0.6, 0.7)
    m.set("deco-below", 42, 26, M.mg("newsbox"))
    m.collide(42.2, 26.3, 0.6, 0.7)
    m.stamp("deco-below", M.BUS_SIGN, 33, 26)
    m.collide(33.3, 27.3, 0.4, 0.7)
    m.set("ground-detail", 16, 25, M.mg("storm_drain"))
    m.set("ground-detail", 48, 25, M.mg("storm_drain"))
    # signals at the Church St junction, street blades at the other two
    signal(m, 44, 23, 46, 25)
    street_blade(m, 26, 27)
    street_blade(m, 54, 27)

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
