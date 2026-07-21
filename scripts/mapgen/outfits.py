#!/usr/bin/env python3
"""Palette-swap outfit variants for the Township character cast.

The frontend used to differentiate agents with a whole-body multiplicative
tint (``AgentSprite.setTint``), which muddied skin and hair along with the
clothes. This tool bakes the *intent* of each tint into a real palette swap:

For each agent in :data:`AGENTS` it

1. samples the torso region of the base sheet's front idle frame,
2. finds the dominant garment color cluster (excluding outlines),
3. verifies the cluster is torso-dominant and does NOT bleed into the head
   (hair sharing the garment palette would get recolored too), and
4. rewrites every pixel of those exact colors across the whole sheet to the
   target hue, preserving each pixel's luminance so the original shading
   survives.

Output: ``frontend/public/assets/characters/custom/{agent}_custom.png``
(texture key ``char-custom-{agent}`` in the frontend). Agents whose sheet
fails the reliability checks are skipped and reported — the frontend keeps
its runtime tint fallback for those.

Keep :data:`AGENTS` in sync with
``frontend/src/game/spriteCustomization.ts``.

Run:  python3 scripts/mapgen/outfits.py
"""

from __future__ import annotations

import re
from collections import Counter
from pathlib import Path

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[2]
CHAR_DIR = REPO_ROOT / "frontend/public/assets/characters"
OUT_DIR = CHAR_DIR / "custom"

FRAME = 32

#: agent id -> (base sheet, tint intent from spriteCustomization.ts)
AGENTS: dict[str, tuple[str, int]] = {
    # Dover
    "miguel-hernandez": ("Francisco_Lopez", 0xD6AC82),
    "maria-santos": ("Carmen_Ortiz", 0xBCD4DC),
    "esperanza-guzman": ("Isabella_Rodriguez", 0xC4B8A6),
    "sofia-ramirez": ("Jane_Moreno", 0xC6D2B4),
    "tom-kowalski": ("folk-0", 0xD6CDB8),
    # Montclair
    "rosa-chen": ("Yuriko_Yamamoto", 0xD1C8B0),
    "jordan-williams": ("Latoya_Williams", 0xC6D2B4),
    "carmen-&-alejandro-vargas": ("Maria_Lopez", 0xD9C2CC),
    'margaret-"peggy"-o\'brien': ("Hailey_Johnson", 0xB8A896),
    # Parsippany
    'kantibhai-"kanti"-desai': ("Eddy_Lin", 0xC8B89C),
    "brian-mccarthy": ("Sam_Moore", 0xB8C0D8),
    "linda-morrison": ("Jennifer_Moore", 0xB8C0D8),
    "grace-reyes": ("Tamara_Taylor", 0xBCD4DC),
    # Randolph
    'michael-"mike"-brennan': ("Arthur_Burton", 0xB8C0D8),
    'jennifer-"jen"-russo': ("Folk_Resident", 0xD9C2CC),
    "frank-deluca": ("Tom_Moreno", 0xA8A098),
    "vikram-iyer": ("Klaus_Mueller", 0x8AA0C8),
    "tony-mancini": ("John_Lin", 0xD6AC82),
}

# Torso sample box inside the front idle frame (frame index 1).
TORSO = (9, 18, 23, 27)  # x0, y0, x1, y1 inclusive

CLUSTER_DIST = 120  # Manhattan RGB distance binding shades to the dominant
MIN_TORSO_COVER = 0.30
MAX_HEAD_BLEED = 0.10


def slug(agent_id: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", agent_id.lower())).strip("-")


def lum(c: tuple[int, int, int]) -> float:
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def frame_at(sheet: Image.Image, idx: int) -> Image.Image:
    r, c = divmod(idx, 3)
    return sheet.crop((c * FRAME, r * FRAME, (c + 1) * FRAME, (r + 1) * FRAME))


def garment_cluster(sheet: Image.Image) -> tuple[set, str] | tuple[None, str]:
    """Dominant torso color cluster of the front idle frame, or None + why."""
    fr = frame_at(sheet, 1)
    px = fr.load()
    x0, y0, x1, y1 = TORSO
    counts: Counter = Counter()
    total = 0
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            r, g, b, a = px[x, y]
            if a < 200:
                continue
            total += 1
            if lum((r, g, b)) < 40:  # outline ink — never recolor
                continue
            counts[(r, g, b)] += 1
    if not counts or total == 0:
        return None, "empty torso sample"
    dom = counts.most_common(1)[0][0]
    cluster = {
        c
        for c in counts
        if abs(c[0] - dom[0]) + abs(c[1] - dom[1]) + abs(c[2] - dom[2]) < CLUSTER_DIST
    }
    # Saturated garments (greens, blues...) span light→dark shades that the
    # RGB-distance rule misses; widen the cluster to the whole hue family.
    import colorsys

    dh, ds, _dv = colorsys.rgb_to_hsv(*(v / 255 for v in dom))
    if ds >= 0.25:
        for c in counts:
            h, s, _v = colorsys.rgb_to_hsv(*(v / 255 for v in c))
            hue_diff = min(abs(h - dh), 1 - abs(h - dh))
            if s >= 0.20 and hue_diff < 0.10:
                cluster.add(c)
    cover = sum(counts[c] for c in cluster) / total
    if cover < MIN_TORSO_COVER:
        return None, f"cluster covers only {cover:.0%} of torso"

    # Head-bleed check: the same colors in the top half of the head means
    # hair shares the garment palette — a swap would recolor the hair too.
    head_total = 0
    head_hits = 0
    for y in range(0, 14):
        for x in range(FRAME):
            r, g, b, a = px[x, y]
            if a < 200:
                continue
            head_total += 1
            if (r, g, b) in cluster:
                head_hits += 1
    if head_total and head_hits / head_total > MAX_HEAD_BLEED:
        return None, f"garment palette bleeds into head ({head_hits}/{head_total} px)"
    return cluster, f"cover {cover:.0%}"


def swap(sheet: Image.Image, cluster: set, tint: int) -> Image.Image:
    """Recolor every cluster pixel to the tint hue, preserving luminance."""
    tr, tg, tb = (tint >> 16) & 0xFF, (tint >> 8) & 0xFF, tint & 0xFF
    tl = max(1.0, lum((tr, tg, tb)))
    out = sheet.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a == 0 or (r, g, b) not in cluster:
                continue
            k = lum((r, g, b)) / tl
            px[x, y] = (
                min(255, int(tr * k)),
                min(255, int(tg * k)),
                min(255, int(tb * k)),
                a,
            )
    return out


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ok: list[str] = []
    skipped: list[tuple[str, str]] = []
    written: set[str] = set()
    for agent, (base, tint) in AGENTS.items():
        sheet = Image.open(CHAR_DIR / f"{base}.png").convert("RGBA")
        cluster, why = garment_cluster(sheet)
        if cluster is None:
            skipped.append((agent, why))
            print(f"SKIP  {agent:34s} ({base}): {why}")
            continue
        dest = OUT_DIR / f"{slug(agent)}_custom.png"
        swap(sheet, cluster, tint).save(dest)
        ok.append(agent)
        written.add(dest.name)
        print(f"wrote {dest.relative_to(REPO_ROOT)}  ({why})")
    # Drop stale sheets from earlier runs (agents that regressed to tint).
    for old in OUT_DIR.glob("*_custom.png"):
        if old.name not in written:
            old.unlink()
            print(f"removed stale {old.relative_to(REPO_ROOT)}")
    print(f"\n{len(ok)} swapped, {len(skipped)} kept on runtime tint")
    for agent, why in skipped:
        print(f"  tint fallback: {agent} — {why}")


if __name__ == "__main__":
    main()
