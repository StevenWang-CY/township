#!/usr/bin/env python3
"""Tileset inspection tool for the vendored a16z ai-town RPG tileset.

Maintenance tool for the Township map-generation pipeline. It produces the
visual + statistical artifacts used to build and verify the named GID registry
in ``scripts/mapgen/tiles.py``.

Tileset geometry
----------------
``frontend/public/assets/tilesets/rpg-tileset.png`` is 1600x1600 px,
16px tiles, 100 columns x 100 rows = 10,000 tiles.

    GID = row * 100 + col + 1        (Tiled firstgid = 1)

Tiled layer data may carry flip flags in the top 3 bits of a GID; mask with
``0x0FFFFFFF`` to get the base GID.

Usage
-----
Generate the standard artifacts (contact sheets + usage.json + coverage.json)::

    python3 scripts/mapgen/inspect_tiles.py

Render a zoomed crop of a tile region for close inspection::

    python3 scripts/mapgen/inspect_tiles.py --crop ROW0 ROW1 COL0 COL1 \
        [--zoom N] [--out NAME.png]

Rows/cols are inclusive, 0-based. Output goes to ``scripts/mapgen/_inspect/``.

Artifacts
---------
- ``rows_00-09.png`` ... ``rows_90-99.png``: contact sheets, 10 tileset rows
  each. Every tile is drawn at 3x zoom over a checkerboard (so transparent /
  empty cells are obvious) with its GID printed beneath it. Each tileset row
  is split into two strips of 50 columns.
- ``usage.json``: for each layer of the generated town map
  ``frontend/public/assets/maps/nj11-2026/dover.tmj``, the set of base GIDs used
  (flip flags masked) with usage counts, plus flip-flag statistics. GIDs
  >= 10001 belong to the appended ``township-modern`` tileset (10 columns).
- ``coverage.json``: per-row count of non-empty tiles in the tileset, so
  empty/garbage GID ranges can be identified without eyeballing blank sheets.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw

REPO_ROOT = Path(__file__).resolve().parents[2]
TILESET_PATH = REPO_ROOT / "frontend/public/assets/tilesets/rpg-tileset.png"
TILEMAP_PATH = REPO_ROOT / "frontend/public/assets/maps/nj11-2026/dover.tmj"
OUT_DIR = Path(__file__).resolve().parent / "_inspect"

TILE = 16
COLS = 100
ROWS = 100
GID_MASK = 0x0FFFFFFF
FLIP_H = 0x80000000
FLIP_V = 0x40000000
FLIP_D = 0x20000000

CHECKER_A = (235, 235, 235, 255)
CHECKER_B = (204, 204, 204, 255)
BG = (24, 26, 32, 255)
LABEL = (230, 230, 230, 255)
HEADER = (255, 200, 80, 255)


def load_tileset() -> Image.Image:
    img = Image.open(TILESET_PATH).convert("RGBA")
    assert img.size == (COLS * TILE, ROWS * TILE), f"unexpected tileset size {img.size}"
    return img


def tile_image(ts: Image.Image, row: int, col: int) -> Image.Image:
    x, y = col * TILE, row * TILE
    return ts.crop((x, y, x + TILE, y + TILE))


def checkerboard(size: int, cell: int = 8) -> Image.Image:
    board = Image.new("RGBA", (size, size), CHECKER_A)
    d = ImageDraw.Draw(board)
    for yy in range(0, size, cell):
        for xx in range(0, size, cell):
            if (xx // cell + yy // cell) % 2:
                d.rectangle([xx, yy, xx + cell - 1, yy + cell - 1], fill=CHECKER_B)
    return board


def tile_nonempty(t: Image.Image) -> bool:
    alpha = t.getchannel("A")
    return alpha.getbbox() is not None


def render_contact_sheet(
    ts: Image.Image, row0: int, row1: int, zoom: int = 3, cols_per_strip: int = 50
) -> Image.Image:
    """Render tileset rows [row0, row1] (inclusive), each row as strips."""
    tz = TILE * zoom
    label_h = 12
    strip_h = tz + label_h + 3
    strips_per_row = (COLS + cols_per_strip - 1) // cols_per_strip
    header_h = 14
    row_h = header_h + strips_per_row * strip_h + 6
    pad = 8
    width = pad * 2 + cols_per_strip * (tz + 1)
    height = pad * 2 + (row1 - row0 + 1) * row_h

    sheet = Image.new("RGBA", (width, height), BG)
    draw = ImageDraw.Draw(sheet)
    board = checkerboard(tz)

    y = pad
    for row in range(row0, row1 + 1):
        draw.text((pad, y), f"row {row}   (gids {row * COLS + 1}-{(row + 1) * COLS})", fill=HEADER)
        y += header_h
        for s in range(strips_per_row):
            c0 = s * cols_per_strip
            c1 = min(COLS, c0 + cols_per_strip)
            for col in range(c0, c1):
                x = pad + (col - c0) * (tz + 1)
                sheet.paste(board, (x, y))
                t = tile_image(ts, row, col).resize((tz, tz), Image.NEAREST)
                sheet.alpha_composite(t, (x, y))
                gid = row * COLS + col + 1
                draw.text((x + 1, y + tz + 1), str(gid), fill=LABEL)
            y += strip_h
        y += 6
    return sheet


def render_crop(
    ts: Image.Image, row0: int, row1: int, col0: int, col1: int, zoom: int = 8
) -> Image.Image:
    """Zoomed crop of an inclusive tile-rect, GID labels beneath each tile."""
    tz = TILE * zoom
    label_h = 12
    pad = 8
    ncols = col1 - col0 + 1
    nrows = row1 - row0 + 1
    width = pad * 2 + ncols * (tz + 1)
    height = pad * 2 + nrows * (tz + label_h + 3)
    sheet = Image.new("RGBA", (width, height), BG)
    draw = ImageDraw.Draw(sheet)
    board = checkerboard(tz)
    for r in range(nrows):
        for c in range(ncols):
            x = pad + c * (tz + 1)
            y = pad + r * (tz + label_h + 3)
            sheet.paste(board, (x, y))
            t = tile_image(ts, row0 + r, col0 + c).resize((tz, tz), Image.NEAREST)
            sheet.alpha_composite(t, (x, y))
            gid = (row0 + r) * COLS + (col0 + c) + 1
            draw.text((x + 1, y + tz + 1), str(gid), fill=LABEL)
    return sheet


def analyze_usage() -> dict:
    with open(TILEMAP_PATH) as f:
        tmap = json.load(f)
    out: dict = {
        "map": str(TILEMAP_PATH.relative_to(REPO_ROOT)),
        "width": tmap["width"],
        "height": tmap["height"],
        "layers": {},
    }
    for layer in tmap["layers"]:
        if layer.get("type") != "tilelayer":
            continue
        counts: dict[int, int] = {}
        flips = {"h": 0, "v": 0, "d": 0}
        for raw in layer["data"]:
            if raw == 0:
                continue
            base = raw & GID_MASK
            counts[base] = counts.get(base, 0) + 1
            if raw & FLIP_H:
                flips["h"] += 1
            if raw & FLIP_V:
                flips["v"] += 1
            if raw & FLIP_D:
                flips["d"] += 1
        gids = sorted(counts)

        def where(g: int) -> list:
            # GIDs >= 10001 live in the appended township-modern sheet
            # (10 columns); everything below is the 100-column rpg tileset.
            if g >= 10001:
                local = g - 10001
                return ["township-modern", local // 10, local % 10]
            return ["rpg-tileset", (g - 1) // COLS, (g - 1) % COLS]

        out["layers"][layer["name"]] = {
            "distinct_base_gids": len(gids),
            "flip_flag_counts": flips,
            "gid_counts": {str(g): counts[g] for g in gids},
            "gid_tileset_row_col": {str(g): where(g) for g in gids},
        }
    return out


def analyze_coverage(ts: Image.Image) -> dict:
    per_row = []
    for row in range(ROWS):
        n = sum(1 for col in range(COLS) if tile_nonempty(tile_image(ts, row, col)))
        per_row.append(n)
    empty_rows = [r for r, n in enumerate(per_row) if n == 0]
    return {
        "nonempty_tiles_per_row": per_row,
        "total_nonempty": sum(per_row),
        "fully_empty_rows": empty_rows,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument(
        "--crop",
        nargs=4,
        type=int,
        metavar=("ROW0", "ROW1", "COL0", "COL1"),
        help="render a zoomed crop of an inclusive tile-rect instead of full sheets",
    )
    ap.add_argument(
        "--zoom", type=int, default=None, help="zoom factor (default: 3 sheets, 8 crops)"
    )
    ap.add_argument("--out", type=str, default=None, help="output filename for --crop")
    args = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ts = load_tileset()

    if args.crop:
        r0, r1, c0, c1 = args.crop
        img = render_crop(ts, r0, r1, c0, c1, zoom=args.zoom or 8)
        name = args.out or f"crop_r{r0}-{r1}_c{c0}-{c1}.png"
        img.save(OUT_DIR / name)
        print(f"wrote {OUT_DIR / name} ({img.width}x{img.height})")
        return

    zoom = args.zoom or 3
    for band in range(0, ROWS, 10):
        sheet = render_contact_sheet(ts, band, band + 9, zoom=zoom)
        name = f"rows_{band:02d}-{band + 9:02d}.png"
        sheet.save(OUT_DIR / name)
        print(f"wrote {OUT_DIR / name} ({sheet.width}x{sheet.height})")

    usage = analyze_usage()
    with open(OUT_DIR / "usage.json", "w") as f:
        json.dump(usage, f, indent=2)
    print(f"wrote {OUT_DIR / 'usage.json'}")

    coverage = analyze_coverage(ts)
    with open(OUT_DIR / "coverage.json", "w") as f:
        json.dump(coverage, f, indent=2)
    print(f"wrote {OUT_DIR / 'coverage.json'}")
    print("fully empty rows:", coverage["fully_empty_rows"])
    nz = [(r, n) for r, n in enumerate(coverage["nonempty_tiles_per_row"]) if n]
    print("rows with content:", nz)


if __name__ == "__main__":
    main()
