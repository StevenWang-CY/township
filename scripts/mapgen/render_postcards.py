#!/usr/bin/env python3
"""Postcards: a crisp 14x9-tile crop of every town's set-piece.

Each hand-tuned layout module exports ``POSTCARD = (tx, ty)`` — the
top-left TILE of the crop that frames the town's memorable corner (the
station, the museum garden, the lake bridge, the diner, the crossing, the
mill ruins). This renders that window from the generated ``.tmj`` exactly
the way the preview compositor draws the whole map — ground, ground-detail,
deco-below, buildings-base, the tree / lamp anchors y-sorted, then
buildings-top — and writes, next to the previews:

- ``<town>-postcard.png``      224x144 (@1x)
- ``<town>-postcard@2x.png``   448x288, nearest-neighbour

Towns without a layout module (or without ``POSTCARD``) get a crop centred
on the map, so every town card and hover card still has a picture.

Run:
    python3 scripts/mapgen/render_postcards.py --scenario nj11-2026 --town dover
    python3 scripts/mapgen/render_postcards.py --all
"""

from __future__ import annotations

import argparse
import importlib
import json
import re
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mapgen import moderntiles as M  # noqa: E402
from mapgen import tiles as R  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
MAPS_DIR = REPO_ROOT / "frontend/public/assets/maps"
PACKAGE_ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
T = 16
#: postcard window in tiles / pixels
CARD_W, CARD_H = 14, 9
CARD_PX = (CARD_W * T, CARD_H * T)

_sheets: tuple[Image.Image, Image.Image] | None = None


def _load_sheets() -> tuple[Image.Image, Image.Image]:
    global _sheets
    if _sheets is None:
        rpg = Image.open(REPO_ROOT / "frontend/public/assets/tilesets/rpg-tileset.png")
        modern = Image.open(REPO_ROOT / "frontend/public/assets/tilesets/township-modern.png")
        _sheets = (rpg.convert("RGBA"), modern.convert("RGBA"))
    return _sheets


def tile_img(raw: int) -> Image.Image | None:
    """The 16x16 RGBA image of a raw layer value (flip flags honoured)."""
    base = raw & R.GID_MASK
    if base == 0:
        return None
    rpg, modern = _load_sheets()
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


def _validated_id(value: str, *, label: str) -> str:
    if not isinstance(value, str) or PACKAGE_ID_RE.fullmatch(value) is None:
        raise ValueError(f"{label} must use lowercase letters, numbers, and single hyphens")
    return value


def _asset_path(scenario: str, filename: str) -> Path:
    root = MAPS_DIR.resolve()
    scenario_dir = root / _validated_id(scenario, label="scenario id")
    if scenario_dir.is_symlink() or not scenario_dir.resolve().is_relative_to(root):
        raise ValueError("postcard assets must stay inside the map directory")
    path = scenario_dir / filename
    if path.resolve().parent != scenario_dir.resolve():
        raise ValueError("postcard assets must stay inside their scenario namespace")
    return path


def postcard_origin(scenario: str, town_id: str) -> tuple[int, int] | None:
    """``POSTCARD`` from the town's layout module, or None."""
    scenario_module = _validated_id(scenario, label="scenario id").replace("-", "_")
    town_module = _validated_id(town_id, label="town id").replace("-", "_")
    layout_file = Path(__file__).parent / "layouts" / scenario_module / f"{town_module}.py"
    if not layout_file.is_file():
        return None
    module = importlib.import_module(f"mapgen.layouts.{scenario_module}.{town_module}")
    origin = getattr(module, "POSTCARD", None)
    if origin is None:
        return None
    tx, ty = origin
    return int(tx), int(ty)


def crop_origin(scenario: str, town_id: str, map_w: int, map_h: int) -> tuple[int, int]:
    """The crop's top-left tile, clamped so the window stays on the map."""
    origin = postcard_origin(scenario, town_id)
    if origin is None:
        origin = ((map_w - CARD_W) // 2, (map_h - CARD_H) // 2)
    tx = max(0, min(map_w - CARD_W, origin[0]))
    ty = max(0, min(map_h - CARD_H, origin[1]))
    return tx, ty


def _anchor_props(obj: dict) -> dict:
    return {p["name"]: p["value"] for p in obj.get("properties", [])}


class _Window:
    """Composites only the tiles that touch the crop window."""

    def __init__(self, tx: int, ty: int) -> None:
        self.x0, self.y0 = tx * T, ty * T
        self.img = Image.new("RGBA", CARD_PX, (40, 44, 40, 255))

    def blit(self, tile: Image.Image | None, px: int, py: int) -> None:
        if tile is None:
            return
        rx, ry = px - self.x0, py - self.y0
        if -T < rx < CARD_PX[0] and -T < ry < CARD_PX[1]:
            self.img.alpha_composite(tile, (max(rx, 0), max(ry, 0)), (max(-rx, 0), max(-ry, 0)))

    def layer(self, layer: dict) -> None:
        w = layer["width"]
        for i, raw in enumerate(layer["data"]):
            if not raw:
                continue
            px, py = (i % w) * T, (i // w) * T
            if self.x0 - T < px < self.x0 + CARD_PX[0] and self.y0 - T < py < self.y0 + CARD_PX[1]:
                self.blit(tile_img(raw), px, py)

    def stamp(self, stamp, px: float, py: float) -> None:
        """A registry stamp with its bottom-centre at the anchor point."""
        sx = int(px - stamp.w * T / 2)
        sy = int(py - stamp.h * T)
        for r, c, g in stamp.cells():
            self.blit(tile_img(g), sx + c * T, sy + r * T)


def render(town_id: str, scenario: str = "nj11-2026") -> Path:
    town_id = _validated_id(town_id, label="town id")
    tmj_path = _asset_path(scenario, f"{town_id}.tmj")
    if tmj_path.is_symlink() or not tmj_path.is_file():
        raise ValueError("generated town map is missing or unsafe")
    tmj = json.loads(tmj_path.read_text())
    tx, ty = crop_origin(scenario, town_id, tmj["width"], tmj["height"])
    layers = {ly["name"]: ly for ly in tmj["layers"]}
    win = _Window(tx, ty)

    for name in ("ground", "ground-detail", "deco-below", "buildings-base"):
        if name in layers:
            win.layer(layers[name])

    # anchors, y-sorted so overlaps stack like the scene's depth sort
    anchors = layers.get("anchors", {}).get("objects", [])
    for obj in sorted(anchors, key=lambda o: o["y"]):
        props = _anchor_props(obj)
        kind = props.get("kind", "")
        if kind == "tree":
            win.stamp(
                R.STAMPS.get(props.get("stamp", "tree_light"), R.TREE_LIGHT), obj["x"], obj["y"]
            )
        elif kind == "lamp":
            win.stamp(R.LAMPPOST, obj["x"], obj["y"])
        elif kind == "flower":
            win.stamp(R.FLOWER_PATCH, obj["x"], obj["y"])
        elif kind == "yardsign":
            win.stamp(M.YARD_SIGN, obj["x"], obj["y"])
        elif kind == "banner":
            win.stamp(M.BANNER_PLAIN, obj["x"], obj["y"])

    if "buildings-top" in layers:
        win.layer(layers["buildings-top"])

    out1 = _asset_path(scenario, f"{town_id}-postcard.png")
    out1.parent.mkdir(parents=True, exist_ok=True)
    card = win.img.convert("RGB")
    card.save(out1)
    card.resize((CARD_PX[0] * 2, CARD_PX[1] * 2), Image.NEAREST).save(
        _asset_path(scenario, f"{town_id}-postcard@2x.png")
    )
    print(f"wrote {out1} (tiles {tx},{ty})")
    return out1


def _towns(scenario: str) -> list[str]:
    towns_dir = REPO_ROOT / "scenarios" / _validated_id(scenario, label="scenario id") / "towns"
    return [p.stem for p in sorted(towns_dir.glob("*.json")) if not p.is_symlink()]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--scenario", default="nj11-2026")
    ap.add_argument("--town")
    ap.add_argument("--all", action="store_true", help="every town of every scenario package")
    args = ap.parse_args()
    try:
        if args.all:
            for pkg in sorted((REPO_ROOT / "scenarios").iterdir()):
                if pkg.is_dir() and PACKAGE_ID_RE.fullmatch(pkg.name) and (pkg / "towns").is_dir():
                    for town in _towns(pkg.name):
                        render(town, scenario=pkg.name)
        elif args.town:
            render(args.town, scenario=args.scenario)
        else:
            for town in _towns(args.scenario):
                render(town, scenario=args.scenario)
    except ValueError as exc:
        ap.error(str(exc))


if __name__ == "__main__":
    main()
