"""Scenario-qualified map generation and path-safety regressions."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts.mapgen import build_maps, render_preview


def _write_custom_town(root: Path, scenario: str, town: str) -> None:
    path = root / "scenarios" / scenario / "towns" / f"{town}.json"
    path.parent.mkdir(parents=True)
    path.write_text(
        json.dumps(
            {
                "name": "A Different Dover",
                "accent_color": "#456789",
                "demographics": {"population": 1000},
                "landmarks": [
                    {
                        "name": "Community Hall",
                        "x": 320,
                        "y": 240,
                        "width": 180,
                        "height": 120,
                        "type": "civic",
                        "color": "#456789",
                        "description": "A generic custom landmark.",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )


def test_custom_scenario_reusing_dover_gets_generic_namespaced_map(tmp_path, monkeypatch):
    _write_custom_town(tmp_path, "custom-choice", "dover")
    monkeypatch.setattr(build_maps, "REPO_ROOT", tmp_path)

    output = build_maps.build_town("custom-choice", "dover", tmp_path / "maps")

    assert output == tmp_path / "maps" / "custom-choice" / "dover.tmj"
    document = json.loads(output.read_text(encoding="utf-8"))
    assert [tileset["image"] for tileset in document["tilesets"]] == [
        "../../tilesets/rpg-tileset.png",
        "../../tilesets/township-modern.png",
    ]
    # The bundled NJ adapter is scenario-qualified; the custom package cannot
    # import it merely by choosing the same town id.
    assert build_maps._layout_module("custom-choice", "dover") is None
    assert build_maps._layout_module("nj11-2026", "dover").__name__.endswith(
        "layouts.nj11_2026.dover"
    )


@pytest.mark.parametrize(
    ("scenario", "town"),
    [
        ("../escape", "dover"),
        ("nj11-2026", "../../escape"),
        ("/tmp/absolute", "dover"),
        ("nj11-2026", "/tmp/absolute"),
    ],
)
def test_map_builder_rejects_traversal_and_absolute_ids(tmp_path, scenario, town):
    with pytest.raises(ValueError, match="lowercase letters"):
        build_maps.build_town(scenario, town, tmp_path / "maps")
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize("value", ["../escape", "/tmp/absolute", "UPPER", "two--hyphens"])
def test_preview_renderer_rejects_unsafe_ids_before_io(value):
    with pytest.raises(ValueError, match="lowercase letters"):
        render_preview.render(value, scenario="nj11-2026")
