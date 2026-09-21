#!/usr/bin/env python3
"""Export walkable-surface GIDs to JSON for the frontend nav grid.

``TownScene`` builds an A* navigation grid over each town's collision layer.
Residents are not forced onto roads, but the grid weights paved ground
(asphalt, sidewalk, tan paths, cobble pads and plazas) cheaper than grass so
walkers naturally prefer the sidewalk and use level crossings instead of
cutting across the rail ballast.

The registry constants in ``tiles.py`` / ``moderntiles.py`` are the single
source of truth — this script serializes which GIDs count as *paved*
(cost 1.0) and which as *rough* (ballast; discouraged) so the frontend never
hardcodes a GID.

Output: ``frontend/src/game/roadGids.json``

Run:  python3 scripts/mapgen/export_road_gids.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mapgen import moderntiles as M  # noqa: E402
from mapgen import tiles as R  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT = REPO_ROOT / "frontend/src/game/roadGids.json"


def blob_gids(blob: R.Blob) -> set[int]:
    """Every GID a blob can paint INSIDE its patch (fringes overlap the
    neighbouring terrain, so they are deliberately excluded)."""
    out: set[int] = set(blob.fill)
    for value in blob.edge_tiles().values():
        if isinstance(value, int):
            if value:
                out.add(value)
        else:
            out.update(g for g in value if g)
    return out


def main() -> None:
    paved: set[int] = set()
    for blob in (M.ASPHALT, M.SIDEWALK, R.PATH_TAN, R.COBBLE_PAD):
        paved |= blob_gids(blob)
    paved.update(R.COBBLE_FILL)
    paved.update(R.PLAZA_COBBLE_FILL)
    # Road markings and street furniture baked onto asphalt/sidewalk tiles.
    for name in (
        "crosswalk_h",
        "crosswalk_v",
        "dash_h",
        "dash_v",
        "parking_stall",
        "storm_drain",
        "rail_x",
    ):
        paved.add(M.mg(name))

    rough: set[int] = blob_gids(R.GRAVEL)
    rough.add(M.mg("rail_h"))

    payload = {
        "_generated": "scripts/mapgen/export_road_gids.py — do not edit",
        "tileSize": R.TILE_SIZE,
        "paved": sorted(paved),
        "rough": sorted(rough - paved),
    }
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    print(
        f"wrote {OUT.relative_to(REPO_ROOT)}: {len(payload['paved'])} paved, {len(payload['rough'])} rough gids"
    )


if __name__ == "__main__":
    main()
