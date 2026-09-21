#!/usr/bin/env python3
"""Build a compact, color-faithful README GIF from ordered capture frames."""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

TARGET_WIDTH = 896
MAX_BYTES = 8 * 1024 * 1024


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: make_gif.py <frames-dir> <output.gif>", file=sys.stderr)
        return 2

    frames_dir = Path(sys.argv[1])
    output = Path(sys.argv[2])
    paths = sorted(frames_dir.glob("*.png"))
    if not paths:
        print(f"make_gif: no PNG frames in {frames_dir}", file=sys.stderr)
        return 1

    # Identical consecutive captures (hold frames) collapse into a single GIF
    # frame with a longer duration — same rhythm, far smaller file.
    sources: list[Image.Image] = []
    durations: list[int] = []
    previous_bytes: bytes | None = None
    for path in paths:
        raw = path.read_bytes()
        if raw == previous_bytes:
            durations[-1] += 190
            continue
        previous_bytes = raw
        with Image.open(path) as source:
            sources.append(source.convert("RGB"))
            durations.append(190)

    output.parent.mkdir(parents=True, exist_ok=True)
    # Frames are canvas-only crops; derive the height from the first frame so
    # the GIF keeps the town's true aspect instead of stretching to a fixed
    # box. The README budget is fixed, so when a longer cut lands over it the
    # encoder steps the width (then the palette) down until it fits rather
    # than failing the whole capture.
    attempts = [(TARGET_WIDTH, 72), (864, 72), (832, 72), (800, 72), (800, 64), (768, 64)]
    size = 0
    for width, colors in attempts:
        first = sources[0]
        target_size = (width, max(1, round(first.height * width / first.width / 2) * 2))
        frames = [
            source.resize(target_size, Image.Resampling.LANCZOS).quantize(
                colors=colors, method=Image.Quantize.MEDIANCUT
            )
            for source in sources
        ]
        frames[0].save(
            output,
            save_all=True,
            append_images=frames[1:],
            duration=durations,
            loop=0,
            optimize=True,
            disposal=2,
        )
        size = output.stat().st_size
        print(
            f"make_gif: {len(frames)} frames at {width}px / {colors} colours, "
            f"{size / (1024 * 1024):.2f} MiB → {output}"
        )
        if size <= MAX_BYTES:
            return 0
    print("make_gif: output exceeds the 8 MiB README budget", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
