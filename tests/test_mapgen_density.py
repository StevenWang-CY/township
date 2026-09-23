"""Map II density pass: every shipped town reads as a finished pixel place.

Guards the layout contract the density pass introduced: buildings cover at
least 14% of the map, lots hold parked vehicles, every road that leaves the
map has a destination sign and a clear gap through the woods ring, the
ring itself leaves no bare grass on the map's rim, nothing but road tiles
sits on a street, traffic-signal anchors point at signal tiles the runtime
can toggle, rebuilds are byte-identical to the shipped maps, and the
previews exist at 1200x800 (+ @2x) in the scenario's season.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from conftest import REPO_ROOT
from PIL import Image

from scripts.mapgen import build_maps, render_preview
from scripts.mapgen import moderntiles as M
from scripts.mapgen import tiles as R

ROOT = Path(REPO_ROOT)
MAPS = ROOT / "frontend/public/assets/maps"
SCENARIOS = ROOT / "scenarios"
TOWNS = sorted(
    (scenario.name, town.stem)
    for scenario in SCENARIOS.iterdir()
    if (scenario / "towns").is_dir()
    for town in (scenario / "towns").glob("*.json")
)
T = build_maps.T
BAND = build_maps._RING_BAND
MIN_BUILDING_COVERAGE = 0.14
MIN_VEHICLES = 4


def _tmj(scenario: str, town: str) -> dict:
    return json.loads((MAPS / scenario / f"{town}.tmj").read_text(encoding="utf-8"))


def _layers(doc: dict) -> dict[str, dict]:
    return {layer["name"]: layer for layer in doc["layers"]}


def _props(obj: dict) -> dict[str, str]:
    return {p["name"]: str(p["value"]) for p in obj.get("properties", [])}


def _anchors(doc: dict, kind: str) -> list[dict]:
    return [
        {"name": o["name"], "x": o["x"], "y": o["y"], **_props(o)}
        for o in _layers(doc)["anchors"]["objects"]
        if _props(o).get("kind") == kind
    ]


def _gid(doc: dict, layer: str, x: int, y: int) -> int:
    return _layers(doc)[layer]["data"][y * doc["width"] + x] & R.GID_MASK


def _canvas(scenario: str, town: str) -> build_maps.MapCanvas:
    """The layout's canvas (composition only), for street / reserved
    geometry and the exit gaps the ring pass computed."""
    town_json = json.loads((SCENARIOS / scenario / "towns" / f"{town}.json").read_text())
    canvas = build_maps.MapCanvas(
        town, town_json, seed=build_maps._stable_seed(f"{scenario}/{town}")
    )
    canvas.base_grass()
    build_maps._layout_module(scenario, town).compose(canvas)
    canvas.flush_markings()
    return canvas


@pytest.fixture(scope="module")
def docs() -> dict[tuple[str, str], dict]:
    return {(scenario, town): _tmj(scenario, town) for scenario, town in TOWNS}


@pytest.fixture(scope="module")
def canvases() -> dict[tuple[str, str], build_maps.MapCanvas]:
    return {(scenario, town): _canvas(scenario, town) for scenario, town in TOWNS}


@pytest.mark.parametrize(("scenario", "town"), TOWNS)
def test_buildings_cover_at_least_14_percent(docs, scenario, town):
    doc = docs[(scenario, town)]
    base = _layers(doc)["buildings-base"]["data"]
    cells = doc["width"] * doc["height"]
    coverage = sum(1 for g in base if g) / cells
    assert coverage >= MIN_BUILDING_COVERAGE, (
        f"{scenario}/{town}: buildings-base covers {coverage:.1%} of the map"
    )


@pytest.mark.parametrize(("scenario", "town"), TOWNS)
def test_at_least_four_parked_vehicles(docs, scenario, town):
    """Vehicles are counted by their lead tile (the first gid of each
    vehicle stamp in ``stampDefs.json``), one per parked vehicle, whatever
    way it faces."""
    stamps = json.loads((ROOT / "frontend/src/game/stampDefs.json").read_text())["stamps"]
    lead = {
        s["gids"][0][0]
        for name, s in stamps.items()
        if name.startswith(("car_", "pickup_", "bus_", "schoolbus_"))
    }
    assert lead, "no vehicle stamps exported"
    doc = docs[(scenario, town)]
    deco = _layers(doc)["deco-below"]["data"]
    parked = sum(1 for g in deco if (g & R.GID_MASK) in lead)
    assert parked >= MIN_VEHICLES, f"{scenario}/{town}: only {parked} parked vehicles"


@pytest.mark.parametrize(("scenario", "town"), TOWNS)
def test_every_exit_is_declared_signed_and_clear(docs, canvases, scenario, town):
    """Every road leaving the map is in the layout's ``EXITS``, carries a
    ``roadsign`` anchor with its text near the edge, and its gap through
    the ring holds no ring tree."""
    doc = docs[(scenario, town)]
    canvas = canvases[(scenario, town)]
    module = build_maps._layout_module(scenario, town)
    exits = list(module.EXITS)
    declared = {(side, c) for side, c, _text in exits}
    for side in ("n", "s", "e", "w"):
        for start, _width in build_maps._edge_road_runs(canvas, side):
            assert (side, start) in declared, f"{scenario}/{town}: undeclared exit {side}:{start}"
    signs = _anchors(doc, "roadsign")
    trees = {(int(a["x"] // T), int(a["y"] // T) - 1) for a in _anchors(doc, "tree")}
    for side, c, text in exits:
        _width, gap = build_maps._exit_gap(canvas, side, c)
        assert gap <= canvas.exit_gaps
        assert not (gap & trees), f"{scenario}/{town}: ring trees inside the {side}:{c} gap"
        gx = sum(x for x, _ in gap) / len(gap)
        gy = sum(y for _, y in gap) / len(gap)
        near = [
            s
            for s in signs
            if s.get("text") == text and abs(s["x"] / T - gx) <= 8 and abs(s["y"] / T - gy) <= 8
        ]
        assert near, f"{scenario}/{town}: no {text!r} sign at the {side}:{c} exit"
        for s in near:
            sx, sy = int(s["x"] // T), int(s["y"] // T) - 1
            assert _gid(doc, "deco-below", sx, sy) == M.mg("exit_sign_b"), "sign post missing"
            assert _gid(doc, "buildings-top", sx, sy - 1) == M.mg("exit_sign_t"), (
                "sign face missing"
            )


@pytest.mark.parametrize(("scenario", "town"), TOWNS)
def test_edge_band_has_no_bare_grass(docs, canvases, scenario, town):
    """The outer two cells are woods: outside the exit gaps, streets, lots,
    rails and water, every band cell carries ground dressing or a prop."""
    doc = docs[(scenario, town)]
    canvas = canvases[(scenario, town)]
    layers = _layers(doc)
    w, h = doc["width"], doc["height"]
    bare = []
    for y in range(h):
        for x in range(w):
            if not (x < BAND or y < BAND or x >= w - BAND or y >= h - BAND):
                continue
            c = (x, y)
            if c in canvas.exit_gaps or c in canvas.road_mask or c in canvas.reserved:
                continue
            idx = y * w + x
            if not (
                layers["ground-detail"]["data"][idx]
                or layers["deco-below"]["data"][idx]
                or layers["buildings-base"]["data"][idx]
            ):
                bare.append(c)
    assert not bare, f"{scenario}/{town}: bare grass on the map's rim at {bare[:8]}"


@pytest.mark.parametrize(("scenario", "town"), TOWNS)
def test_streets_carry_only_road_tiles(docs, canvases, scenario, town):
    """A street cell holds asphalt / a marking / a crosswalk on
    ground-detail and nothing on the prop or building layers — no car,
    hedge, shadow, wire or signal head ever lands on the roadway."""
    doc = docs[(scenario, town)]
    canvas = canvases[(scenario, town)]
    layers = _layers(doc)
    road_gids = json.loads((ROOT / "frontend/src/game/roadGids.json").read_text())
    allowed = set(road_gids["road"]) | set(road_gids["crosswalk"])
    w = doc["width"]
    for y in range(doc["height"]):
        for x in range(w):
            if not canvas.on_street(x, y):
                continue
            idx = y * w + x
            g = layers["ground-detail"]["data"][idx] & R.GID_MASK
            assert g in allowed, f"{scenario}/{town}: non-road tile {g} on the street at {(x, y)}"
            for layer in ("deco-below", "buildings-base", "buildings-top"):
                assert layers[layer]["data"][idx] == 0, (
                    f"{scenario}/{town}: {layer} tile on the street at {(x, y)}"
                )


@pytest.mark.parametrize(("scenario", "town"), TOWNS)
def test_signal_anchors_sit_on_signal_heads(docs, scenario, town):
    """A ``signal`` anchor marks the centre of a head tile the runtime
    toggles between red and green; its ``axis`` names the traffic it
    governs, and the junction's stop lines are signal-controlled."""
    doc = docs[(scenario, town)]
    heads = {M.mg("signal_red"), M.mg("signal_green")}
    signals = _anchors(doc, "signal")
    for s in signals:
        assert s["axis"] in ("h", "v")
        tx, ty = int(s["x"] // T), int(s["y"] // T)
        found = [
            layer
            for layer in ("deco-below", "buildings-top", "ground-detail")
            if _gid(doc, layer, tx, ty) in heads
        ]
        assert found, f"{scenario}/{town}: signal anchor at {(tx, ty)} has no head tile"
    stops = [
        _props(o) for o in _layers(doc)["traffic"]["objects"] if _props(o).get("kind") == "stopline"
    ]
    if signals:
        assert any(p["signal"] == "1" for p in stops), (
            "signals placed but no stop line is signalled"
        )
    else:
        assert all(p["signal"] == "0" for p in stops), "signalled stop line without a signal"


def test_rebuild_is_deterministic_and_matches_the_shipped_maps(tmp_path):
    for scenario, town in TOWNS:
        first = build_maps.build_town(scenario, town, tmp_path / "a").read_bytes()
        second = build_maps.build_town(scenario, town, tmp_path / "b").read_bytes()
        assert first == second, f"{scenario}/{town}: two builds differ"
        shipped = (MAPS / scenario / f"{town}.tmj").read_bytes()
        assert first == shipped, f"{scenario}/{town}: shipped map is stale — run make maps"


@pytest.mark.parametrize(("scenario", "town"), TOWNS)
def test_previews_exist_at_full_size(scenario, town):
    with Image.open(MAPS / scenario / f"{town}-preview.png") as im:
        assert im.size == (1200, 800)
    with Image.open(MAPS / scenario / f"{town}-preview@2x.png") as im:
        assert im.size == (2400, 1600)


def test_preview_season_follows_the_decision_day():
    assert render_preview.scenario_season("nj11-2026") == "spring"
    assert render_preview.scenario_season("millbrook-budget") == "autumn"
