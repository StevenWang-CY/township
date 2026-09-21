"""Every shipped town map carries the election's furniture.

The generator derives civic anchors from scenario data (``role``,
dwellings, parks) instead of hand placement; this guards that each
packaged town still gets a polling place, a notice board, yard signs and
facade banners after a layout edit, and that the exported stamp/window
metadata points at real tiles.
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

import pytest

from conftest import REPO_ROOT
from scripts.mapgen import build_maps, moderntiles

SCENARIOS = Path(REPO_ROOT) / "scenarios"
TOWNS = sorted(
    (scenario.name, town.stem)
    for scenario in SCENARIOS.iterdir()
    if (scenario / "towns").is_dir()
    for town in (scenario / "towns").glob("*.json")
)


def _anchor_kinds(tmj_path: Path) -> Counter:
    document = json.loads(tmj_path.read_text(encoding="utf-8"))
    anchors = next(layer for layer in document["layers"] if layer["name"] == "anchors")
    kinds: Counter = Counter()
    for obj in anchors["objects"]:
        props = {p["name"]: p["value"] for p in obj.get("properties", [])}
        kinds[props.get("kind")] += 1
    return kinds


@pytest.mark.parametrize(("scenario", "town"), TOWNS)
def test_every_shipped_town_gets_civic_anchors(tmp_path, scenario, town):
    output = build_maps.build_town(scenario, town, tmp_path / "maps")
    kinds = _anchor_kinds(output)
    assert kinds["pollplace"] == 1, f"{scenario}/{town}: expected one polling place, got {kinds}"
    assert kinds["banner"] == 2, f"{scenario}/{town}: expected two facade banners"
    assert kinds["bunting"] == 1
    assert kinds["noticeboard"] >= 1, f"{scenario}/{town}: no notice board"
    assert kinds["yardsign"] >= 1, f"{scenario}/{town}: no yard signs"


def test_yard_signs_land_on_grass_with_a_stable_seat(tmp_path):
    output = build_maps.build_town("nj11-2026", "dover", tmp_path / "maps")
    document = json.loads(output.read_text(encoding="utf-8"))
    layers = {layer["name"]: layer for layer in document["layers"]}
    width = document["width"]
    detail = layers["ground-detail"]["data"]
    deco = layers["deco-below"]["data"]
    lawn = build_maps._grass_gids()
    seats = []
    for obj in layers["anchors"]["objects"]:
        props = {p["name"]: p["value"] for p in obj.get("properties", [])}
        if props.get("kind") != "yardsign":
            continue
        seats.append(int(props["seat"]))
        # anchor is the sprite's bottom-centre: the tile it stands on
        tx = int(obj["x"] // 16)
        ty = int(obj["y"] // 16) - 1
        idx = ty * width + tx
        assert deco[idx] == 0, "yard sign placed over a prop"
        assert detail[idx] == 0 or detail[idx] in lawn, "yard sign not on grass"
    assert seats == sorted(seats) and len(set(seats)) == len(seats)


def test_exported_metadata_points_at_real_tiles():
    stamps = json.loads((Path(REPO_ROOT) / "frontend/src/game/stampDefs.json").read_text())
    windows = json.loads((Path(REPO_ROOT) / "frontend/src/game/windowGids.json").read_text())
    modern_max = moderntiles.MODERN_FIRSTGID + moderntiles.MODERN_TILECOUNT
    for name, stamp in stamps["stamps"].items():
        for row in stamp["gids"]:
            for gid in row:
                assert gid == 0 or 0 < gid < modern_max, f"{name}: gid {gid} out of range"
        assert len(stamp["gids"]) == stamp["h"] and all(len(r) == stamp["w"] for r in stamp["gids"])
    for name, gid in stamps["singles"].items():
        assert moderntiles.MODERN_FIRSTGID <= gid < modern_max, f"{name}: {gid}"
    names = {w["name"] for w in windows["windows"]}
    assert {"window_shutter", "win_small", "ch_cw_lancet", "diner_win_m"} <= names
