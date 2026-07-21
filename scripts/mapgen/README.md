# scripts/mapgen — Township map generation

Generates Tiled `.tmj` pixel maps for every scenario town from the vendored
16 px ai-town tileset (`frontend/public/assets/tilesets/rpg-tileset.png`)
plus a generated modern extension sheet (`township-modern.png`). Maps are
75x50 tiles (1200x800 px), matching the landmark coordinate space of
`scenarios/<id>/towns/<town>.json`.

## Pipeline

```
python3 -m scripts.mapgen.moderntiles
python3 -m scripts.mapgen.build_maps --scenario nj11-2026 --town dover --preview
python3 -m scripts.mapgen.render_preview --scenario nj11-2026 dover --labels
python3 scripts/mapgen/validate_registry.py
```

The first command regenerates the shared `township-modern.png` extension sheet; the
last produces the registry acceptance sheet. Town outputs are always isolated under
`frontend/public/assets/maps/<scenario-id>/`:

- `<scenario-id>/<town-id>.tmj` — the map `TownScene` loads
- `<scenario-id>/<town-id>-preview.png` — full-fidelity 1200×800 render
  (all tile layers + anchor approximations + optional faint labels)

## Modules

| File | Role |
|------|------|
| `tiles.py` | Named-GID registry for the rpg tileset: `Blob` autotiles, `TileStamp` multi-tile objects, singles. Read its docstring first. |
| `moderntiles.py` | Draws + quantizes the `township-modern` sheet (asphalt, sidewalk, road markings, street props) and exports `ASPHALT` / `SIDEWALK` blobs and prop GIDs with `firstgid` 10001. Contact sheet: `_inspect/modern_sheet.png`. |
| `build_maps.py` | `MapCanvas` (layers, blob autotiler, stamps, road network, collision + anchor emitters), building recipes (`storefront`, `grand`, `cottage`), generic landmark interpreter, `.tmj` writer. |
| `render_preview.py` | Compositor for generated maps; approximates anchors with registry stamps so previews match the in-game look. |
| `layouts/<scenario>/<town>.py` | Optional hand-tuned layout per town; hyphens in both ids become underscores (for example `layouts/nj11_2026/dover.py`). |
| `validate_registry.py`, `inspect_tiles.py` | Registry acceptance sheet and raw tileset inspection tools. |

## Layer contract (TownScene binds to these names)

Tile layers, in draw order:

1. `ground` — base terrain (grass fill; never empty)
2. `ground-detail` — roads, sidewalks, paths, plazas, platforms, rail bed
3. `deco-below` — props agents walk in front of (stalls, planters, crops…)
4. `buildings-base` — walls, doors, windows (drawn below agents)
5. `buildings-top` — what agents walk BEHIND: roof rows, awnings, banners

Object layers:

- `collision` — rectangles in px; blocked cells for agent movement
- `anchors` — point objects TownScene turns into live sprites. `x/y` is the
  sprite's bottom-center. String properties:
  - `kind`: one of `lamp | tree | flower | smoke | water-foam | windmill | label`
  - `stamp` (trees): registry stamp name, e.g. `tree_light`, `tree_fruit_a`
  - `text` (labels): display text; the object `name` carries the landmark name

Tilesets: `rpg-tileset` at `firstgid` 1 (100 cols, 10000 tiles) and
`township-modern` at `firstgid` 10001. Flip flags follow the Tiled top-3-bit
convention (`tiles.FLIP_H/V/D`, mask with `GID_MASK`).

## Adding a town

1. Make sure `scenarios/<id>/towns/<town>.json` exists — landmarks are the
   source of truth (px in a 1200x800 space; never edit them from here).
2. Run:

   ```bash
   python3 -m scripts.mapgen.build_maps --scenario <id> --town <town> --preview
   ```

   Without a layout module the generic interpreter builds roads
   from `road` landmarks and default recipes per landmark `type`
   (`commercial/building`, `church`, `civic`, `transport`, `housing`,
   `park`, `water`, `road`).
3. Point the town payload at the generated assets with the exact
   scenario-qualified metadata contract:

   ```json
   {
     "map": {
       "kind": "tiled",
       "path": "assets/maps/<id>/<town>.tmj",
       "preview_path": "assets/maps/<id>/<town>-preview.png"
     }
   }
   ```

   The scenario loader rejects a different scenario namespace or filename. Omit
   `map` entirely when the town should use the landmark-driven procedural renderer.
4. For a hand-tuned map, add
   `scripts/mapgen/layouts/<id_with_underscores>/<town_with_underscores>.py`
   exporting `compose(m: MapCanvas)`. Follow `layouts/nj11_2026/dover.py`:
   - order matters: ground tone → large ground features → `road_h/road_v` +
     `pave()` → buildings (they `reserve()` their cells) → `paint_roads()`
     → dressing, trees (anchors), lamps, flowers, collision extras
   - composition rules: roads must connect landmarks and exit the map edge;
     every building door faces a road/path with a small apron; props go in
     CLUSTERS; keep >= 30% open grass; give the town one memorable
     set-piece.
5. Iterate: re-render the preview after every change and actually look at
   it at native size and a crisp 2× browser zoom. Compare against
   `_inspect/example_map_render.png` for cohesion.

## Adding a scenario

Nothing map-specific is registered in code. Run:

```bash
python3 -m scripts.mapgen.build_maps --scenario <id> --all --preview
```

The command walks `scenarios/<id>/towns/*.json`, validates lowercase
hyphen-separated scenario/town ids, and writes only inside that scenario's asset
namespace. Add the exact `map` block above to each town that should load authored
art; towns without it retain the procedural renderer.

## Capability limits (do not fight the tileset)

No modern vehicles/asphalt art exists in the rpg sheet (that is what
`township-modern` adds), and there are no pitched-roof houses: buildings are
composed as facade strips + flat deck/stone-pad roofs. The stone bridge is
horizontal-only (flip for vertical). Some sibling prop tiles in the raw
sheet are fully transparent — the registry already excludes them; never
reach around `tiles.py` for raw GIDs.
