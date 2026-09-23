"""The ``township-modern`` tile kit (rows 17-29) and the seasons LUTs.

Guards the sheet's contract: every registered id is unique and painted, the
PNG is the 300-tile sheet the Tiled entry declares, ids 0-169 stay pixel
for pixel what the committed sheet shipped (the eight shadow-baked props may
only differ in translucent pixels), every exported stamp points into the
modern range, the seasonal LUTs only key on colours that exist in the two
sheets, and the nav-grid export carries a disjoint ``grass`` class.
"""

from __future__ import annotations

import datetime
import json
import subprocess
from collections import Counter
from pathlib import Path

import pytest
from conftest import REPO_ROOT
from PIL import Image

from scripts.mapgen import moderntiles as M
from scripts.mapgen import seasons as S
from scripts.mapgen import tiles as R

ROOT = Path(REPO_ROOT)
SHEET = ROOT / M.MODERN_IMAGE
RPG_SHEET = ROOT / R.TILESET_IMAGE
GAME = ROOT / "frontend/src/game"
T = R.TILE_SIZE
FROZEN = 170  # ids below this are referenced by the shipped maps
#: Props that received a 2 px dithered contact shadow: their opaque
#: silhouette must be untouched, only translucent pixels may change.
SHADOW_BAKED = {
    "hydrant",
    "mailbox",
    "trash_bin",
    "planter_box",
    "newsbox",
    "bench_h",
    "bollard",
    "brazier",
}
NEW_BLOCKS = {
    "shadow": range(170, 174),
    "litter": range(174, 180),
    "grass_dark": range(180, 196),
    "worn": range(196, 208),
    "vehicles": range(210, 243),
    "hedge": range(243, 253),
    "street": range(253, 263),
    "suburb": range(263, 274),
    "set_pieces": range(274, 292),
    "bikes": range(292, 295),
}


def _tile(img: Image.Image, tid: int) -> Image.Image:
    row, col = divmod(tid, M.MODERN_COLUMNS)
    return img.crop((col * T, row * T, (col + 1) * T, (row + 1) * T))


def _opaque_colours(img: Image.Image) -> set[tuple[int, int, int]]:
    px = img.convert("RGBA").load()
    w, h = img.size
    return {px[x, y][:3] for y in range(h) for x in range(w) if px[x, y][3] == 255}


@pytest.fixture(scope="module")
def sheet() -> Image.Image:
    return Image.open(SHEET).convert("RGBA")


@pytest.fixture(scope="module")
def committed_sheet() -> Image.Image:
    """The sheet at HEAD, read straight out of git (skips outside a checkout)."""
    import io

    try:
        blob = subprocess.run(
            ["git", "show", f"HEAD:{M.MODERN_IMAGE}"],
            cwd=ROOT,
            capture_output=True,
            check=True,
        ).stdout
    except (OSError, subprocess.CalledProcessError) as exc:  # pragma: no cover
        pytest.skip(f"committed sheet unavailable: {exc}")
    return Image.open(io.BytesIO(blob)).convert("RGBA")


@pytest.fixture(scope="module")
def regenerated() -> Image.Image:
    """The sheet as the generator paints it right now, quantized like
    ``generate()`` does but kept in memory."""
    palette = M._load_palette()
    cache: dict = {}

    def q(c):
        if c not in cache:
            r, g, b = c
            cache[c] = min(
                palette, key=lambda p: (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2
            )
        return cache[c]

    out = Image.new("RGBA", (M.MODERN_COLUMNS * T, M.MODERN_ROWS * T), (0, 0, 0, 0))
    for tid, img in M._draw_tiles().items():
        tile = img.copy()
        if tid not in M.NO_QUANTIZE:
            px = tile.load()
            for y in range(T):
                for x in range(T):
                    r, g, b, a = px[x, y]
                    if a == 255:
                        px[x, y] = (*q((r, g, b)), 255)
        row, col = divmod(tid, M.MODERN_COLUMNS)
        out.alpha_composite(tile, (col * T, row * T))
    return out


# ── registry ────────────────────────────────────────────────────────


def test_ids_are_unique_in_range_and_all_painted():
    assert len(set(M.IDS.values())) == len(M.IDS)
    assert all(0 <= i < M.MODERN_TILECOUNT for i in M.IDS.values())
    assert M.MODERN_ROWS == 30 and M.MODERN_TILECOUNT == 300
    painted = set(M._draw_tiles())
    assert painted == set(M.IDS.values())
    for block, ids in NEW_BLOCKS.items():
        assert set(ids) <= painted, f"{block}: unpainted ids in {ids}"


def test_new_blocks_are_where_the_registry_says():
    by_id = {v: k for k, v in M.IDS.items()}
    assert [by_id[i] for i in NEW_BLOCKS["shadow"]] == [
        "sh_full",
        "sh_fade_n",
        "sh_fade_w",
        "sh_corner",
    ]
    assert by_id[180] == "gd_0" and by_id[195] == "gd_hole_se"
    assert by_id[196] == "worn_0" and by_id[207] == "worn_se"
    assert by_id[210] == "car_red_h_a" and by_id[242] == "schoolbus_h_c"
    assert by_id[243] == "hedge_h" and by_id[252] == "hedge_se"
    assert by_id[253] == "pole_top" and by_id[262] == "blade_top"
    assert by_id[263] == "steps" and by_id[273] == "shed_br"
    assert by_id[274] == "shelter_00" and by_id[291] == "exit_sign_b"
    assert by_id[294] == "bike_rack"
    assert not {208, 209, *range(295, 300)} & set(by_id), "reserved ids must stay free"


def test_every_kit_stamp_points_into_the_new_rows():
    lo, hi = M.MODERN_FIRSTGID + FROZEN, M.MODERN_FIRSTGID + M.MODERN_TILECOUNT
    for name, stamp in M.KIT_STAMPS.items():
        gids = [g for _, _, g in stamp.cells()]
        assert gids, name
        assert all(lo <= g < hi for g in gids), f"{name}: {gids}"
        assert len(gids) == stamp.w * stamp.h, f"{name} has an empty cell"
    for name in ("shelter", "backstop"):
        assert M.KIT_STAMPS[name].w == 3 and M.KIT_STAMPS[name].h == 2
    assert M.BUS_H.w == 3 and M.BUS_V.h == 3 and M.CAR_H["red"].w == 2 and M.CAR_V["red"].h == 2
    assert set(M.CAR_H) == set(M.CAR_V) == {"red", "blue", "white", "silver", "green"}
    assert set(M.HEDGE) == {
        "h",
        "v",
        "end_w",
        "end_e",
        "end_n",
        "end_s",
        "corner_nw",
        "corner_ne",
        "corner_sw",
        "corner_se",
    }


def test_ground_blobs_have_the_asphalt_interface():
    from scripts.mapgen.export_road_gids import blob_gids

    for blob, count, holes in ((M.GRASS_DARK, 16, True), (M.WORN, 12, False)):
        gids = blob_gids(blob)
        assert len(gids) == count, blob.name
        assert len(blob.fill) == 4 and blob.n and blob.s and blob.w and blob.e
        assert all(blob.nw and blob.ne and blob.sw and blob.se for _ in (0,))
        assert bool(blob.hole_nw and blob.hole_ne and blob.hole_sw and blob.hole_se) is holes
        assert all(M.MODERN_FIRSTGID + FROZEN <= g < M.MODERN_FIRSTGID + 300 for g in gids)


# ── the png ─────────────────────────────────────────────────────────


def test_sheet_png_is_the_300_tile_sheet(sheet):
    assert sheet.size == (160, 480)
    entry = M.tileset_json_entry()
    assert (entry["imagewidth"], entry["imageheight"]) == sheet.size
    assert entry["tilecount"] == 300


def test_sheet_png_matches_the_generator(sheet, regenerated):
    """`make maps` was run after the last painter edit."""
    assert sheet.size == regenerated.size
    stale = [
        tid
        for tid in range(M.MODERN_TILECOUNT)
        if _tile(sheet, tid).tobytes() != _tile(regenerated, tid).tobytes()
    ]
    assert not stale, f"township-modern.png is stale for ids {stale}: run make maps"


def test_frozen_tiles_are_pixel_identical_to_the_committed_sheet(regenerated, committed_sheet):
    by_id = {v: k for k, v in M.IDS.items()}
    changed, silhouettes = [], []
    for tid in range(FROZEN):
        old, new = _tile(committed_sheet, tid), _tile(regenerated, tid)
        if old.tobytes() == new.tobytes():
            continue
        if by_id.get(tid) not in SHADOW_BAKED:
            changed.append(f"{tid} {by_id.get(tid)}")
            continue
        po, pn = old.load(), new.load()
        for y in range(T):
            for x in range(T):
                if po[x, y] == pn[x, y]:
                    continue
                # only shadow pixels may move: translucent on both sides
                if po[x, y][3] == 255 or pn[x, y][3] == 255:
                    silhouettes.append(f"{by_id[tid]}@({x},{y}) {po[x, y]} -> {pn[x, y]}")
    assert not changed, f"frozen tiles repainted: {changed}"
    assert not silhouettes, f"shadow bake touched opaque pixels: {silhouettes[:8]}"


def test_shadow_bake_deepened_the_prop_shadows(regenerated):
    for name in SHADOW_BAKED:
        px = _tile(regenerated, M.IDS[name]).load()
        alphas = Counter(px[x, y][3] for y in range(T) for x in range(T))
        assert alphas[M.GROUND_SHADOW[3]] >= 6, f"{name} has no dithered contact shadow"
        assert M.SHADOW[3] not in alphas, f"{name} still carries the flat shadow row"


def test_shadow_tiles_are_translucent_and_grass_dark_is_cooler(sheet):
    for name in ("sh_full", "sh_fade_n", "sh_fade_w", "sh_corner"):
        px = _tile(sheet, M.IDS[name]).load()
        alphas = {px[x, y][3] for y in range(T) for x in range(T)}
        assert alphas <= {0, M.SHADOW_TILE[3]}, name
    full = _tile(sheet, M.IDS["sh_full"]).load()
    assert all(full[x, y][3] == M.SHADOW_TILE[3] for y in range(T) for x in range(T))
    rpg = Image.open(RPG_SHEET).convert("RGBA")
    grass = Counter()
    for g in R.GRASS.fill:
        row, col = (g - 1) // 100, (g - 1) % 100
        grass.update(_opaque_colours(rpg.crop((col * T, row * T, (col + 1) * T, (row + 1) * T))))
    dark = Counter()
    for tid in range(180, 184):
        dark.update(_opaque_colours(_tile(sheet, tid)))
    assert not set(dark) & set(grass), "GRASS_DARK fill reuses plain grass colours"
    mean = lambda cs: tuple(sum(c[i] for c in cs) / len(cs) for i in range(3))  # noqa: E731
    mg, md = mean(list(grass)), mean(list(dark))
    assert sum(md) < sum(mg) * 0.93, "GRASS_DARK is not darker than R.GRASS"
    assert md[2] / md[0] > mg[2] / mg[0], "GRASS_DARK is not cooler than R.GRASS"


# ── exports ─────────────────────────────────────────────────────────


def test_stamp_defs_carry_the_kit():
    payload = json.loads((GAME / "stampDefs.json").read_text())
    for name in M.KIT_STAMPS:
        assert name in payload["stamps"], name
        assert payload["stamps"][name]["gids"] == [list(r) for r in M.KIT_STAMPS[name].gids]
    for name in ("sh_full", "clover_a", "litter_b", "mulch_a", "wire_h", "steps", "bike_rack"):
        assert payload["singles"][name] == M.mg(name)
    hi = M.MODERN_FIRSTGID + M.MODERN_TILECOUNT
    assert all(M.MODERN_FIRSTGID <= g < hi for g in payload["singles"].values())


def test_road_gids_have_a_disjoint_grass_class_and_worn_sidewalks():
    from scripts.mapgen.export_road_gids import blob_gids

    payload = json.loads((GAME / "roadGids.json").read_text())
    classes = {k: set(payload[k]) for k in ("sidewalk", "crosswalk", "road", "rough", "grass")}
    assert classes["grass"] == blob_gids(M.GRASS_DARK)
    for other in ("sidewalk", "crosswalk", "road", "rough"):
        assert not classes["grass"] & classes[other], f"grass gids leak into {other}"
    assert blob_gids(M.WORN) <= classes["sidewalk"]
    assert not blob_gids(M.WORN) & (classes["road"] | classes["rough"] | classes["crosswalk"])


# ── seasons ─────────────────────────────────────────────────────────


def test_season_for_calendar():
    for month, name in enumerate(S.BY_MONTH, start=1):
        assert S.season_for(datetime.date(2026, month, 15)) == name
    assert S.season_for(datetime.date(2026, 3, 1)) == "spring"
    assert S.season_for(datetime.date(2026, 5, 31)) == "spring"
    assert S.season_for(datetime.date(2026, 6, 1)) == "summer"
    assert S.season_for(datetime.date(2026, 9, 1)) == "autumn"
    assert S.season_for(datetime.date(2026, 12, 1)) == "winter"
    assert S.season_for(datetime.date(2026, 2, 28)) == "winter"


def test_seasons_json_keys_only_on_sheet_colours(sheet):
    payload = json.loads((GAME / "seasons.json").read_text())
    assert set(payload["seasons"]) == set(S.SEASONS)
    assert len(payload["byMonth"]) == 12 and set(payload["byMonth"]) <= set(S.SEASONS)
    present = _opaque_colours(sheet) | _opaque_colours(Image.open(RPG_SHEET))
    for name, pairs in payload["seasons"].items():
        assert 14 <= len(pairs) <= 40, f"{name}: {len(pairs)} entries"
        froms = [tuple(src) for src, _ in pairs]
        assert len(set(froms)) == len(froms), f"{name}: duplicate from colours"
        missing = [c for c in froms if c not in present]
        assert not missing, f"{name}: LUT keys absent from both sheets: {missing}"
        for _, dst in pairs:
            assert len(dst) == 3 and all(0 <= v <= 255 for v in dst)
    assert all(src == dst for src, dst in payload["seasons"]["summer"]), "summer is identity"
    assert payload == S.payload()


def test_apply_lut_remaps_exactly_and_caches(sheet):
    summer = S.apply_lut(sheet, "summer")
    assert summer.tobytes() == sheet.tobytes()
    autumn = S.apply_lut(sheet, "autumn")
    assert autumn.size == sheet.size and autumn is S.apply_lut(sheet, "autumn")
    table = dict(S.LUTS["autumn"])
    src, dst = _tile(sheet, M.IDS["gd_0"]).load(), _tile(autumn, M.IDS["gd_0"]).load()
    assert all(dst[x, y][:3] == table[src[x, y][:3]] for y in range(T) for x in range(T))
    assert autumn.tobytes() != sheet.tobytes()
    # non-foliage greens stay put through the seasons
    for name in ("exit_sign_t", "signal_green", "car_green_h_a", "blade_top"):
        assert _tile(autumn, M.IDS[name]).tobytes() == _tile(sheet, M.IDS[name]).tobytes(), name
    assert _tile(autumn, M.IDS["hedge_h"]).tobytes() != _tile(sheet, M.IDS["hedge_h"]).tobytes()
    with pytest.raises(ValueError):
        S.apply_lut(sheet, "monsoon")
