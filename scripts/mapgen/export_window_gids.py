#!/usr/bin/env python3
"""Export window-tile GIDs to JSON for the frontend's night-glow pass.

TownScene scans each town's ``buildings-base`` layer for these GIDs and
places warm additive glow quads over every match that fade in at dusk.

The registry constants in ``tiles.py`` / ``moderntiles.py`` are the single
source of truth — this script just serializes the window stamps' top-left
GIDs (with their tile spans) so the frontend never hardcodes a GID.

Output: ``frontend/src/game/windowGids.json``

Run:  python3 scripts/mapgen/export_window_gids.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mapgen import moderntiles as M  # noqa: E402
from mapgen import tiles as R  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT = REPO_ROOT / "frontend/src/game/windowGids.json"


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


def main() -> None:
    # Pane rectangles are in pixels relative to each 2x2 stamp. Keeping this
    # geometry beside the registry export prevents the runtime from washing
    # warm light over the dark frame/sill (the two source windows have very
    # different glass silhouettes).
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
    ]
    payload = {
        "_generated": "scripts/mapgen/export_window_gids.py — do not edit",
        "tileSize": R.TILE_SIZE,
        "windows": windows,
    }
    OUT.write_text(json.dumps(payload, indent=2) + "\n")
    print(
        f"wrote {OUT.relative_to(REPO_ROOT)}: "
        + ", ".join(f"{q['name']}@{q['topLeftGid']}" for q in windows)
    )


if __name__ == "__main__":
    main()
