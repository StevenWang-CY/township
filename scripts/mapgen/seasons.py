#!/usr/bin/env python3
"""Seasonal palette remaps for the two tile sheets.

The town's foliage is a handful of exact colours: the canopy greens and the
fruit of the rpg tree stamps (``TREE_LIGHT`` / ``TREE_DARK`` / ``TREE_SMALL``
/ ``TREE_ROUND_SMALL`` / ``TREE_FRUIT_*``), the ``R.GRASS`` and
``R.GRASS_LIGHT`` fills, and the modern sheet's ``GRASS_DARK``. Every
colour is read out of the actual PNGs at those tiles (never typed in), so a
season is an exact-colour lookup table that the frontend can apply to both
sheets at runtime with no blending:

* spring — fruit reds go blossom pink / white, grass and canopies freshen
  toward yellow-green;
* summer — identity (the sheets as painted);
* autumn — canopies go amber / rust / olive by tone, grass goes olive;
* winter — canopies desaturate, grass lightens toward straw.

``season_for(date)`` maps a calendar date to a season (Mar-May spring,
Jun-Aug summer, Sep-Nov autumn, Dec-Feb winter); ``apply_lut(image,
season)`` remaps a PIL image (cached per image); ``payload()`` is what
``export_window_gids.py`` writes to ``frontend/src/game/seasons.json``.

Run directly to print the table sizes:
    python3 -m scripts.mapgen.seasons
"""

from __future__ import annotations

import colorsys
import datetime
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mapgen import moderntiles as M  # noqa: E402
from mapgen import tiles as R  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_JSON = REPO_ROOT / "frontend/src/game/seasons.json"

RGB = tuple[int, int, int]
SEASONS = ("spring", "summer", "autumn", "winter")
#: Season per calendar month (index 0 = January).
BY_MONTH: tuple[str, ...] = (
    "winter",
    "winter",
    "spring",
    "spring",
    "spring",
    "summer",
    "summer",
    "summer",
    "autumn",
    "autumn",
    "autumn",
    "winter",
)

#: Canopy greens are read from these stamps; fruit colours only from the
#: fruit trees (and never from a colour the plain trees also use, so a
#: trunk highlight is not mistaken for fruit).
_TREE_STAMPS = (R.TREE_LIGHT, R.TREE_DARK, R.TREE_SMALL, R.TREE_ROUND_SMALL)
_FRUIT_STAMPS = (R.TREE_FRUIT_A, R.TREE_FRUIT_B, R.TREE_FRUIT_C)
STRAW = (222, 206, 150)


# ---------------------------------------------------------------------------
# sampling
# ---------------------------------------------------------------------------


def _sheet(path: Path):
    from PIL import Image

    return Image.open(path).convert("RGBA")


def _tile_colours(sheet, gids, columns: int, firstgid: int) -> Counter:
    """Opaque colour counts over the given tiles of a sheet."""
    counts: Counter = Counter()
    t = R.TILE_SIZE
    for g in gids:
        row, col = divmod(g - firstgid, columns)
        tile = sheet.crop((col * t, row * t, (col + 1) * t, (row + 1) * t))
        px = tile.load()
        for y in range(t):
            for x in range(t):
                r, gg, b, a = px[x, y]
                if a == 255:
                    counts[(r, gg, b)] += 1
    return counts


def _is_green(c: RGB) -> bool:
    r, g, b = c
    return g >= r + 10 and g >= b - 4


def _is_red(c: RGB) -> bool:
    r, g, b = c
    return r >= g + 40 and r >= b + 40


def sample_sources() -> dict[str, list[RGB]]:
    """The colour families the LUTs are built from, read from the PNGs:
    ``canopy``, ``fruit``, ``grass``, ``grass_light`` and ``grass_dark``
    (each sorted by frequency, most common first)."""
    rpg = _sheet(REPO_ROOT / R.TILESET_IMAGE)
    modern = _sheet(M.OUT_IMAGE)

    def rpg_colours(stamps) -> Counter:
        counts: Counter = Counter()
        for s in stamps:
            counts += _tile_colours(rpg, [g for _, _, g in s.cells()], R.COLS, R.FIRST_GID)
        return counts

    trees = rpg_colours(_TREE_STAMPS)
    fruit_trees = rpg_colours(_FRUIT_STAMPS)
    canopy = trees + fruit_trees
    fruit = Counter({c: n for c, n in fruit_trees.items() if _is_red(c) and c not in trees})
    grass = _tile_colours(rpg, R.GRASS.fill, R.COLS, R.FIRST_GID)
    grass_light = _tile_colours(rpg, R.GRASS_LIGHT.fill, R.COLS, R.FIRST_GID)
    grass_dark = _tile_colours(modern, M.GRASS_DARK.fill, M.MODERN_COLUMNS, M.MODERN_FIRSTGID)

    def ordered(counts: Counter, keep) -> list[RGB]:
        return [c for c, _ in counts.most_common() if keep(c)]

    return {
        "canopy": ordered(canopy, _is_green),
        "fruit": ordered(fruit, lambda c: True),
        "grass": ordered(grass, _is_green),
        "grass_light": ordered(grass_light, _is_green),
        "grass_dark": ordered(grass_dark, _is_green),
    }


# ---------------------------------------------------------------------------
# colour transforms
# ---------------------------------------------------------------------------


def _clamp(v: float) -> int:
    return max(0, min(255, round(v)))


def _hsv(c: RGB) -> tuple[float, float, float]:
    return colorsys.rgb_to_hsv(c[0] / 255, c[1] / 255, c[2] / 255)


def _rgb(h: float, s: float, v: float) -> RGB:
    r, g, b = colorsys.hsv_to_rgb(h % 1.0, max(0.0, min(1.0, s)), max(0.0, min(1.0, v)))
    return (_clamp(r * 255), _clamp(g * 255), _clamp(b * 255))


def _shift(c: RGB, hue: float = 0.0, sat: float = 1.0, val: float = 1.0) -> RGB:
    """Rotate hue by ``hue`` turns and scale saturation / value."""
    h, s, v = _hsv(c)
    return _rgb(h + hue, s * sat, v * val)


def _mix(c: RGB, target: RGB, t: float) -> RGB:
    return tuple(_clamp(a + (b - a) * t) for a, b in zip(c, target, strict=True))


def _autumn_canopy(c: RGB) -> RGB:
    """Amber for the light tones, rust for the mids, dark olive-brown for the
    shade: the hue slides from ~21 to ~30 degrees with the tone's value."""
    _, s, v = _hsv(c)
    return _rgb(0.04 + 0.06 * v, min(1.0, s * 1.15 + 0.15), v)


def _autumn_grass(c: RGB) -> RGB:
    _, s, v = _hsv(c)
    return _rgb(0.19, s * 0.8, v * 0.82)


_SPRING_BLOSSOM = ((250, 214, 224), (232, 150, 178))


def _build_luts(sources: dict[str, list[RGB]]) -> dict[str, list[tuple[RGB, RGB]]]:
    canopy, fruit = sources["canopy"], sources["fruit"]
    grasses = sources["grass"] + sources["grass_light"] + sources["grass_dark"]
    keys = canopy + fruit + grasses
    spring: list[tuple[RGB, RGB]] = []
    for c in canopy:
        spring.append((c, _shift(c, hue=-0.033, sat=1.05, val=1.12)))
    # lightest fruit tone -> palest blossom, its shade -> the deeper pink
    for i, c in enumerate(sorted(fruit, key=lambda c: -_hsv(c)[2])):
        spring.append((c, _SPRING_BLOSSOM[min(i, len(_SPRING_BLOSSOM) - 1)]))
    for c in grasses:
        spring.append((c, _shift(c, hue=-0.022, sat=1.05, val=1.08)))
    autumn = (
        [(c, _autumn_canopy(c)) for c in canopy]
        + [(c, c) for c in fruit]
        + [(c, _autumn_grass(c)) for c in grasses]
    )
    winter = (
        [(c, _shift(c, sat=0.35, val=0.95)) for c in canopy]
        + [(c, _shift(c, sat=0.4, val=1.0)) for c in fruit]
        + [(c, _mix(c, STRAW, 0.55)) for c in sources["grass"] + sources["grass_light"]]
        + [(c, _mix(c, STRAW, 0.45)) for c in sources["grass_dark"]]
    )
    return {
        "spring": spring,
        "summer": [(c, c) for c in keys],
        "autumn": autumn,
        "winter": winter,
    }


SOURCES: dict[str, list[RGB]] = sample_sources()
#: season -> [(from_rgb, to_rgb), ...]; every ``from`` is a colour that
#: occurs in one of the two sheets. Summer is the identity.
LUTS: dict[str, list[tuple[RGB, RGB]]] = _build_luts(SOURCES)


# ---------------------------------------------------------------------------
# api
# ---------------------------------------------------------------------------


def season_for(date: datetime.date) -> str:
    """``spring`` (Mar-May), ``summer`` (Jun-Aug), ``autumn`` (Sep-Nov) or
    ``winter`` (Dec-Feb)."""
    return BY_MONTH[date.month - 1]


_REMAP_CACHE: dict[tuple, object] = {}


def apply_lut(image, season: str):
    """Exact-colour remap of a PIL image for ``season``. Results are cached
    on the image's pixels, so repeated calls for the same sheet are free;
    the cached image is returned as-is (copy it before mutating)."""
    if season not in LUTS:
        raise ValueError(f"unknown season {season!r}; expected one of {SEASONS}")
    table = {src: dst for src, dst in LUTS[season] if src != dst}
    src_img = image if image.mode == "RGBA" else image.convert("RGBA")
    if not table:
        return src_img
    key = (season, src_img.size, hashlib.sha1(src_img.tobytes()).hexdigest())
    if key in _REMAP_CACHE:
        return _REMAP_CACHE[key]
    out = src_img.copy()
    src_px, out_px = src_img.load(), out.load()
    w, h = out.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = src_px[x, y]
            if a:
                dst = table.get((r, g, b))
                if dst is not None:
                    out_px[x, y] = (*dst, a)
    _REMAP_CACHE[key] = out
    return out


def payload() -> dict:
    """The ``seasons.json`` document: per-season ``[[from, to], ...]`` pairs
    as ``[r, g, b]`` triples and the month -> season table."""
    return {
        "_generated": "scripts/mapgen/export_window_gids.py — do not edit",
        "seasons": {name: [[list(src), list(dst)] for src, dst in LUTS[name]] for name in SEASONS},
        "byMonth": list(BY_MONTH),
    }


def write_json(path: Path = OUT_JSON) -> Path:
    path.write_text(json.dumps(payload(), indent=2, ensure_ascii=False) + "\n")
    return path


if __name__ == "__main__":
    for name in SEASONS:
        changed = sum(1 for a, b in LUTS[name] if a != b)
        print(f"{name}: {len(LUTS[name])} entries ({changed} change colour)")
    for fam, cols in SOURCES.items():
        print(f"  {fam}: {cols}")
