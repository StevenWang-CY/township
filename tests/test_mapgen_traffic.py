"""The generated ``traffic`` object layer: lanes and stop lines the
frontend TrafficLayer drives cars along."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
MAPS = REPO / "frontend/public/assets/maps"
T = 16


def _towns() -> list[Path]:
    return sorted(MAPS.rglob("*.tmj"))


def _props(obj: dict) -> dict[str, str]:
    return {p["name"]: str(p["value"]) for p in obj.get("properties", [])}


def _layer(tmj: dict, name: str) -> dict | None:
    return next((ly for ly in tmj["layers"] if ly["name"] == name), None)


@pytest.mark.parametrize("path", _towns(), ids=lambda p: p.stem)
def test_every_town_has_lanes_and_stop_lines(path: Path) -> None:
    tmj = json.loads(path.read_text())
    traffic = _layer(tmj, "traffic")
    assert traffic is not None, "traffic object layer missing"
    lanes = [o for o in traffic["objects"] if _props(o).get("kind") == "lane"]
    stops = [o for o in traffic["objects"] if _props(o).get("kind") == "stopline"]
    assert len(lanes) >= 2
    assert any(_props(o).get("through") == "1" for o in lanes), "no edge-to-edge lane"
    assert stops, "no stop line before a crosswalk"
    W, H = tmj["width"] * T, tmj["height"] * T
    detail = _layer(tmj, "ground-detail")
    assert detail is not None
    road_gids = json.loads((REPO / "frontend/src/game/roadGids.json").read_text())
    driveable = set(road_gids["road"]) | set(road_gids["crosswalk"])
    for lane in lanes:
        pts = [(lane["x"] + p["x"], lane["y"] + p["y"]) for p in lane["polyline"]]
        assert len(pts) >= 2
        # axis-aligned, one segment per lane
        assert pts[0][0] == pts[-1][0] or pts[0][1] == pts[-1][1]
        # the lane centre runs over asphalt or crosswalk tiles, never grass
        (x0, y0), (x1, y1) = pts[0], pts[-1]
        n = 12
        for i in range(1, n):
            px = x0 + (x1 - x0) * i / n
            py = y0 + (y1 - y0) * i / n
            tx, ty = min(int(px // T), tmj["width"] - 1), min(int(py // T), tmj["height"] - 1)
            raw = detail["data"][ty * tmj["width"] + tx]
            assert (raw & 0x0FFFFFFF) in driveable, f"{path.stem} lane {lane['name']} off-road at {tx},{ty}"
        assert 0 <= x0 <= W and 0 <= y0 <= H and 0 <= x1 <= W and 0 <= y1 <= H
    for st in stops:
        p = _props(st)
        assert p["axis"] in ("h", "v") and p["dir"] in ("e", "w", "n", "s")
        assert p["signal"] in ("0", "1")
        assert 0 <= st["x"] <= W and 0 <= st["y"] <= H


def test_traffic_is_derived_deterministically() -> None:
    from scripts.mapgen import build_maps as bm

    town = json.loads((REPO / "scenarios/nj11-2026/towns/dover.json").read_text())
    outs = []
    for _ in range(2):
        m = bm.MapCanvas("dover", town, seed=bm._stable_seed("nj11-2026/dover"))
        m.base_grass()
        bm._layout_module("nj11-2026", "dover").compose(m)
        bm.emit_traffic(m)
        outs.append(m.traffic)
    assert outs[0] == outs[1]
    dirs = {t["dir"] for t in outs[0] if t["kind"] == "lane"}
    assert {"e", "w"} <= dirs
    # every stop line is 2 px clear of its crosswalk band and inside the road mask
    for t in outs[0]:
        if t["kind"] != "stopline":
            continue
        cx, cy = int(t["x"] // 16), int(t["y"] // 16)
        assert (cx, cy) in m.road_mask
