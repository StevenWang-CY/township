#!/usr/bin/env python3
"""Full-fidelity preview compositor for generated .tmj town maps.

Draws every tile layer in TownScene's order, approximates anchor sprites
with registry stamps (trees, lamps, flowers) so the preview matches what the
running game will show, and can overlay faint landmark-name labels.

Outputs ``frontend/public/assets/maps/<scenario>/<town>-preview.png`` (1200x800). The
source is pixel art, so an upscaled duplicate adds repository and deployment
weight without adding detail; consumers can scale this file losslessly.

Run:
    python3 -m scripts.mapgen.render_preview dover [--labels]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mapgen import moderntiles as M  # noqa: E402
from mapgen import tiles as R  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
MAPS_DIR = REPO_ROOT / "frontend/public/assets/maps"
PACKAGE_ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
T = 16

_rpg = None
_modern = None


def _sheets():
    global _rpg, _modern
    if _rpg is None:
        _rpg = Image.open(REPO_ROOT / "frontend/public/assets/tilesets/rpg-tileset.png").convert(
            "RGBA"
        )
        _modern = Image.open(
            REPO_ROOT / "frontend/public/assets/tilesets/township-modern.png"
        ).convert("RGBA")
    return _rpg, _modern


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


def render(town_id: str, scenario: str = "nj11-2026", labels: bool = False) -> Path:
    town_id = _validated_id(town_id, label="town id")
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
            pass  # shimmer only exists in-scene
        elif kind == "smoke":
            pass
        elif kind == "windmill":
            draw_stamp(canvas, R.POST_WOOD_A, obj["x"], obj["y"])

    if "buildings-top" in layers:
        draw_layer(canvas, layers["buildings-top"])

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
    return out1


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("town")
    ap.add_argument("--scenario", default="nj11-2026")
    ap.add_argument("--labels", action="store_true")
    args = ap.parse_args()
    render(args.town, scenario=args.scenario, labels=args.labels)


if __name__ == "__main__":
    main()
