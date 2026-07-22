#!/usr/bin/env python3
"""Crop README portraits from the exact resident sheets used in the game."""

from __future__ import annotations

from pathlib import Path

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[2]
CHARACTERS = REPO_ROOT / "frontend" / "public" / "assets" / "characters"
OUTPUT = REPO_ROOT / "docs" / "media" / "residents"

# The middle frame of the first row is each resident's front-facing idle pose.
PORTRAITS = {
    "carlos-restrepo.png": ("Carlos_Gomez.png", None),
    "frank-deluca.png": (
        "custom/frank-deluca_custom.png",
        "accessories/cap-Tom_Moreno.png",
    ),
    "jen-russo.png": ("custom/jennifer-jen-russo_custom.png", None),
    "jordan-williams.png": ("custom/jordan-williams_custom.png", None),
    "maria-santos.png": ("custom/maria-santos_custom.png", None),
    "miguel-hernandez.png": (
        "custom/miguel-hernandez_custom.png",
        "accessories/hardhat-Francisco_Lopez.png",
    ),
    "mike-brennan.png": ("custom/michael-mike-brennan_custom.png", None),
    "rosa-chen.png": ("custom/rosa-chen_custom.png", None),
    "vikram-iyer.png": (
        "custom/vikram-iyer_custom.png",
        "accessories/glasses-Klaus_Mueller.png",
    ),
}


def main() -> int:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for output_name, (sheet_name, accessory_name) in PORTRAITS.items():
        source_path = CHARACTERS / sheet_name
        with Image.open(source_path) as source:
            if source.width != 96 or source.height != 128:
                raise ValueError(f"unexpected resident sheet dimensions: {source_path}")
            composed = source.convert("RGBA")
            if accessory_name:
                accessory_path = CHARACTERS / accessory_name
                with Image.open(accessory_path) as accessory:
                    if accessory.size != source.size:
                        raise ValueError(
                            f"accessory dimensions do not match resident: {accessory_path}"
                        )
                    composed = Image.alpha_composite(composed, accessory.convert("RGBA"))

            portrait = composed.crop((32, 0, 64, 32))
            portrait = portrait.resize((128, 128), Image.Resampling.NEAREST)
            portrait.save(OUTPUT / output_name, optimize=True)

    print(f"make_resident_portraits: {len(PORTRAITS)} portraits → {OUTPUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
