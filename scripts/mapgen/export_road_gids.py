#!/usr/bin/env python3
"""Export walkable-surface GIDs to JSON for the frontend nav grid.

``TownScene`` builds an A* navigation grid over each town's collision layer.
Residents are not forced onto roads, but the grid weights sidewalks, tan
paths and plazas cheapest, crosswalks (zebra stripes and the rails' level
crossings) nearly as cheap, asphalt very high — so walkers keep to the
sidewalk and cross a street only at a crosswalk instead of jaywalking
wherever the straight line happens to fall — grass dearer than pavement,
and rail ballast dearest, so people use the level crossings instead of
cutting across the tracks. Formation slots and wander targets also avoid
standing in the road.

The registry constants in ``tiles.py`` / ``moderntiles.py`` are the single
source of truth — this script serializes which GIDs are *sidewalk*,
*crosswalk*, *road*, *rough* and *grass* so the frontend never hardcodes a
GID. ``WORN`` (trodden dirt) counts as sidewalk: a desire line is exactly
where people already walk. ``GRASS_DARK`` is exported as the ``grass``
class so the nav grid can keep pricing a lawn like grass even though its
tiles sit on ``ground-detail`` (anything unlisted is grass by default; the
explicit class exists for consumers that resolve a tile's kind by GID).

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
    sidewalk: set[int] = set()
    for blob in (M.SIDEWALK, R.PATH_TAN, R.COBBLE_PAD, M.WORN):
        sidewalk |= blob_gids(blob)
    sidewalk.update(R.COBBLE_FILL)
    sidewalk.update(R.PLAZA_COBBLE_FILL)

    # Darker lawn grass painted on ground-detail: walkable exactly like the
    # base grass, listed so GID-keyed consumers can tell it from pavement.
    grass: set[int] = blob_gids(M.GRASS_DARK)

    # The sanctioned places to step onto asphalt: zebra stripes at junctions
    # and the rails' level crossings. These are deliberately NOT in ``road``
    # so the nav grid can price them like pavement while asphalt stays dear.
    crosswalk: set[int] = {M.mg(name) for name in ("crosswalk_h", "crosswalk_v", "rail_x")}

    road: set[int] = blob_gids(M.ASPHALT)
    # Road markings and street furniture baked onto asphalt tiles.
    for name in ("dash_h", "dash_v", "parking_stall", "storm_drain"):
        road.add(M.mg(name))

    rough: set[int] = blob_gids(R.GRAVEL)
    rough.add(M.mg("rail_h"))

    payload = {
        "_generated": "scripts/mapgen/export_road_gids.py — do not edit",
        "tileSize": R.TILE_SIZE,
        # Walkable kinds the nav grid distinguishes: sidewalk/path (preferred;
        # includes WORN desire lines), crosswalk (the cheap way across a
        # street or the tracks), road (priced high so residents cross only at
        # crosswalks and never linger on it), rough (rail ballast;
        # discouraged), grass (the GRASS_DARK lawn autotile — same price as
        # the base grass). Everything else is grass.
        "sidewalk": sorted(sidewalk),
        "crosswalk": sorted(crosswalk - sidewalk),
        "road": sorted(road - sidewalk - crosswalk),
        "rough": sorted(rough - sidewalk - crosswalk - road),
        "grass": sorted(grass - sidewalk - crosswalk - road - rough),
    }
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    print(
        f"wrote {OUT.relative_to(REPO_ROOT)}: {len(payload['sidewalk'])} sidewalk, "
        f"{len(payload['crosswalk'])} crosswalk, {len(payload['road'])} road, "
        f"{len(payload['rough'])} rough, {len(payload['grass'])} grass gids"
    )


if __name__ == "__main__":
    main()
