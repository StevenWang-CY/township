#!/usr/bin/env python3
"""Generate pixel accessory overlay sheets for the Township character cast.

Two jobs, both writing into ``frontend/public/assets/characters/``:

1. **Folk split** — ``32x32folk.png`` packs eight extra Smallville-style
   bodies (4 across x 2 down, each a 96x128 sheet of 3x4 32px frames).
   They are split into ``folk-0.png`` .. ``folk-7.png`` so they can be used
   as couple-partner bodies and to replace the two mapped sheets that turned
   out to be *cats* (Adam_Smith, Wolfgang_Schulz).

2. **Accessory overlays** — for each (accessory, base-sheet) pair in
   :data:`TARGETS`, render a 96x128 overlay sheet aligned per frame by
   scanning the base sheet's head pixels (topmost opaque row, crown centre,
   per-row head extents). Output: ``accessories/{acc}-{Base}.png``; the
   frontend loads it as a spritesheet with texture key ``acc-{acc}-{Base}``
   and plays it frame-locked with the body (see AgentSprite).

Accessories: kippah, hijab, baseball cap, hardhat, glasses.

Style: 1px darker outline on every shape, 3-tone shading, colors kept in
the muted Township range so overlays read as part of the original art.

Run:  python3 scripts/mapgen/accessories.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[2]
CHAR_DIR = REPO_ROOT / "frontend/public/assets/characters"
ACC_DIR = CHAR_DIR / "accessories"

FRAME = 32
COLS, ROWS = 3, 4  # 12 frames: rows = down / left / right / up
DIR_OF_ROW = ["down", "left", "right", "up"]

#: (accessory, base sheet) pairs to generate. Keep in sync with
#: frontend/src/game/spriteCustomization.ts accessoryKey values
#: ("acc-{acc}-{base}").
TARGETS = [
    ("kippah", "folk-3"),  # rabbi-daniel-goldstein
    ("hijab", "Abigail_Chen"),  # aisha-&-omar-khan
    ("cap", "Tom_Moreno"),  # frank-deluca
    ("hardhat", "Francisco_Lopez"),  # miguel-hernandez
    ("glasses", "Klaus_Mueller"),  # vikram-iyer
]

# ── palette ────────────────────────────────────────────────────────────────

KIPPAH_MAIN = (43, 47, 84, 255)
KIPPAH_LITE = (74, 80, 128, 255)
KIPPAH_DARK = (26, 28, 52, 255)

HIJAB_MAIN = (122, 74, 106, 255)  # muted plum
HIJAB_LITE = (152, 100, 134, 255)
HIJAB_DARK = (84, 48, 72, 255)

CAP_MAIN = (74, 90, 68, 255)  # forest green
CAP_LITE = (100, 118, 92, 255)
CAP_DARK = (44, 54, 40, 255)
CAP_VISOR = (38, 40, 36, 255)

HAT_MAIN = (226, 178, 58, 255)  # safety yellow
HAT_LITE = (244, 208, 110, 255)
HAT_DARK = (168, 126, 38, 255)

GLASS_FRAME = (40, 38, 40, 255)
GLASS_GLINT = (210, 224, 232, 160)


# ── helpers ────────────────────────────────────────────────────────────────


def split_folk() -> None:
    """Split 32x32folk.png into eight standalone 96x128 character sheets."""
    src = Image.open(CHAR_DIR / "32x32folk.png").convert("RGBA")
    for i in range(8):
        sx, sy = (i % 4) * 96, (i // 4) * 128
        sheet = src.crop((sx, sy, sx + 96, sy + 128))
        out = CHAR_DIR / f"folk-{i}.png"
        sheet.save(out)
        print(f"wrote {out.relative_to(REPO_ROOT)}")


def frames(sheet: Image.Image):
    """Yield (index, direction, frame Image) for the 12 frames."""
    for idx in range(COLS * ROWS):
        r, c = divmod(idx, COLS)
        yield (
            idx,
            DIR_OF_ROW[r],
            sheet.crop((c * FRAME, r * FRAME, (c + 1) * FRAME, (r + 1) * FRAME)),
        )


def head_metrics(frame: Image.Image) -> dict:
    """Scan a 32x32 frame: head top row, crown centre/width, per-row extents.

    The Smallville bodies are chibi — the head spans roughly the top half of
    the frame, so rows [top .. top+13] are treated as head rows.
    """
    px = frame.load()
    top = None
    rows: dict[int, tuple[int, int]] = {}
    for y in range(FRAME):
        xs = [x for x in range(FRAME) if px[x, y][3] > 40]
        if not xs:
            continue
        if top is None:
            top = y
        if y <= (top + 13):
            rows[y] = (min(xs), max(xs))
    if top is None:
        return {"top": None}
    crown = [rows[y] for y in range(top, min(top + 4, top + 14)) if y in rows]
    lo = min(a for a, _ in crown)
    hi = max(b for _, b in crown)
    return {"top": top, "cx": (lo + hi) / 2.0, "crown": (lo, hi), "rows": rows, "frame": frame}


def put(px, x: int, y: int, color) -> None:
    if 0 <= x < FRAME and 0 <= y < FRAME:
        px[x, y] = color


def hline(px, x0: int, x1: int, y: int, color) -> None:
    for x in range(x0, x1 + 1):
        put(px, x, y, color)


# ── accessory painters (draw into a blank 32x32 frame) ────────────────────


def draw_kippah(px, m: dict, d: str) -> None:
    ty, cx = m["top"], int(round(m["cx"]))
    # Small dome riding the crown; sits toward the back on side views.
    off = {"down": 0, "left": 2, "right": -2, "up": 0}[d]
    c = cx + off
    w = 4 if d != "up" else 5  # half-width-ish
    hline(px, c - w + 1, c + w - 1, ty, KIPPAH_MAIN)
    hline(px, c - w, c + w, ty + 1, KIPPAH_MAIN)
    put(px, c - w, ty + 1, KIPPAH_DARK)
    put(px, c + w, ty + 1, KIPPAH_DARK)
    hline(px, c - 1, c + 1, ty, KIPPAH_LITE)
    if d == "up":
        # Back view: the full disc shows.
        hline(px, c - w + 1, c + w - 1, ty + 2, KIPPAH_DARK)


def draw_hijab(px, m: dict, d: str) -> None:
    """Cover the crown fully, wrap the hair (detected by color cluster from
    the crown rows) down to the shoulders, and cut a face window on the
    facing side. This handles long hair that flows past the head band."""
    ty = m["top"]
    rows: dict[int, tuple[int, int]] = m["rows"]
    frame = m["frame"]
    fpx = frame.load()

    # Hair color cluster: sample the crown band (rows ty..ty+3).
    from collections import Counter

    counts: Counter = Counter()
    for y in range(ty, ty + 4):
        if y not in rows:
            continue
        lo, hi = rows[y]
        for x in range(lo, hi + 1):
            r, g, b, a = fpx[x, y]
            if a > 40:
                counts[(r, g, b)] += 1
    if not counts:
        return
    dom = counts.most_common(1)[0][0]

    def is_hair(c) -> bool:
        return (abs(c[0] - dom[0]) + abs(c[1] - dom[1]) + abs(c[2] - dom[2])) < 150

    # Coverage: crown band full-span + any hair-colored pixel above shoulder.
    cover: set[tuple[int, int]] = set()
    for y in range(ty, min(ty + 4, FRAME)):
        if y in rows:
            lo, hi = rows[y]
            cover.update((x, y) for x in range(lo, hi + 1))
    for y in range(ty, min(ty + 19, FRAME)):
        for x in range(FRAME):
            r, g, b, a = fpx[x, y]
            if a > 40 and is_hair((r, g, b)):
                cover.add((x, y))

    # Face window on the facing side (never on the back view).
    if d != "up":
        cx = int(round(m["cx"]))
        if d == "down":
            win = {(x, y) for y in range(ty + 4, ty + 12) for x in range(cx - 4, cx + 5)}
        elif d == "left":
            lo = rows.get(ty + 8, m["crown"])[0]
            win = {(x, y) for y in range(ty + 5, ty + 12) for x in range(lo + 1, lo + 8)}
        else:
            hi = rows.get(ty + 8, m["crown"])[1]
            win = {(x, y) for y in range(ty + 5, ty + 12) for x in range(hi - 7, hi)}
        cover -= win

    # Paint: main fill, dark 1px outline at the coverage boundary, and a
    # light sheen band across the second crown row.
    for x, y in cover:
        edge = any((x + dx, y + dy) not in cover for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
        col = HIJAB_DARK if edge else HIJAB_MAIN
        if not edge and y == ty + 1:
            col = HIJAB_LITE
        put(px, x, y, col)


def draw_cap(px, m: dict, d: str) -> None:
    ty = m["top"]
    lo, hi = m["crown"]
    # Crown: 4 rows hugging the skull, inset 1px at the top.
    hline(px, lo + 2, hi - 2, ty - 1, CAP_MAIN)
    hline(px, lo + 1, hi - 1, ty, CAP_MAIN)
    hline(px, lo, hi, ty + 1, CAP_MAIN)
    hline(px, lo, hi, ty + 2, CAP_DARK)
    hline(px, lo + 2, hi - 3, ty - 1, CAP_LITE)
    put(px, lo, ty + 1, CAP_DARK)
    put(px, hi, ty + 1, CAP_DARK)
    # Visor toward the facing direction.
    if d == "down":
        hline(px, lo + 1, hi - 1, ty + 3, CAP_VISOR)
    elif d == "left":
        hline(px, lo - 4, lo + 2, ty + 3, CAP_VISOR)
        hline(px, lo - 3, lo, ty + 2, CAP_DARK)
    elif d == "right":
        hline(px, hi - 2, hi + 4, ty + 3, CAP_VISOR)
        hline(px, hi, hi + 3, ty + 2, CAP_DARK)
    # (up: no visor visible — just the crown + band.)


def draw_hardhat(px, m: dict, d: str) -> None:
    ty = m["top"]
    lo, hi = m["crown"]
    # Dome, slightly proud of the skull.
    hline(px, lo + 3, hi - 3, ty - 2, HAT_MAIN)
    hline(px, lo + 1, hi - 1, ty - 1, HAT_MAIN)
    hline(px, lo, hi, ty, HAT_MAIN)
    hline(px, lo, hi, ty + 1, HAT_MAIN)
    hline(px, lo + 3, hi - 4, ty - 2, HAT_LITE)
    # centre ridge
    cx = int(round(m["cx"]))
    put(px, cx, ty - 2, HAT_LITE)
    put(px, cx, ty - 1, HAT_LITE)
    # Brim: 1px band poking past the skull.
    if d in ("down", "up"):
        hline(px, lo - 2, hi + 2, ty + 2, HAT_DARK)
    elif d == "left":
        hline(px, lo - 4, hi + 1, ty + 2, HAT_DARK)
    else:
        hline(px, lo - 1, hi + 4, ty + 2, HAT_DARK)


def draw_glasses(px, m: dict, d: str) -> None:
    if d == "up":
        return  # back of head
    ty, cx = m["top"], int(round(m["cx"]))
    ey = ty + 9  # eye row on these chibi heads
    if d == "down":
        for ox in (-5, 2):
            # 4x3 lens
            for yy in range(ey, ey + 3):
                put(px, cx + ox, yy, GLASS_FRAME)
                put(px, cx + ox + 3, yy, GLASS_FRAME)
            hline(px, cx + ox, cx + ox + 3, ey, GLASS_FRAME)
            hline(px, cx + ox, cx + ox + 3, ey + 2, GLASS_FRAME)
            put(px, cx + ox + 1, ey + 1, GLASS_GLINT)
        put(px, cx - 1, ey + 1, GLASS_FRAME)  # bridge
        put(px, cx, ey + 1, GLASS_FRAME)
    else:
        # Side view: one bold 5x4 lens over the front of the face + a temple
        # arm running to the back of the head. Filled glint so it stays
        # legible over hair the same value as the frame.
        rows = m["rows"]
        lo, hi = rows.get(ey, m["crown"])
        if d == "left":
            x0 = lo + 1
            hline(px, x0, x0 + 4, ey, GLASS_FRAME)
            hline(px, x0, x0 + 4, ey + 3, GLASS_FRAME)
            for yy in (ey + 1, ey + 2):
                put(px, x0, yy, GLASS_FRAME)
                put(px, x0 + 4, yy, GLASS_FRAME)
                hline(px, x0 + 1, x0 + 3, yy, GLASS_GLINT)
            hline(px, x0 + 5, hi - 2, ey + 1, GLASS_FRAME)  # temple arm
        else:
            x0 = hi - 5
            hline(px, x0, x0 + 4, ey, GLASS_FRAME)
            hline(px, x0, x0 + 4, ey + 3, GLASS_FRAME)
            for yy in (ey + 1, ey + 2):
                put(px, x0, yy, GLASS_FRAME)
                put(px, x0 + 4, yy, GLASS_FRAME)
                hline(px, x0 + 1, x0 + 3, yy, GLASS_GLINT)
            hline(px, lo + 2, x0 - 1, ey + 1, GLASS_FRAME)


PAINTERS = {
    "kippah": draw_kippah,
    "hijab": draw_hijab,
    "cap": draw_cap,
    "hardhat": draw_hardhat,
    "glasses": draw_glasses,
}


def build_overlay(acc: str, base_name: str) -> Path:
    base = Image.open(CHAR_DIR / f"{base_name}.png").convert("RGBA")
    out = Image.new("RGBA", (COLS * FRAME, ROWS * FRAME), (0, 0, 0, 0))
    for idx, d, fr in frames(base):
        m = head_metrics(fr)
        if m["top"] is None:
            continue
        cell = Image.new("RGBA", (FRAME, FRAME), (0, 0, 0, 0))
        PAINTERS[acc](cell.load(), m, d)
        r, c = divmod(idx, COLS)
        out.alpha_composite(cell, (c * FRAME, r * FRAME))
    ACC_DIR.mkdir(parents=True, exist_ok=True)
    dest = ACC_DIR / f"{acc}-{base_name}.png"
    out.save(dest)
    print(f"wrote {dest.relative_to(REPO_ROOT)}")
    return dest


def main() -> None:
    split_folk()
    for acc, base in TARGETS:
        build_overlay(acc, base)


if __name__ == "__main__":
    main()
