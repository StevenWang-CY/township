#!/usr/bin/env python3
"""Full-fidelity preview compositor for generated .tmj town maps.

Draws every tile layer in TownScene's order, approximates anchor sprites
with registry stamps (trees, lamps, flowers) so the preview matches what the
running game will show, and can overlay faint landmark-name labels.

Outputs ``frontend/public/assets/maps/<scenario>/<town>-preview.png``
(1200x800) plus a nearest-neighbour ``<town>-preview@2x.png`` for media and
gallery use where consumers cannot force crisp pixel scaling themselves.

Run:
    python3 -m scripts.mapgen.render_preview dover [--labels]
"""

from __future__ import annotations

import argparse
import datetime
import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mapgen import moderntiles as M  # noqa: E402
from mapgen import seasons  # noqa: E402
from mapgen import tiles as R  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
MAPS_DIR = REPO_ROOT / "frontend/public/assets/maps"
PACKAGE_ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
T = 16

_raw_sheets: tuple[Image.Image, Image.Image] | None = None
_season_sheets: dict[str, tuple[Image.Image, Image.Image]] = {}
_season = "summer"


def _sheets(season: str | None = None) -> tuple[Image.Image, Image.Image]:
    """The two tile sheets remapped for ``season`` (the current one when
    omitted) — copies through ``seasons.apply_lut``; summer is the sheets
    as painted."""
    global _raw_sheets
    season = season or _season
    if _raw_sheets is None:
        _raw_sheets = (
            Image.open(REPO_ROOT / "frontend/public/assets/tilesets/rpg-tileset.png").convert(
                "RGBA"
            ),
            Image.open(REPO_ROOT / "frontend/public/assets/tilesets/township-modern.png").convert(
                "RGBA"
            ),
        )
    if season not in _season_sheets:
        _season_sheets[season] = tuple(
            seasons.apply_lut(sheet, season).copy() for sheet in _raw_sheets
        )
    return _season_sheets[season]


def scenario_season(scenario: str) -> str:
    """The season of a scenario's decision day (``dates.decision_day`` in
    its ``scenario.json``); summer when the package does not say."""
    scenarios_root = (REPO_ROOT / "scenarios").resolve()
    path = scenarios_root / _validated_id(scenario, label="scenario id") / "scenario.json"
    if path.is_symlink() or not path.resolve().is_relative_to(scenarios_root) or not path.is_file():
        return "summer"
    day = (json.loads(path.read_text()).get("dates") or {}).get("decision_day")
    try:
        return seasons.season_for(datetime.date.fromisoformat(str(day)))
    except (TypeError, ValueError):
        return "summer"


def tile_img(raw: int) -> Image.Image | None:
    base = raw & R.GID_MASK
    if base == 0:
        return None
    rpg, modern = _sheets()
    if base >= M.MODERN_FIRSTGID:
        tid = base - M.MODERN_FIRSTGID
        row, col = divmod(tid, M.MODERN_COLUMNS)
        img = modern.crop((col * T, row * T, (col + 1) * T, (row + 1) * T))
    else:
        row, col = (base - 1) // 100, (base - 1) % 100
        img = rpg.crop((col * T, row * T, (col + 1) * T, (row + 1) * T))
    if raw & R.FLIP_H:
        img = img.transpose(Image.FLIP_LEFT_RIGHT)
    if raw & R.FLIP_V:
        img = img.transpose(Image.FLIP_TOP_BOTTOM)
    return img


def draw_layer(canvas: Image.Image, layer: dict) -> None:
    w = layer["width"]
    for i, raw in enumerate(layer["data"]):
        if not raw:
            continue
        img = tile_img(raw)
        if img is not None:
            canvas.alpha_composite(img, ((i % w) * T, (i // w) * T))


def draw_stamp(canvas: Image.Image, stamp, px: float, py: float) -> None:
    """Place a stamp so its bottom-center sits at the anchor point."""
    x0 = int(px - stamp.w * T / 2)
    y0 = int(py - stamp.h * T)
    for r, c, g in stamp.cells():
        img = tile_img(g)
        if img is not None:
            canvas.alpha_composite(img, (x0 + c * T, y0 + r * T))


def _anchor_props(obj: dict) -> dict:
    return {p["name"]: p["value"] for p in obj.get("properties", [])}


_windmill_frame = None


def draw_windmill(canvas: Image.Image, px: float, py: float) -> None:
    """Frame 0 of the windmill sheet at the runtime's 0.42 scale, bottom-centred."""
    global _windmill_frame
    if _windmill_frame is None:
        sheet = Image.open(REPO_ROOT / "frontend/public/assets/spritesheets/windmill.png").convert(
            "RGBA"
        )
        frame = sheet.crop((0, 0, 208, 208))
        size = round(208 * 0.42)
        _windmill_frame = frame.resize((size, size), Image.NEAREST)
    f = _windmill_frame
    canvas.alpha_composite(f, (int(px - f.width / 2), int(py - f.height)))


def draw_smoke(canvas: Image.Image, px: float, py: float) -> None:
    """Three rising, growing dithered puffs — the at-rest look of the
    scene's pixel smoke stream."""
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    for i, size in enumerate((4, 5, 6)):
        ox = int(px - size / 2 + i * 2)
        oy = int(py - 6 - i * 8 - size)
        for yy in range(size):
            for xx in range(size):
                if (xx + yy) % 2 == 0 or i == 0:
                    layer.putpixel((ox + xx, oy + yy), (230, 227, 218, 150 - i * 35))
    canvas.alpha_composite(layer)


def draw_foam(canvas: Image.Image, px: float, py: float) -> None:
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    for dx, dy in ((-10, -2), (0, 3), (9, -4)):
        for yy in range(2):
            for xx in range(2):
                layer.putpixel((int(px + dx + xx), int(py + dy + yy)), (255, 255, 255, 150))
    canvas.alpha_composite(layer)


def _validated_id(value: str, *, label: str) -> str:
    if not isinstance(value, str) or PACKAGE_ID_RE.fullmatch(value) is None:
        raise ValueError(f"{label} must use lowercase letters, numbers, and single hyphens")
    return value


def _asset_path(scenario: str, filename: str) -> Path:
    root = MAPS_DIR.resolve()
    scenario = _validated_id(scenario, label="scenario id")
    scenario_dir = root / scenario
    if scenario_dir.is_symlink() or not scenario_dir.resolve().is_relative_to(root):
        raise ValueError("preview assets must stay inside the map directory")
    path = scenario_dir / filename
    if path.resolve().parent != scenario_dir.resolve():
        raise ValueError("preview assets must stay inside their scenario namespace")
    return path


def draw_stamp_centred(canvas: Image.Image, stamp, px: float, py: float) -> None:
    """Place a stamp so its TOP tile is centred on (px, py) — the signal
    anchor convention (the anchor marks the head tile's centre)."""
    x0 = int(px - stamp.w * T / 2)
    y0 = int(py - T / 2)
    for r, c, g in stamp.cells():
        img = tile_img(g)
        if img is not None:
            canvas.alpha_composite(img, (x0 + c * T, y0 + r * T))


def draw_roadsign_chip(canvas: Image.Image, px: float, py: float, text: str) -> None:
    """The runtime's destination chip: a small dark-green plate lettered
    with the sign text, floating above the (blank) exit sign."""
    draw = ImageDraw.Draw(canvas)
    tw = draw.textlength(text)
    x0, y0 = int(px - tw / 2) - 3, int(py - 22) - 6
    draw.rectangle((x0, y0, x0 + int(tw) + 6, y0 + 12), fill=(47, 93, 58, 235))
    draw.text((x0 + 3, y0 + 1), text, fill=(245, 234, 210, 255))


def render(
    town_id: str, scenario: str = "nj11-2026", labels: bool = False, season: str | None = None
) -> Path:
    """Composite ``<town>-preview.png`` (+ ``@2x``). ``season`` remaps both
    sheets through the seasonal LUTs; when omitted it follows the
    scenario's decision day (NJ-11's April is spring, Millbrook's November
    autumn), which is what the running game shows."""
    global _season
    town_id = _validated_id(town_id, label="town id")
    _season = season or scenario_season(scenario)
    if _season not in seasons.SEASONS:
        raise ValueError(f"unknown season {_season!r}")
    tmj_path = _asset_path(scenario, f"{town_id}.tmj")
    if tmj_path.is_symlink() or not tmj_path.is_file():
        raise ValueError("generated town map is missing or unsafe")
    tmj = json.loads(tmj_path.read_text())
    W, H = tmj["width"] * T, tmj["height"] * T
    canvas = Image.new("RGBA", (W, H), (40, 44, 40, 255))
    layers = {ly["name"]: ly for ly in tmj["layers"]}

    for name in ("ground", "ground-detail", "deco-below", "buildings-base"):
        if name in layers:
            draw_layer(canvas, layers[name])

    # anchors, y-sorted so overlaps stack like the scene's depth sort
    anchors = layers.get("anchors", {}).get("objects", [])
    for obj in sorted(anchors, key=lambda o: o["y"]):
        props = _anchor_props(obj)
        kind = props.get("kind", "")
        if kind == "tree":
            stamp = R.STAMPS.get(props.get("stamp", "tree_light"), R.TREE_LIGHT)
            draw_stamp(canvas, stamp, obj["x"], obj["y"])
        elif kind == "lamp":
            draw_stamp(canvas, R.LAMPPOST, obj["x"], obj["y"])
        elif kind == "flower":
            draw_stamp(canvas, R.FLOWER_PATCH, obj["x"], obj["y"])
        elif kind == "water-foam":
            draw_foam(canvas, obj["x"], obj["y"])
        elif kind == "smoke":
            # hearth smoke only rises at dawn/dusk in the scene; previews
            # show the always-on stacks (factory, diner griddle)
            if props.get("mode", "always") != "hearth":
                draw_smoke(canvas, obj["x"], obj["y"])
        elif kind == "windmill":
            draw_windmill(canvas, obj["x"], obj["y"])
        elif kind == "yardsign":
            draw_stamp(canvas, M.YARD_SIGN, obj["x"], obj["y"])
        elif kind == "banner":
            draw_stamp(canvas, M.BANNER_PLAIN, obj["x"], obj["y"])
        elif kind == "signal":
            # the head is a tile the runtime toggles; redraw the stamp so a
            # preview of a hand-built canvas still shows it at rest (red)
            draw_stamp_centred(canvas, M.SIGNAL, obj["x"], obj["y"])
        elif kind == "roadsign":
            draw_stamp(canvas, M.EXIT_SIGN, obj["x"], obj["y"])
        # noticeboard / pollplace / bunting / brazier: the kiosk and brazier
        # are tiles already; the polling dressing only exists on decision day.
        # spot: standing places for residents — nothing to draw

    if "buildings-top" in layers:
        draw_layer(canvas, layers["buildings-top"])

    # the runtime letters every exit sign with a pixel-font chip; the sign
    # face itself is blank, so the preview letters it the same way
    for obj in anchors:
        props = _anchor_props(obj)
        if props.get("kind") == "roadsign" and (props.get("text") or obj["name"]):
            draw_roadsign_chip(canvas, obj["x"], obj["y"], props.get("text") or obj["name"])

    if labels:
        # the layout's label anchors are authoritative (they may be nudged
        # to dodge collisions); fall back to landmark centers when a map
        # was built without a layout module and has no label anchors
        spots = [
            (o["x"], o["y"], _anchor_props(o).get("text") or o["name"])
            for o in anchors
            if _anchor_props(o).get("kind") == "label"
        ]
        if not spots:
            scenarios_root = (REPO_ROOT / "scenarios").resolve()
            town_path = scenarios_root / scenario / "towns" / f"{town_id}.json"
            if town_path.is_symlink() or not town_path.resolve().is_relative_to(scenarios_root):
                raise ValueError("town preview input must stay inside the scenarios directory")
            if town_path.exists():
                spots = [
                    (lm["x"] + lm["width"] / 2, lm["y"] + lm["height"] / 2, lm["name"])
                    for lm in json.loads(town_path.read_text()).get("landmarks", [])
                ]
        draw = ImageDraw.Draw(canvas)
        for cx, cy, text in spots:
            tw = draw.textlength(text)
            for dx, dy in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
                draw.text((cx - tw / 2 + dx, cy + dy), text, fill=(20, 20, 20, 160))
            draw.text((cx - tw / 2, cy), text, fill=(255, 250, 235, 210))

    out1 = _asset_path(scenario, f"{town_id}-preview.png")
    out1.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out1)
    print(f"wrote {out1}")
    out2 = _asset_path(scenario, f"{town_id}-preview@2x.png")
    canvas.resize((W * 2, H * 2), Image.NEAREST).save(out2)
    print(f"wrote {out2}")
    return out1


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("town")
    ap.add_argument("--scenario", default="nj11-2026")
    ap.add_argument("--labels", action="store_true")
    ap.add_argument(
        "--season",
        choices=seasons.SEASONS,
        help="palette season (default: the scenario's decision day)",
    )
    args = ap.parse_args()
    render(args.town, scenario=args.scenario, labels=args.labels, season=args.season)


if __name__ == "__main__":
    main()
