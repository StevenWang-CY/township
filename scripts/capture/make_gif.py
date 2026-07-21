#!/usr/bin/env python3
"""Build a compact, color-faithful README GIF from ordered capture frames."""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

TARGET_SIZE = (896, 560)
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

    frames: list[Image.Image] = []
    for path in paths:
        with Image.open(path) as source:
            frame = source.convert("RGB").resize(TARGET_SIZE, Image.Resampling.LANCZOS)
            frames.append(frame.quantize(colors=72, method=Image.Quantize.MEDIANCUT))

    output.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        output,
        save_all=True,
        append_images=frames[1:],
        duration=190,
        loop=0,
        optimize=True,
        disposal=2,
    )
    size = output.stat().st_size
    print(f"make_gif: {len(frames)} frames, {size / (1024 * 1024):.2f} MiB → {output}")
    if size > MAX_BYTES:
        print("make_gif: output exceeds the 8 MiB README budget", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
