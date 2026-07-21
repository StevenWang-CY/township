#!/usr/bin/env python3
"""Render the acceptance sheet for the tiles.py registry.

Composes every named entry of ``scripts/mapgen/tiles.py`` from the real
tileset into ``scripts/mapgen/_inspect/registry_sheet.png`` (3x zoom, grouped
by category, each entry labeled). Blob entries are rendered as an assembled
5x5 demo patch (edges + fill + fringe) next to a 4x4 hole-block demo, so an
autotile whose edge tiles are misidentified is immediately obvious.

Run:
    python3 scripts/mapgen/validate_registry.py
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mapgen import tiles  # noqa: E402
from mapgen.tiles import Blob, TileStamp, rc  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_PATH = Path(__file__).resolve().parent / "_inspect" / "registry_sheet.png"

ZOOM = 3
TZ = tiles.TILE_SIZE * ZOOM
PAD = 10
LABEL_H = 12
BG = (24, 26, 32, 255)
GRASS_BG = (96, 172, 80, 255)  # neutral grass-green backdrop behind stamps
LABEL = (235, 235, 235, 255)
HEADER = (255, 200, 80, 255)
SHEET_W = 1560


def load_tileset() -> Image.Image:
    img = Image.open(REPO_ROOT / tiles.TILESET_IMAGE).convert("RGBA")
    assert img.size == (tiles.COLS * tiles.TILE_SIZE, tiles.ROWS * tiles.TILE_SIZE)
    return img


TS = load_tileset()


def tile_img(g: int) -> Image.Image:
    row, col = rc(g)
    t = tiles.TILE_SIZE
    return TS.crop((col * t, row * t, (col + 1) * t, (row + 1) * t)).resize((TZ, TZ), Image.NEAREST)


def render_grid(gids: list[list[int]], backdrop: bool = True) -> Image.Image:
    h, w = len(gids), max(len(r) for r in gids)
    img = Image.new("RGBA", (w * TZ, h * TZ), GRASS_BG if backdrop else (60, 62, 70, 255))
    for r, row in enumerate(gids):
        for c, g in enumerate(row):
            if g:
                img.alpha_composite(tile_img(g), (c * TZ, r * TZ))
    return img


def pick(seq, i):
    return seq[i % len(seq)] if seq else 0


def blob_demo(b: Blob) -> Image.Image:
    """5x5 assembled patch + 4x4 hole demo, side by side."""
    n = 5
    patch = [[0] * n for _ in range(n)]
    patch[0][0] = b.nw
    patch[0][n - 1] = b.ne
    patch[n - 1][0] = b.sw
    patch[n - 1][n - 1] = b.se
    for c in range(1, n - 1):
        patch[0][c] = pick(b.n, c - 1)
        patch[n - 1][c] = pick(b.s, c - 1)
    for r in range(1, n - 1):
        patch[r][0] = pick(b.w, r - 1)
        patch[r][n - 1] = pick(b.e, r - 1)
    k = 0
    for r in range(1, n - 1):
        for c in range(1, n - 1):
            patch[r][c] = pick(b.fill, k)
            k += 1
    left = render_grid(patch)

    # hole demo: 4x4 of fill with inverse corners around a 2x2 hole
    hole = [[pick(b.fill, r * 4 + c) for c in range(4)] for r in range(4)]
    hole[1][1] = b.hole_nw
    hole[1][2] = b.hole_ne
    hole[2][1] = b.hole_sw
    hole[2][2] = b.hole_se
    if not (b.hole_nw or b.hole_ne):
        hole = [[0]]
    right = render_grid(hole)

    gap = TZ // 2
    out = Image.new(
        "RGBA", (left.width + gap + right.width, max(left.height, right.height)), (0, 0, 0, 0)
    )
    out.alpha_composite(left, (0, 0))
    out.alpha_composite(right, (left.width + gap, 0))
    return out


def fill_demo(fill: tuple[int, ...]) -> Image.Image:
    """Tile the fill variants into a 2-row band to check seamlessness."""
    w = max(4, (len(fill) + 1) // 2)
    grid = [[pick(fill, r * w + c) for c in range(w)] for r in range(2)]
    return render_grid(grid, backdrop=False)


def stamp_demo(s: TileStamp) -> Image.Image:
    return render_grid([list(r) for r in s.gids])


def single_demo(g: int) -> Image.Image:
    return render_grid([[g]])


def layout(entries: list[tuple[str, list[tuple[str, Image.Image]]]]) -> Image.Image:
    """entries: [(section_header, [(label, img), ...]), ...] -> one sheet."""
    rows: list[tuple[str | None, list[tuple[str, Image.Image]]]] = []
    for header, items in entries:
        cur: list[tuple[str, Image.Image]] = []
        x = PAD
        rows.append((header, []))
        for label, img in items:
            iw = max(img.width, 7 * len(label)) + PAD
            if x + iw > SHEET_W and cur:
                rows.append((None, cur))
                cur, x = [], PAD
            cur.append((label, img))
            x += iw
        if cur:
            rows.append((None, cur))
    height = PAD
    for header, items in rows:
        if header is not None:
            height += 22
        if items:
            height += max(i.height for _, i in items) + LABEL_H + PAD
    sheet = Image.new("RGBA", (SHEET_W, height + PAD), BG)
    draw = ImageDraw.Draw(sheet)
    y = PAD
    for header, items in rows:
        if header is not None:
            draw.text((PAD, y + 4), header.upper(), fill=HEADER)
            y += 22
        if not items:
            continue
        x = PAD
        row_h = max(i.height for _, i in items)
        for label, img in items:
            sheet.alpha_composite(img, (x, y))
            draw.text((x, y + row_h + 1), label, fill=LABEL)
            x += max(img.width, 7 * len(label)) + PAD
        y += row_h + LABEL_H + PAD
    return sheet


def main() -> None:
    sections: list[tuple[str, list[tuple[str, Image.Image]]]] = []

    sections.append(
        (
            "terrain blobs (patch + hole demo)",
            [(b.name, blob_demo(b)) for b in tiles.BLOBS.values()],
        )
    )
    sections.append(
        (
            "terrain fills (seamlessness check)",
            [(name, fill_demo(f)) for name, f in tiles.FILLS.items()],
        )
    )

    cliff = [list(tiles.CLIFF_GRASS["top_edge"])]
    cliff += [
        [tiles.CLIFF_GRASS["west_edge"][i]]
        + list(tiles.CLIFF_PLATEAU_FILL[4 * i : 4 * i + 4])
        + [tiles.CLIFF_GRASS["east_edge"][i]]
        for i in range(3)
    ]
    for key in ("lip", "face_upper", "face_lower", "face_base", "bottom_edge"):
        cliff.append(list(tiles.CLIFF_GRASS[key]))
    sections.append(("cliff kit (assembled)", [("cliff_grass", render_grid(cliff))]))

    def stamps(names: list[str]) -> list[tuple[str, Image.Image]]:
        return [(n, stamp_demo(tiles.STAMPS[n])) for n in names]

    sections.append(
        (
            "water / ponds / bridges",
            stamps(
                [
                    "pond_grass",
                    "pond_stone",
                    "pond_terracotta",
                    "bridge_stone",
                ]
            )
            + [("path_pad_tan", stamp_demo(tiles.STAMPS["path_pad_tan"]))],
        )
    )

    sections.append(
        (
            "trees & bushes",
            stamps(
                [
                    "tree_light",
                    "tree_dark",
                    "tree_small",
                    "tree_round_small",
                    "bush_round",
                    "tree_fruit_a",
                    "tree_fruit_b",
                    "tree_fruit_c",
                ]
            ),
        )
    )

    sections.append(
        (
            "rocks / stumps / logs",
            stamps(
                [
                    "rock_big",
                    "rock_med",
                    "rock_small",
                    "stones_small",
                    "boulder_gray_a",
                    "boulder_gray_b",
                    "boulder_purple_0",
                    "boulder_purple_1",
                    "boulder_purple_2",
                    "boulder_purple_3",
                    "stump_wide",
                    "stump_tall",
                    "log",
                    "log_large",
                    "rock_outcrop_a",
                    "rock_outcrop_b",
                ]
            ),
        )
    )

    # assembled wooden fence pen (like the example map) + metal pieces
    F = tiles.FENCE_WOOD
    pen: list[list[int]] = [[0] * 10 for _ in range(6)]

    def put(stamp: TileStamp, r0: int, c0: int) -> None:
        for r, c, g in stamp.cells():
            pen[r0 + r][c0 + c] = g

    put(F["corner_nw"], 0, 0)
    put(F["corner_ne"], 0, 8)
    put(F["corner_sw"], 4, 0)
    put(F["corner_se"], 4, 8)
    for i, c in enumerate(range(2, 8)):
        rail = F["rail_h_a"] if i % 2 == 0 else F["rail_h_b"]
        put(rail, 0, c)
        put(rail, 4, c)
    put(F["rail_v"], 2, 0)
    put(F["rail_v"], 2, 8)
    fence_items = [
        ("fence_wood pen (assembled)", render_grid(pen)),
        ("fence_posts", stamp_demo(F["post_pair"])),
    ]
    fence_items += [(f"metal {k}", stamp_demo(s)) for k, s in tiles.FENCE_METAL.items()]
    fence_items += stamps(["post_wood_a", "post_wood_b"])
    sections.append(("fences", fence_items))

    sections.append(
        (
            "facades & walls",
            stamps(
                [
                    "facade_stone_large",
                    "facade_stone_small",
                    "facade_cream",
                    "wall_timber_band",
                    "facade_brick",
                    "facade_stone_gray",
                    "wall_banded_blue",
                    "wall_banded_cream",
                ]
            )
            + [("wall_rough_fill", fill_demo(tiles.WALL_ROUGH_FILL))],
        )
    )

    sections.append(
        (
            "doors & windows",
            stamps(
                [
                    "door_wood",
                    "door_metal",
                    "doorway_dark",
                    "door_red",
                    "window_teal",
                ]
            ),
        )
    )

    sections.append(
        (
            "pads / decks / floors",
            stamps(
                [
                    "deck_light",
                    "deck_dark",
                    "stone_pad_dark",
                    "stone_floor_pad",
                    "carpet_red",
                ]
            ),
        )
    )

    sections.append(
        (
            "street & market props",
            stamps(
                [
                    "lamppost",
                    "torch_0",
                    "torch_1",
                    "torch_2",
                    "metal_grate",
                    "market_stall",
                    "sign_standing_0",
                    "sign_standing_1",
                    "sign_standing_2",
                    "sign_standing_3",
                    "sign_standing_4",
                    "sign_wall_0",
                    "sign_wall_1",
                    "sign_wall_2",
                    "sign_wall_3",
                    "sign_wall_4",
                    "sign_stall_0",
                    "sign_stall_1",
                    "sign_stall_2",
                    "sign_stall_3",
                    "sign_stall_4",
                    "bucket",
                    "crate",
                    "barrel",
                    "jug",
                    "menu_board",
                    "statue",
                    "planter_empty",
                    "planter_yellow",
                    "planter_purple",
                    "banner_red_a",
                    "banner_red_b",
                    "plate_empty",
                    "plate_bread",
                    "plate_salad",
                    "plate_berries",
                    "plate_fish",
                    "haystack",
                    "well",
                    "web_spider",
                    "web_plain",
                    "stool",
                ]
            ),
        )
    )

    sections.append(
        (
            "vegetation props & singles",
            stamps(
                [
                    "fern",
                    "snowdrop",
                    "beanpoles",
                    "flower_patch",
                ]
            )
            + [(name, single_demo(g)) for name, g in tiles.SINGLES.items()],
        )
    )

    sheet = layout(sections)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT_PATH)
    print(f"wrote {OUT_PATH} ({sheet.width}x{sheet.height})")


if __name__ == "__main__":
    main()
