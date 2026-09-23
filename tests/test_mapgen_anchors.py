"""Every shipped town map carries the election's furniture and the crowd's
standing spots.

The generator derives civic anchors from scenario data (``role``,
dwellings, parks) instead of hand placement; this guards that each
packaged town still gets a polling place, a notice board, yard signs and
facade banners after a layout edit, that every landmark a persona's
routine visits has authored ``spot`` anchors to stand on, and that the
exported stamp/window/road metadata points at real tiles.
"""

from __future__ import annotations

import json
import math
from collections import Counter, defaultdict
from pathlib import Path

import pytest
from conftest import REPO_ROOT

from backend.core.scenario import load_scenario
from scripts.mapgen import build_maps, moderntiles

SCENARIOS = Path(REPO_ROOT) / "scenarios"
TOWNS = sorted(
    (scenario.name, town.stem)
    for scenario in SCENARIOS.iterdir()
    if (scenario / "towns").is_dir()
    for town in (scenario / "towns").glob("*.json")
)
TILE = build_maps.T


def _anchor_kinds(tmj_path: Path) -> Counter:
    document = json.loads(tmj_path.read_text(encoding="utf-8"))
    anchors = next(layer for layer in document["layers"] if layer["name"] == "anchors")
    kinds: Counter = Counter()
    for obj in anchors["objects"]:
        props = {p["name"]: p["value"] for p in obj.get("properties", [])}
        kinds[props.get("kind")] += 1
    return kinds


def _canvas(scenario: str, town: str) -> build_maps.MapCanvas:
    """The generator's canvas for a town, composed the way ``build_town``
    does it, so tests can ask about streets, reserved cells and fronts."""
    town_json = json.loads((SCENARIOS / scenario / "towns" / f"{town}.json").read_text())
    canvas = build_maps.MapCanvas(
        town, town_json, seed=build_maps._stable_seed(f"{scenario}/{town}")
    )
    canvas.base_grass()
    module = build_maps._layout_module(scenario, town)
    if module is not None and hasattr(module, "compose"):
        module.compose(canvas)
    else:
        build_maps.interpret_landmarks(canvas)
    build_maps.emit_civic_anchors(canvas)
    build_maps.emit_spot_anchors(canvas)
    return canvas


@pytest.fixture(scope="module")
def built_maps(tmp_path_factory) -> dict[tuple[str, str], dict]:
    """Every shipped town, built once through ``build_town``: the parsed TMJ."""
    out_dir = tmp_path_factory.mktemp("maps")
    built = {}
    for scenario, town in TOWNS:
        path = build_maps.build_town(scenario, town, out_dir)
        built[(scenario, town)] = json.loads(path.read_text(encoding="utf-8"))
    return built


@pytest.fixture(scope="module")
def canvases() -> dict[tuple[str, str], build_maps.MapCanvas]:
    return {(scenario, town): _canvas(scenario, town) for scenario, town in TOWNS}


def _layers(document: dict) -> dict[str, dict]:
    return {layer["name"]: layer for layer in document["layers"]}


def _spots(document: dict) -> list[dict]:
    """Spot anchors as flat dicts: name, x, y (px) plus their properties."""
    out = []
    for obj in _layers(document)["anchors"]["objects"]:
        props = {p["name"]: p["value"] for p in obj.get("properties", [])}
        if props.get("kind") == "spot":
            out.append({"name": obj["name"], "x": obj["x"], "y": obj["y"], **props})
    return out


def _spot_tile(spot: dict) -> tuple[int, int]:
    """The tile under a spot's feet pixel (bottom-centre convention)."""
    return int(spot["x"] // TILE), int(round(spot["y"] / TILE)) - 1


def _landmarks(scenario: str, town: str) -> list[dict]:
    return json.loads((SCENARIOS / scenario / "towns" / f"{town}.json").read_text())["landmarks"]


def _polling_name(landmarks: list[dict]) -> str:
    flagged = [lm for lm in landmarks if str(lm.get("role", "")).lower() == "polling_place"]
    return flagged[0]["name"] if flagged else ""


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


def test_road_gids_export_separates_crosswalks_from_asphalt():
    """The nav grid prices asphalt very high and crosswalks like pavement,
    so the crosswalk class must exist and never overlap the other classes."""
    payload = json.loads((Path(REPO_ROOT) / "frontend/src/game/roadGids.json").read_text())
    classes = {k: set(payload[k]) for k in ("sidewalk", "crosswalk", "road", "rough")}
    assert classes["crosswalk"], "no crosswalk gids exported"
    assert {
        moderntiles.mg("crosswalk_h"),
        moderntiles.mg("crosswalk_v"),
        moderntiles.mg("rail_x"),
    } <= classes["crosswalk"]
    for other in ("sidewalk", "road", "rough"):
        assert not (classes["crosswalk"] & classes[other]), f"crosswalk gids leak into {other}"
    assert moderntiles.mg("asphalt_0") in classes["road"]


# ── standing spots ────────────────────────────────────────────────


@pytest.mark.parametrize(("scenario", "town"), TOWNS)
def test_every_routine_destination_has_a_spot(built_maps, scenario, town):
    """Every landmark a resident's routine sends them to must have at least
    one spot to stand on — in their own town, or (millbrook-budget commutes
    across the river) in another town of the same scenario."""
    package = load_scenario(SCENARIOS / scenario)
    spots_by_town = {
        t: {s["name"] for s in _spots(built_maps[(scenario, t)])} for t in package.towns
    }
    misses = []
    for defn in package.agents.get(town, []):
        for entry in defn.routine:
            location = entry.get("location") if isinstance(entry, dict) else None
            if not location:
                continue
            # "<town-id>: <landmark>" is a commute (Community I): the stop lives
            # in the other town's map.
            host, _, landmark = location.partition(": ")
            if landmark and host in spots_by_town:
                found = landmark in spots_by_town[host]
            else:
                found = any(location in names for names in spots_by_town.values())
            if not found:
                misses.append(f"{defn.name} @ {location!r}")
    assert not misses, f"{scenario}/{town}: routine destinations without a spot:\n  " + "\n  ".join(
        misses
    )


@pytest.mark.parametrize(("scenario", "town"), TOWNS)
def test_every_landmark_gets_a_chat_pair(built_maps, scenario, town):
    spots = _spots(built_maps[(scenario, town)])
    pairs: dict[str, dict[str, dict]] = defaultdict(dict)
    for s in spots:
        if s["role"] == "chat":
            assert s["side"] in ("a", "b") and s["pair"].startswith(s["name"] + "#")
            pairs[s["pair"]][s["side"]] = s
    for pair_id, sides in pairs.items():
        assert set(sides) == {"a", "b"}, f"{pair_id} is missing a side"
        assert sides["a"]["facing"] == sides["b"]["facing"] == "face"
        dist = math.hypot(sides["a"]["x"] - sides["b"]["x"], sides["a"]["y"] - sides["b"]["y"])
        assert dist == 2 * TILE, f"{pair_id}: pair is {dist}px apart, not {2 * TILE}"
    paired = {sides["a"]["name"] for sides in pairs.values()}
    for lm in _landmarks(scenario, town):
        if lm.get("type") != "road":
            assert lm["name"] in paired, f"{scenario}/{town}: {lm['name']!r} has no chat pair"


@pytest.mark.parametrize(("scenario", "town"), TOWNS)
def test_spots_stand_on_open_ground(built_maps, canvases, scenario, town):
    """No spot on a street, in a reserved cell or inside a collision rect,
    none on a prop or building tile — the runtime trusts these cells to be
    standable. Off-street asphalt (a parking lot an office fronts onto) is
    allowed only for the doorstep roles."""
    document = built_maps[(scenario, town)]
    canvas = canvases[(scenario, town)]
    layers = _layers(document)
    width = document["width"]
    rects = [(o["x"], o["y"], o["width"], o["height"]) for o in layers["collision"]["objects"]]
    for spot in _spots(document):
        tx, ty = _spot_tile(spot)
        assert 0 <= tx < width and 0 <= ty < document["height"], f"{spot} is off the map"
        # feet pixel straddles two tiles when x is a half-tile: check both
        tiles = {(tx, ty), (int((spot["x"] - 1) // TILE), ty)}
        for cx, cy in tiles:
            label = f"{spot['name']} {spot['role']} spot at tile ({cx}, {cy})"
            assert not canvas.on_street(cx, cy), f"{label} is on a street"
            assert (cx, cy) not in canvas.reserved, f"{label} is on a reserved cell"
            if (cx, cy) in canvas.road_mask:
                assert spot["role"] in ("door", "porch", "chat", "window"), f"{label} is on asphalt"
            idx = cy * width + cx
            for layer in ("deco-below", "buildings-base", "buildings-top"):
                assert layers[layer]["data"][idx] == 0, f"{label} is on a {layer} tile"
            px, py = (cx + 0.5) * TILE, (cy + 0.5) * TILE
            assert not any(rx <= px < rx + rw and ry <= py < ry + rh for rx, ry, rw, rh in rects), (
                f"{label} is inside a collision rect"
            )


@pytest.mark.parametrize(("scenario", "town"), TOWNS)
def test_spot_properties_are_strings_with_unique_order(built_maps, scenario, town):
    spots = _spots(built_maps[(scenario, town)])
    assert spots, f"{scenario}/{town}: no spots at all"
    orders: dict[str, list[int]] = defaultdict(list)
    for s in spots:
        for key in ("kind", "role", "facing", "cap", "order"):
            assert isinstance(s[key], str), f"{key} is not a string on {s}"
        assert s["cap"] == "1"
        assert s["facing"] in ("up", "down", "left", "right", "face")
        orders[s["name"]].append(int(s["order"]))
    for name, seen in orders.items():
        assert len(seen) == len(set(seen)), f"{name}: duplicate spot order"
        assert sorted(seen) == list(range(len(seen))), f"{name}: order is not 0..n-1"


@pytest.mark.parametrize(("scenario", "town"), TOWNS)
def test_polling_place_queue_parks_and_doors(built_maps, canvases, scenario, town):
    document = built_maps[(scenario, town)]
    spots = _spots(document)
    by_role: dict[str, list[dict]] = defaultdict(list)
    for s in spots:
        by_role[s["role"]].append(s)
    landmarks = _landmarks(scenario, town)

    polling = _polling_name(landmarks)
    queue = [s for s in by_role["queue"] if s["name"] == polling]
    assert len(queue) >= 3, f"{scenario}/{town}: {polling!r} has {len(queue)} queue spots"
    assert sorted(int(s["order"]) for s in queue) == list(range(len(queue)))
    assert all(s["facing"] == "up" for s in queue)

    for lm in landmarks:
        if lm.get("type") == "park":
            lawn = [s for s in by_role["lawn"] if s["name"] == lm["name"]]
            assert len(lawn) >= 4, (
                f"{scenario}/{town}: park {lm['name']!r} has {len(lawn)} lawn spots"
            )
            tiles = [_spot_tile(s) for s in lawn]
            for i, a in enumerate(tiles):
                for b in tiles[i + 1 :]:
                    assert math.dist(a, b) >= 2, f"{lm['name']}: lawn spots {a} and {b} too close"

    # one door spot per registered building front
    fronts = sum(len(v) for v in canvases[(scenario, town)].fronts.values())
    assert len(by_role["door"]) == fronts, (
        f"{scenario}/{town}: {len(by_role['door'])} door spots for {fronts} registered fronts"
    )
    assert all(s["facing"] == "up" for s in by_role["door"])


@pytest.mark.parametrize(("scenario", "town"), TOWNS)
def test_every_long_street_has_a_painted_crossing(canvases, scenario, town):
    """The nav grid prices asphalt so high that a street without a zebra
    forces a 500 px detour or a jaywalk. Every street a full block or more
    long (16 tiles) carries at least one crossing band."""
    canvas = canvases[(scenario, town)]
    band_cells = {cell for _j, _side, band in canvas.crosswalk_bands() for cell in band}
    for seg in canvas.road_segs:
        if seg.a1 - seg.a0 + 1 < 16:
            continue
        if seg.orient == "h":
            cells = {(a, seg.c + k) for a in range(seg.a0, seg.a1 + 1) for k in range(seg.width)}
        else:
            cells = {(seg.c + k, a) for a in range(seg.a0, seg.a1 + 1) for k in range(seg.width)}
        assert cells & band_cells, f"{town}: no crossing on the {seg.orient}-road at {seg.c}"


def test_a_side_street_ending_flush_against_a_main_road_is_a_junction():
    """A T where the side street's first row abuts the main road's last row
    (no overlap) still gets its three zebras; a corner-to-corner touch gets
    none; a mid-block zebra lands on the segment and lists both approaches."""
    m = build_maps.MapCanvas("t", {"name": "T"}, seed=1, w=40, h=40)
    m.road_h(10, 0, 39, width=3)
    m.road_v(20, 13, 30, width=3)  # abuts the main road from the south
    m.road_v(5, 0, 8, width=2)  # stops one row short: a corner touch only
    assert (20, 10, 22, 12) in m._junctions()
    bands = m.crosswalk_bands()
    sides = {side for j, side, _cells in bands if j == (20, 10, 22, 12)}
    assert sides == {"w", "e", "s"}
    assert not [b for b in bands if b[0][0] == 5]
    m.crosswalk("h", 10, 32)
    mid = [(side, cells) for j, side, cells in m.crosswalk_bands() if j == (32, 10, 32, 12)]
    assert {side for side, _ in mid} == {"w", "e"}
    assert all(cells == [(32, 10), (32, 11), (32, 12)] for _, cells in mid)
    with pytest.raises(ValueError):
        m.crosswalk("h", 10, 45)
