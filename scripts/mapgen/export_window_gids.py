#!/usr/bin/env python3
"""Export window-tile GIDs and prop stamp definitions to JSON for the frontend.

Two files, both generated from the registry constants in ``tiles.py`` /
``moderntiles.py`` (the single source of truth) so the frontend never
hardcodes a GID:

* ``frontend/src/game/windowGids.json`` — every window stamp's top-left GID
  with the pixel rectangles of its glass panes. ``TownScene`` scans each
  town's ``buildings-base`` layer for these GIDs and places warm additive
  glow quads over the glass that fade in at dusk. Exporting the cottage
  shutter windows, the church lancets, the diner's glass band and the small
  shop window here is what turns dusk into a town-wide ignition.
* ``frontend/src/game/stampDefs.json`` — multi-tile prop stamps (trees,
  lamppost, flowers, the civic kit, the vehicles / street / suburb kits and
  the set-pieces of ``township-modern`` rows 17-29) as GID grids, plus
  single-tile props, so ``SceneAmbience`` / ``CivicLayer`` can blit
  textures from either tileset without a hand-maintained mirror of the
  registry.
* ``frontend/src/game/seasons.json`` — the seasonal exact-colour LUTs of
  ``scripts/mapgen/seasons.py`` (``{"seasons": {name: [[from, to], ...]},
  "byMonth": [...]}``) so the frontend can remap both sheets at runtime.

Run:  python3 scripts/mapgen/export_window_gids.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mapgen import moderntiles as M  # noqa: E402
from mapgen import seasons  # noqa: E402
from mapgen import tiles as R  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT = REPO_ROOT / "frontend/src/game/windowGids.json"
OUT_STAMPS = REPO_ROOT / "frontend/src/game/stampDefs.json"
OUT_SEASONS = REPO_ROOT / "frontend/src/game/seasons.json"


def _quad(stamp, panes: list[dict[str, int]]) -> dict:
    max_w = stamp.w * R.TILE_SIZE
    max_h = stamp.h * R.TILE_SIZE
    for pane in panes:
        if (
            pane["w"] <= 0
            or pane["h"] <= 0
            or pane["x"] < 0
            or pane["y"] < 0
            or pane["x"] + pane["w"] > max_w
            or pane["y"] + pane["h"] > max_h
        ):
            raise ValueError(f"pane {pane!r} falls outside {stamp.name} ({max_w}x{max_h})")
    return {
        "name": stamp.name,
        "topLeftGid": stamp.gids[0][0],
        "w": stamp.w,
        "h": stamp.h,
        "panes": panes,
    }


def _stamp_entry(stamp) -> dict:
    return {"w": stamp.w, "h": stamp.h, "gids": [list(row) for row in stamp.gids]}


def main() -> None:
    # Pane rectangles are in pixels relative to each stamp. Keeping this
    # geometry beside the registry export prevents the runtime from washing
    # warm light over the dark frame/sill (every source window has its own
    # glass silhouette).
    windows = [
        _quad(
            M.WINDOW,
            [
                {"x": 3, "y": 3, "w": 10, "h": 26},
                {"x": 19, "y": 3, "w": 10, "h": 26},
            ],
        ),
        _quad(
            R.WINDOW_TEAL,
            [
                {"x": 6, "y": 4, "w": 8, "h": 5},
                {"x": 19, "y": 4, "w": 8, "h": 5},
            ],
        ),
        # Colonial shutter window: the sash between the two shutters.
        _quad(M.SHUTTER_WINDOW, [{"x": 10, "y": 4, "w": 12, "h": 21}]),
        # Small 1x1 shop window.
        _quad(M.SMALL_WINDOW, [{"x": 3, "y": 3, "w": 10, "h": 9}]),
        # Church lancets (both wall variants share the glass silhouette).
        *[_quad(st, [{"x": 5, "y": 3, "w": 6, "h": 23}]) for st in M.CH_LANCET.values()],
        # Diner glass band: one pane per tile.
        *[_quad(st, [{"x": 1, "y": 3, "w": 14, "h": 9}]) for st in M.DINER_WINDOWS],
    ]
    payload = {
        "_generated": "scripts/mapgen/export_window_gids.py — do not edit",
        "tileSize": R.TILE_SIZE,
        "windows": windows,
    }
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    print(
        f"wrote {OUT.relative_to(REPO_ROOT)}: "
        + ", ".join(f"{q['name']}@{q['topLeftGid']}" for q in windows)
    )

    stamps = {
        "tree_light": R.TREE_LIGHT,
        "tree_dark": R.TREE_DARK,
        "tree_small": R.TREE_SMALL,
        "tree_round_small": R.TREE_ROUND_SMALL,
        "tree_fruit_a": R.TREE_FRUIT_A,
        "tree_fruit_b": R.TREE_FRUIT_B,
        "tree_fruit_c": R.TREE_FRUIT_C,
        "lamppost": R.LAMPPOST,
        "flower_patch": R.FLOWER_PATCH,
        "yard_sign": M.YARD_SIGN,
        "vote_sign": M.VOTE_SIGN,
        "notice_board": M.NOTICE_BOARD,
        "banner_plain": M.BANNER_PLAIN,
        # rows 17-29: vehicles, hedge pieces, street / suburb kits, set-pieces
        **M.KIT_STAMPS,
    }
    singles = {
        n: M.mg(n)
        for n in (
            "bench_h",
            "newsbox",
            "yard_post",
            "yard_board",
            "vote_board",
            "ballot_box",
            "stanchion",
            "rope_h",
            "bunting_h",
            "chimney",
            "brazier",
            # rows 17-29
            "sh_full",
            "sh_fade_n",
            "sh_fade_w",
            "sh_corner",
            "clover_a",
            "clover_b",
            "litter_a",
            "litter_b",
            "mulch_a",
            "mulch_b",
            "wire_h",
            "wire_v",
            "steps",
            "house_num",
            "ac_window",
            "bike_a",
            "bike_b",
            "bike_rack",
        )
    }
    stamp_payload = {
        "_generated": "scripts/mapgen/export_window_gids.py — do not edit",
        "tileSize": R.TILE_SIZE,
        "sheets": {
            "rpg-tileset": {"firstgid": 1, "columns": 100},
            "township-modern": {"firstgid": M.MODERN_FIRSTGID, "columns": M.MODERN_COLUMNS},
        },
        "stamps": {name: _stamp_entry(stamp) for name, stamp in stamps.items()},
        "singles": singles,
    }
    OUT_STAMPS.write_text(json.dumps(stamp_payload, indent=2, ensure_ascii=False) + "\n")
    print(
        f"wrote {OUT_STAMPS.relative_to(REPO_ROOT)}: {len(stamps)} stamps, {len(singles)} singles"
    )

    seasons.write_json(OUT_SEASONS)
    print(
        f"wrote {OUT_SEASONS.relative_to(REPO_ROOT)}: "
        + ", ".join(f"{name} x{len(lut)}" for name, lut in seasons.LUTS.items())
    )


if __name__ == "__main__":
    main()
