"""The District Atlas assets keep their contract for every shipped scenario.

``overworld-sites.json`` is v2 with a pad rect and a walk loop per town, the
overworld PNGs are the panel's native size, every pad on the composed canvas
holds real buildings, and every town has a crisp, non-blank postcard whose
``POSTCARD`` crop lies inside its map.
"""

from __future__ import annotations

import importlib
import json
from pathlib import Path

import pytest
from conftest import REPO_ROOT
from PIL import Image

from scripts.mapgen import overworld, render_postcards

SCENARIOS = Path(REPO_ROOT) / "scenarios"
MAPS = Path(REPO_ROOT) / "frontend/public/assets/maps"
SHIPPED = sorted(
    scenario.name
    for scenario in SCENARIOS.iterdir()
    if (scenario / "towns").is_dir() and (MAPS / scenario.name / "overworld-sites.json").is_file()
)
TOWNS = sorted(
    (scenario, town.stem)
    for scenario in SHIPPED
    for town in (SCENARIOS / scenario / "towns").glob("*.json")
)
T = overworld.T


def _sites(scenario: str) -> dict:
    return json.loads((MAPS / scenario / "overworld-sites.json").read_text(encoding="utf-8"))


def _town_ids(scenario: str) -> set[str]:
    return {p.stem for p in (SCENARIOS / scenario / "towns").glob("*.json")}


@pytest.fixture(scope="module")
def composed() -> dict[str, overworld.Overworld]:
    """The composed canvases (no files written) — one per shipped scenario."""
    return {scenario: overworld.compose_overworld(scenario) for scenario in SHIPPED}


@pytest.mark.parametrize("scenario", SHIPPED)
def test_sites_document_is_v2_with_a_pad_and_walk_per_town(scenario):
    doc = _sites(scenario)
    assert doc["version"] == 2
    assert doc["image"]["width"] == overworld.OUT_W == 960
    assert doc["image"]["height"] == overworld.OUT_H == 608
    by_id = {site["id"]: site for site in doc["sites"]}
    assert set(by_id) == _town_ids(scenario)
    for site in doc["sites"]:
        assert site["town_id"] == site["id"]  # the field the frontend read before v2
        assert isinstance(site["name"], str) and site["name"]
        pad = site["pad"]
        assert set(pad) == {"x", "y", "w", "h"}
        assert pad["w"] > 0 and pad["h"] > 0
        assert 0 <= pad["x"] and pad["x"] + pad["w"] <= overworld.OW_W
        assert 0 <= pad["y"] and pad["y"] + pad["h"] <= overworld.OW_H
        # the centre point the hover card anchors on lies inside the pad
        assert pad["x"] * T <= site["x"] <= (pad["x"] + pad["w"]) * T
        assert pad["y"] * T <= site["y"] <= (pad["y"] + pad["h"]) * T
        walk = site["walk"]
        assert len(walk) >= 4 and walk[0] == walk[-1], "walk is a closed loop"
        x0, y0 = (pad["x"] - 1) * T, (pad["y"] - 1) * T
        x1, y1 = (pad["x"] + pad["w"] + 1) * T, (pad["y"] + pad["h"] + 1) * T
        for px, py in walk:
            assert x0 <= px <= x1 and y0 <= py <= y1, f"{site['id']} walk point {px, py} off pad"


@pytest.mark.parametrize("scenario", SHIPPED)
def test_pads_do_not_overlap_and_hold_buildings(scenario, composed):
    o = composed[scenario]
    doc = _sites(scenario)
    rects = {site["id"]: site["pad"] for site in doc["sites"]}
    ids = sorted(rects)
    for i, a in enumerate(ids):
        ra = rects[a]
        for b in ids[i + 1 :]:
            rb = rects[b]
            apart = (
                ra["x"] + ra["w"] <= rb["x"]
                or rb["x"] + rb["w"] <= ra["x"]
                or ra["y"] + ra["h"] <= rb["y"]
                or rb["y"] + rb["h"] <= ra["y"]
            )
            assert apart, f"pads {a} and {b} overlap"
    base = o.m.layers["buildings-base"]
    for tid, pad in rects.items():
        assert o.pads[tid].as_dict() == pad, "composed pad matches the shipped document"
        cells = [
            base[yy][xx]
            for yy in range(pad["y"], pad["y"] + pad["h"])
            for xx in range(pad["x"], pad["x"] + pad["w"])
        ]
        assert any(cells), f"pad {tid} has no buildings-base tile"
        street = o.m.layers["ground-detail"]
        rows = o.pads[tid].street_rows
        assert any(street[rows[0]][xx] for xx in range(pad["x"], pad["x"] + pad["w"]))


@pytest.mark.parametrize("scenario", SHIPPED)
def test_overworld_pngs_are_native_panel_size(scenario):
    with Image.open(MAPS / scenario / "overworld.png") as im:
        assert im.size == (960, 608)
    with Image.open(MAPS / scenario / "overworld@2x.png") as im:
        assert im.size == (1920, 1216)
    with Image.open(MAPS / scenario / "overworld-clouds.png") as im:
        assert im.size == (960, 608)


def _quadrant_colours(im: Image.Image) -> list[int]:
    w, h = im.size
    counts = []
    for box in (
        (0, 0, w // 2, h // 2),
        (w // 2, 0, w, h // 2),
        (0, h // 2, w // 2, h),
        (w // 2, h // 2, w, h),
    ):
        colours = im.crop(box).getcolors(maxcolors=1 << 16)
        counts.append(len(colours or []))
    return counts


@pytest.mark.parametrize(("scenario", "town"), TOWNS)
def test_every_town_has_a_crisp_postcard(scenario, town):
    card = MAPS / scenario / f"{town}-postcard.png"
    card2x = MAPS / scenario / f"{town}-postcard@2x.png"
    assert card.is_file() and card2x.is_file()
    with Image.open(card) as im:
        assert im.size == (224, 144)
        quadrants = _quadrant_colours(im.convert("RGB"))
    assert all(n >= 3 for n in quadrants), f"{town} postcard has a blank quadrant: {quadrants}"
    with Image.open(card2x) as im:
        assert im.size == (448, 288)


@pytest.mark.parametrize(("scenario", "town"), TOWNS)
def test_postcard_crop_lies_inside_the_map(scenario, town):
    module_name = f"scripts.mapgen.layouts.{scenario.replace('-', '_')}.{town.replace('-', '_')}"
    layout = importlib.import_module(module_name)
    tx, ty = layout.POSTCARD
    tmj = json.loads((MAPS / scenario / f"{town}.tmj").read_text(encoding="utf-8"))
    assert 0 <= tx and tx + render_postcards.CARD_W <= tmj["width"]
    assert 0 <= ty and ty + render_postcards.CARD_H <= tmj["height"]
    assert render_postcards.crop_origin(scenario, town, tmj["width"], tmj["height"]) == (tx, ty)


def test_unknown_towns_get_a_generic_pad_inside_the_canvas():
    geo = overworld._generic_geography(
        "harbor-bridge", {"north-quay": "North Quay", "south-quay": "South Quay"}
    )
    assert set(geo["pads"]) == {"north-quay", "south-quay"}
    for x, y in geo["pads"].values():
        assert 0 <= x and x + overworld.PAD_W <= overworld.OW_W
        assert 0 <= y and y + overworld.PAD_H <= overworld.OW_H
    assert geo["paths"], "the generic layout chains its towns with a road"
