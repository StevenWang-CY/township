"""Hand-tuned layout for Randolph, NJ (nj11-2026) — 75x50 tiles.

Reading of the town: affluent, green, horse-country township. Everything is
set back from one long Main Road; the west block is the memorable set-piece —
the Randolph Diner (chrome band, DINER letterboard, outdoor stools, menu
board) next to the VFW hall (brick, terracotta shingles, twin red banners,
memorial statue on a concrete pad). Homes are cream colonials: slate-blue
shingle roofs, shuttered sash windows, ranch-fenced front yards. The
north-west corner is the crops corner: wheat + tilled field + a ranch-fence
horse pen with haystacks. Big negative space and clustered trees.

Grid plan (cols x rows):
  - Main Road .......... horizontal rows 24-26, west+east map exits
  - Quaker Hill Rd ..... vertical cols 43-45, north exit -> cul-de-sac bulb
  - farm corner ........ wheat 1-7 / tilled 8-13 rows 1-5, pen rows 7-14
  - diner set-piece .... diner cols 2-8, terrace 9-12, VFW 14-21,
                         memorial pad 23-26 (all rows 15-23)
  - shops .............. finance office 28-33, boutique 37-41
  - Town Hall .......... cols 31-39 rows 8-15, concrete walk cols 34-35
  - High School ........ cols 47-56 rows 10-18, deck playcourt rows 3-7
  - church + home ...... cols 58-65 / 69-74, backyard garden pen NE
  - sports fields ...... fenced complex cols 8-26 rows 32-45 (pitch+diamond)
  - cul-de-sac ......... asphalt bulb ~ (44,40), two cream colonials
  - Hedden Park ........ pond + creek to the S edge, stone bridge, trails,
                         picnic clearing, wooded fringe (cols 46-74)
"""

from __future__ import annotations

from mapgen import moderntiles as M
from mapgen import tiles as R
from mapgen.build_maps import (
    MapCanvas,
    apron,
    cottage,
    diner,
    grand,
    path,
    storefront,
)


def _fence_pen(
    m: MapCanvas, x: int, y: int, w: int, h: int, gate: tuple[int, int] | None = None
) -> None:
    """Ranch-fence rectangle (outer w x h, h even >= 6).
    ``gate=(x0, x1)`` leaves an opening in the top rail between those cols."""
    f = R.FENCE_WOOD
    m.stamp("deco-below", f["corner_nw"], x, y)
    m.stamp("deco-below", f["corner_ne"], x + w - 2, y)
    m.stamp("deco-below", f["corner_sw"], x, y + h - 2)
    m.stamp("deco-below", f["corner_se"], x + w - 2, y + h - 2)
    for i, cx in enumerate(range(x + 2, x + w - 2)):
        rail = f["rail_h_a" if i % 2 == 0 else "rail_h_b"]
        if not (gate and gate[0] <= cx <= gate[1]):
            m.stamp("deco-below", rail, cx, y)
        m.stamp("deco-below", rail, cx, y + h - 2)
    for ry in range(y + 2, y + h - 2, 2):
        m.stamp("deco-below", f["rail_v"], x, ry)
        m.stamp("deco-below", f["rail_v"], x + w - 2, ry)
    if gate:
        m.collide(x, y, gate[0] - x, 1)
        m.collide(gate[1] + 1, y, x + w - gate[1] - 1, 1)
    else:
        m.collide(x, y, w, 1)
    m.collide(x, y + h - 2, w, 1)
    m.collide(x, y + 1, 1, h - 3)
    m.collide(x + w - 1, y + 1, 1, h - 3)


def compose(m: MapCanvas) -> None:
    rng = m.rng

    # ================= ground tone =================
    m.base_grass()
    m.meadow(22, 2, 13, 5)  # open lawn north-centre
    m.meadow(2, 28, 8, 7)  # west verge
    m.meadow(64, 27, 9, 5)  # east verge by the park entrance
    m.meadow(28, 44, 12, 5)  # south lawn below the cul-de-sac

    # ================= crops corner (NW farm) =================
    # organic wheat patch: clipped corners round off via the inverse-corner
    # fillets, fringe tiles feather the edge into the grass
    wheat = {(x, y) for x in range(1, 8) for y in range(1, 6)}
    wheat -= {(1, 1), (7, 1), (1, 5), (7, 5)}
    m.blob("ground-detail", wheat, R.WHEAT, fringe=True)
    m.blob_rect("ground-detail", 8, 1, 6, 5, R.FIELD_TILLED, fringe=True)
    for cy in range(2, 5):
        for cx in range(9, 13):
            m.set("deco-below", cx, cy, rng.choice(R.CROP_TILES))
    m.collide(1, 1, 7, 5)

    # ================= Hedden Park water (pond + creek) =================
    # stone-rimmed pond whose south rim opens into a calm 2-wide stream
    # (pond-kit channel tiles: flat water, foam shorelines — no cascade)
    m.stamp("ground-detail", R.POND_STONE_OUTLET_S, 55, 32)
    for sy in range(37, 50):
        m.set("ground-detail", 56, sy, R.STREAM_V[0])
        m.set("ground-detail", 57, sy, R.STREAM_V[1])
    m.anchor("water-foam", 57, 34)
    m.anchor("water-foam", 56.5, 46)

    # ================= roads =================
    m.road_h(24, 0, 74, width=3)  # Main Road
    m.road_v(43, 0, 38, width=3)  # Quaker Hill Rd, north exit
    # cul-de-sac bulb (extra asphalt cells; sidewalk ring wraps it)
    for bx in range(40, 49):
        for by in range(36, 45):
            if (bx - 44) ** 2 + (by - 40) ** 2 <= 13 and m.inb(bx, by):
                m.road_mask.add((bx, by))
    # High School parking lot NE of the school + driveway apron off
    # Quaker Hill Rd — one continuous asphalt piece, kerbed by the ring
    m.road_mask |= {(x, y) for x in range(49, 57) for y in range(3, 8)}
    m.road_mask |= {(x, y) for x in range(46, 49) for y in range(4, 7)}

    # concrete walks + the memorial pad (painted with the sidewalks)
    m.pave(34, 16, 3, 8)  # Town Hall walk, door -> Main Road
    m.pave(50, 19, 4, 5)  # school walk, door -> Main Road
    m.pave(23, 19, 4, 4)  # VFW memorial pad

    # ================= buildings (reserve before paint_roads) =============
    # -- the diner + VFW set-piece corner
    diner(m, 2, 17, 7, 6)  # Randolph Diner, chrome kit
    # VFW hall: brick front under terracotta shingles (the old brick-arch
    # "fort" recomposed as a hall with a door, flags stay)
    storefront(m, 14, 15, 8, 8, facade="brick", roof="terracotta", sign=None)
    # -- shops
    storefront(m, 28, 17, 6, 6, facade="brick", roof="slate", sign=0)  # finance
    storefront(m, 37, 17, 5, 6, facade="cream", awning=True)  # boutique
    # -- civic north tier
    grand(m, 31, 8, 9, 8, facade="stone_large", windows=True)  # Town Hall
    grand(m, 47, 10, 10, 9, facade="stone_large", windows=True)  # High School
    grand(m, 58, 16, 8, 7, facade="stone_gray")  # church
    # -- housing: cream colonials, slate-blue shingles, shutters
    cottage(m, 69, 15, 6, 8, roof="slate")  # colonial E
    cottage(m, 36, 29, 6, 7, roof="slate")  # cul-de-sac W
    cottage(m, 47, 29, 6, 7, roof="slate")  # cul-de-sac E

    # ================= tan paths / trails (before paint_roads) ============
    # sports-fields path from Main Road to the gate
    path(m, {(x, y) for x in (16, 17, 18) for y in range(27, 32)})
    # park trail: entrance past the pond, over the bridge, picnic clearing
    trail: set[tuple[int, int]] = set()
    trail |= {(x, y) for x in (61, 62) for y in range(27, 40)}
    trail |= {(x, y) for x in range(59, 63) for y in (40, 41)}
    trail |= {(x, y) for x in range(50, 54) for y in (41, 42)}
    trail |= {
        (x, y) for x in range(48, 55) for y in range(41, 48) if (x - 51) ** 2 + (y - 44) ** 2 <= 7
    }
    path(m, trail)
    # cul-de-sac door walks
    apron(m, 37, 36, 4, 1, material="path")
    apron(m, 48, 36, 3, 1, material="path")

    # ================= paint the road network =================
    m.paint_roads()

    # ================= diner set-piece dressing =================
    m.anchor("smoke", 3, 18)  # griddle chimney
    m.fill("ground-detail", 9, 18, 4, 5, R.STONE_FLOOR_FILL)  # terrace
    m.stamp("deco-below", R.MENU_BOARD, 9, 16)
    m.collide(9, 16, 2, 2)
    m.stamp("deco-below", R.SIGNS_STANDING[1], 11, 16)  # utensils sign
    m.collide(11, 17, 2, 1)
    m.stamp("deco-below", R.STOOL, 9, 19)
    m.stamp("deco-below", R.STOOL, 11, 21)
    m.collide(9, 19, 2, 1)
    m.collide(11, 21, 2, 1)

    # ================= VFW memorial =================
    m.stamp("deco-below", R.STATUE, 24, 19)
    m.collide(24, 20, 2, 2)
    m.set("deco-below", 26, 21, M.mg("bench_h"))
    m.collide(26, 21, 1, 1)
    # flag banners flanking the hall door
    for bx in (13, 22):
        m.stamp("deco-below", R.POST_WOOD_A, bx, 22)
        m.stamp("buildings-top", R.BANNER_RED_A if bx == 13 else R.BANNER_RED_B, bx, 21)
        m.collide(bx + 0.2, 22.3, 0.6, 0.7)
    m.flowers(23, 18, n=6, spread=2)
    m.anchor("flower", 27, 18)

    # ================= farm pen (haystacks, hitching post) ===============
    _fence_pen(m, 2, 7, 11, 8)
    m.stamp("deco-below", R.HAYSTACK, 4, 9)
    m.collide(4, 9, 4, 4)
    m.stamp("deco-below", R.POST_WOOD_B, 9, 9)
    m.stamp("deco-below", R.BUCKET, 9, 11)
    m.collide(9, 11, 2, 2)
    m.stamp("deco-below", R.HAYSTACK, 13, 10)  # bales by the pen
    m.collide(13, 10, 4, 4)
    m.anchor("windmill", 15, 6)

    # ================= Town Hall frontage =================
    # flags hung on the granite facade, flanking the windows
    m.stamp("buildings-base", R.BANNER_RED_A, 32, 11)
    m.stamp("buildings-base", R.BANNER_RED_B, 37, 11)
    m.flowers(32, 18, n=4, spread=1)
    m.flowers(37, 18, n=4, spread=1)
    m.stamp("deco-below", R.PLANTER_YELLOW, 29, 15)
    m.collide(29, 15, 2, 2)

    # ================= school =================
    # parking lot behind the school (asphalt painted with the road network;
    # stripe the bays along the north kerb)
    for px in (50, 52, 54):
        m.set("ground-detail", px, 3, M.mg("parking_stall"))
    m.set("deco-below", 50, 8, M.mg("bench_h"))
    m.set("deco-below", 53, 8, M.mg("bench_h"))
    m.collide(50, 8, 1, 1)
    m.collide(53, 8, 1, 1)
    m.stamp("deco-below", R.PLANTER_PURPLE, 57, 4)
    m.collide(57, 4, 2, 2)
    m.lamp(48, 2)
    # frontage: school sign + bus stop
    m.stamp("deco-below", R.SIGNS_STANDING[0], 47, 20)
    m.collide(47, 21, 2, 1)
    m.stamp("deco-below", M.BUS_SIGN, 54, 22)
    m.collide(54.3, 23.3, 0.4, 0.7)
    m.lamp(50, 20)
    m.lamp(53, 20)

    # ================= church + colonial home (E) =================
    m.set("deco-below", 59, 23, M.mg("planter_box"))
    m.set("deco-below", 64, 23, M.mg("planter_box"))
    m.collide(59.1, 23.3, 0.8, 0.7)
    m.collide(64.1, 23.3, 0.8, 0.7)
    m.stamp("deco-below", R.BUSH_ROUND, 66, 19)
    m.flowers(67, 21, n=5, spread=1)
    # backyard garden pen behind the home
    _fence_pen(m, 67, 9, 8, 6)
    m.stamp("deco-below", R.FLOWER_PATCH, 69, 11)
    m.stamp("deco-below", R.SNOWDROP, 72, 11)
    m.tree(71, 12, stamp="tree_round_small")

    # ================= sports fields complex =================
    _fence_pen(m, 8, 32, 19, 14, gate=(16, 18))
    # soccer pitch: mowing stripes + chalk lines (flat pale tiles)
    chalk = M.mg("swk_1")
    for sx in range(11, 17, 2):
        m.fill("ground-detail", sx, 35, 1, 7, R.GRASS_LIGHT.fill)
    for lx in range(10, 18):
        m.set("ground-detail", lx, 34, chalk)
        m.set("ground-detail", lx, 42, chalk)
    for ly in range(34, 43):
        m.set("ground-detail", 10, ly, chalk)
        m.set("ground-detail", 17, ly, chalk)
    for lx in range(11, 17):
        m.set("ground-detail", lx, 38, chalk)
    # baseball diamond: crisp tan infield + pale bases at the points
    for dx in range(-3, 4):
        for dy in range(-3, 4):
            if abs(dx) + abs(dy) <= 3:
                m.set("ground-detail", 21 + dx, 38 + dy, rng.choice(R.PATH_TAN.fill))
    for bx, by in ((21, 35), (18, 38), (24, 38), (21, 41)):
        m.set("ground-detail", bx, by, chalk)
    m.set("deco-below", 20, 42, M.mg("bench_h"))
    m.set("deco-below", 24, 42, M.mg("bench_h"))
    m.collide(20, 42, 1, 1)
    m.collide(24, 42, 1, 1)
    m.stamp("deco-below", R.CRATE, 12, 43)
    m.stamp("deco-below", R.BUCKET, 14, 43)
    m.collide(12, 43, 4, 2)
    m.lamp(15, 30)
    m.flowers(21, 30, n=5, spread=2)

    # ================= cul-de-sac =================
    # picket-fenced front yards for the colonials (runs flank the door walks)
    f = R.FENCE_WOOD
    for i, cx in enumerate(range(33, 37)):  # W colonial, left of its walk
        m.stamp("deco-below", f["rail_h_a" if i % 2 == 0 else "rail_h_b"], cx, 36)
    m.collide(33, 36, 4, 1)
    for i, cx in enumerate(range(51, 55)):  # E colonial, right of its walk
        m.stamp("deco-below", f["rail_h_a" if i % 2 == 0 else "rail_h_b"], cx, 36)
    m.collide(51, 36, 4, 1)
    m.flowers(34, 35, n=4, spread=1)
    m.flowers(52, 35, n=4, spread=1)
    for px in (42, 46):
        m.set("ground-detail", px, 38, M.mg("parking_stall"))
    m.lamp(40, 36)
    m.lamp(48, 36)
    m.stamp("deco-below", R.BUSH_ROUND, 34, 31)
    m.stamp("deco-below", R.BUSH_ROUND, 34, 34)
    m.stamp("deco-below", R.BUSH_ROUND, 53, 31)
    m.tree(33, 34, stamp="tree_fruit_a")
    m.tree(32, 40, stamp="tree_light")
    m.flowers(35, 28, n=5, spread=2)
    m.flowers(50, 28, n=4, spread=2)
    m.anchor("flower", 33, 37)
    m.set("deco-below", 41, 44, M.mg("mailbox"))
    m.collide(41.2, 44.2, 0.6, 0.8)

    # ================= Hedden Park =================
    # stone bridge over the creek (deck row stays walkable)
    m.stamp("deco-below", R.BRIDGE_STONE, 54, 40)
    m.collide(54, 40, 5, 1)
    m.collide(54, 42, 5, 1)
    # water collision except at the bridge
    m.collide(55, 32, 4, 4)  # pond body
    m.collide(56, 36, 2, 4)
    m.collide(56, 43, 2, 7)
    # pond shore dressing
    m.stamp("deco-below", R.ROCK_MED, 53, 35)
    m.stamp("deco-below", R.FERN, 59, 31)
    # picnic clearing
    m.stamp("deco-below", R.LOG, 49, 44)
    m.stamp("deco-below", R.STUMP_WIDE, 53, 45)
    m.stamp("deco-below", R.FERN, 48, 42)
    m.collide(49, 44, 2, 2)
    m.collide(53, 45, 2, 2)
    m.set("deco-below", 51, 43, M.mg("bench_h"))
    m.collide(51, 43, 1, 1)
    m.anchor("flower", 50, 47)
    m.flowers(52, 47, n=5, spread=2)
    m.lamp(60, 27)
    m.set("deco-below", 63, 27, M.mg("newsbox"))
    m.collide(63.2, 27.3, 0.6, 0.7)
    # woods
    park_trees = [
        (53, 39, "tree_round_small"),
        (47, 45, "tree_round_small"),
        (67, 33, "tree_light"),
        (71, 36, "tree_dark"),
        (66, 41, "tree_light"),
        (64, 45, "tree_light"),
        (73, 44, "tree_dark"),
        (69, 47, "tree_light"),
        (61, 47, "tree_round_small"),
    ]
    for tx, ty, ts in park_trees:
        m.tree(tx, ty, stamp=ts)
    m.stamp("deco-below", R.ROCK_MED, 65, 38)

    # ================= tree clusters (negative space stays open) ==========
    for tx, ty, ts in [(15, 3, "tree_light"), (18, 5, "tree_dark"), (20, 3, "tree_round_small")]:
        m.tree(tx, ty, stamp=ts)
    for tx, ty, ts in [(24, 12, "tree_light"), (27, 14, "tree_dark"), (22, 14, "tree_round_small")]:
        m.tree(tx, ty, stamp=ts)
    for tx, ty, ts in [(33, 3, "tree_light"), (37, 4, "tree_dark"), (40, 6, "tree_light")]:
        m.tree(tx, ty, stamp=ts)
    for tx, ty, ts in [
        (59, 6, "tree_dark"),
        (63, 4, "tree_light"),
        (66, 2, "tree_dark"),
        (71, 4, "tree_light"),
        (74, 7, "tree_dark"),
    ]:
        m.tree(tx, ty, stamp=ts)
    for tx, ty, ts in [(1, 31, "tree_light"), (4, 34, "tree_dark"), (2, 38, "tree_light")]:
        m.tree(tx, ty, stamp=ts)
    m.stamp("deco-below", R.FERN, 5, 37)
    m.stamp("deco-below", R.ROCK_SMALL, 1, 35)
    for tx, ty, ts in [(28, 47, "tree_light"), (33, 48, "tree_dark"), (41, 48, "tree_light")]:
        m.tree(tx, ty, stamp=ts)
    m.stamp("deco-below", R.ROCK_OUTCROP_A, 1, 44)
    m.collide(1, 45, 5, 4)

    # ================= Main Road furniture =================
    for lx in (1, 27, 57, 68):
        m.lamp(lx, 22)
    for lx in (10, 31, 66):
        m.lamp(lx, 26)
    m.set("deco-below", 13, 23, M.mg("hydrant"))
    m.collide(13.2, 23.3, 0.6, 0.7)
    m.set("deco-below", 27, 23, M.mg("mailbox"))
    m.collide(27.2, 23.2, 0.6, 0.8)
    m.set("deco-below", 42, 23, M.mg("trash_bin"))
    m.collide(42.2, 23.3, 0.6, 0.7)
    m.set("deco-below", 36, 23, M.mg("planter_box"))
    m.collide(36.1, 23.3, 0.8, 0.7)
    m.set("deco-below", 11, 26, M.mg("storm_drain"))
    m.set("deco-below", 62, 24, M.mg("storm_drain"))
    # kerbside parking for the diner and the shops
    for px in (3, 5, 7):
        m.set("ground-detail", px, 24, M.mg("parking_stall"))
    for px in (29, 31, 38, 40):
        m.set("ground-detail", px, 24, M.mg("parking_stall"))

    # map edge collision walls
    m.collide(0, -1, m.w, 1)
    m.collide(0, m.h, m.w, 1)
    m.collide(-1, 0, 1, m.h)
    m.collide(m.w, 0, 1, m.h)

    # landmark labels for the scene
    for lm in m.landmarks.values():
        m.anchor("label", lm.x + lm.w / 2 - 0.5, lm.y + lm.h / 2 - 1, name=lm.name, text=lm.name)
