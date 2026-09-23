# scripts/mapgen — Township map generation

Generates Tiled `.tmj` pixel maps for every scenario town from the vendored
16 px ai-town tileset (`frontend/public/assets/tilesets/rpg-tileset.png`)
plus a generated modern extension sheet (`township-modern.png`). Maps are
75x50 tiles (1200x800 px), matching the landmark coordinate space of
`scenarios/<id>/towns/<town>.json`.

## Pipeline

```
make maps                                   # everything below, for every scenario
python3 -m scripts.mapgen.moderntiles
python3 -m scripts.mapgen.build_maps --scenario nj11-2026 --town dover --preview
python3 -m scripts.mapgen.render_preview --scenario nj11-2026 dover --labels
python3 scripts/mapgen/export_window_gids.py   # windowGids.json + stampDefs.json + seasons.json
python3 scripts/mapgen/export_road_gids.py     # roadGids.json (nav-grid ground kinds)
python3 scripts/mapgen/validate_registry.py
```

The first command regenerates the shared `township-modern.png` extension sheet; the
exporters serialize registry facts the frontend must never hardcode (window
panes for the dusk glow, prop stamps for `SceneAmbience` / the civic layer,
sidewalk / road / ballast / lawn GIDs for the walkability grid, the seasonal
colour tables); the last produces the registry acceptance sheet. Town outputs
are always isolated under `frontend/public/assets/maps/<scenario-id>/`:

- `<scenario-id>/<town-id>.tmj` — the map `TownScene` loads
- `<scenario-id>/<town-id>-preview.png` — full-fidelity 1200×800 render
  (all tile layers + anchor approximations + optional faint labels)

## Modules

| File | Role |
|------|------|
| `tiles.py` | Named-GID registry for the rpg tileset: `Blob` autotiles, `TileStamp` multi-tile objects, singles. Read its docstring first. |
| `moderntiles.py` | Draws + quantizes the `township-modern` sheet (asphalt, sidewalk, road markings, street props, shingle-roof / chrome-diner / church / civic kits, and rows 17-29: building shadows, litter, the `GRASS_DARK` / `WORN` ground autotiles, vehicles, hedges, street / suburb kits, set-pieces) and exports the `Blob`s, `TileStamp`s and prop GIDs with `firstgid` 10001. Contact sheet: `_inspect/modern_sheet.png`. See "The township-modern kit" below. |
| `seasons.py` | Seasonal exact-colour LUTs for both sheets (`season_for(date)`, `LUTS`, `apply_lut(image, season)`), sampled from the real tree / grass pixels; exported to `frontend/src/game/seasons.json` by `export_window_gids.py`. |
| `build_maps.py` | `MapCanvas` (layers, blob autotiler, stamps, road network, collision + anchor emitters), building recipes (`storefront`, `grand`, `cottage`, `church`, `diner`), generic landmark interpreter, `.tmj` writer. |
| `render_preview.py` | Compositor for generated maps; approximates anchors with registry stamps so previews match the in-game look. |
| `overworld.py` | District-Atlas overworld: a TRUE tilemap render on a 100x64-tile `MapCanvas` built from the same registry material as the towns (grass + `GRASS_LIGHT` meadows, `TREE_*` stamps with cast shadows, `WATER_DEEP` shoreline autotiles, the cliff kit, `township-modern` asphalt with dashes, `PATH_TAN` connector roads, cobble-pad town clearings), plus a translucent cloud-shadow layer and the town-site coordinates JSON. Geography per scenario lives in its `GEOGRAPHY` dict (tile coords); unknown scenarios get a deterministic generic layout. |
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
    or the civic kinds `yardsign | noticeboard | pollplace | banner | bunting |
    brazier` (see below)
  - `stamp` (trees): registry stamp name, e.g. `tree_light`, `tree_fruit_a`
  - `text` (labels): display text; the object `name` carries the landmark name
  - `mode` (smoke): `hearth` chimneys only smoke at dawn and dusk; anchors
    without a mode (factory stacks) smoke all day
  - `seat` / `home` (yardsign): a stable seat index and the dwelling's landmark
  - `mount` (banner), `span` (bunting): where the runtime hangs civic cloth
  - `spot` anchors (one per standing place, `name` = landmark): `role`
    (`door | porch | window | chat | bench | table | stall | platform | lawn
    | queue`), `facing` (`up | down | left | right | face`), `cap`, `order`
    (unique per landmark; a queue's order is its rank from the door) and,
    for chat pairs, `pair` + `side`. Emitted by `emit_spot_anchors()` from
    the registered building fronts and the `bench()` / `patio()` /
    `market_stall()` / `platform()` layout helpers; the runtime's spot
    registry (`frontend/src/game/Spots.ts`) seats residents on them so a
    crowd never piles on one door.

### Civic anchors (the election made visible)

`emit_civic_anchors()` runs after every layout / generic interpretation and
derives the election's furniture from scenario data instead of hand placement:

| kind | where it comes from | what the runtime does with it |
|------|---------------------|-------------------------------|
| `yardsign` | two lawn cells beside every `cottage()` (one beside a narrow `storefront(yard=True)` row house) | a white sign the town scene tints with the resident's stance once opinions are revealed |
| `noticeboard` | `noticeboard(m, x, y, landmark=…)` in a layout, or one per `park` in the generic interpreter | the round's headlines pinned as pixel sheets, the final tally board |
| `pollplace` + 2 `banner` + `bunting` | the landmark whose town JSON declares `"role": "polling_place"` (fallback: a `civic`-typed landmark, then a name containing "town hall" / "municipal"); the building must have been drawn with `landmark=<name>` so its door is registered | the polling station on decision day (VOTE HERE sign, ballot box, queue rope), facade banners tinted toward the leader, bunting in the winner's color |
| `brazier` | a free lawn cell in the first `park` | lit on results night |

Every recipe (`storefront`, `grand`, `cottage`, `church`, `diner`) accepts
`landmark=` to register its door; cottages and `storefront(yard=True)` are
dwellings. Shingle-roofed recipes also get a `chimney` + hearth smoke anchor.

Tilesets: `rpg-tileset` at `firstgid` 1 (100 cols, 10000 tiles) and
`township-modern` at `firstgid` 10001 (10 cols, 300 tiles). Flip flags follow
the Tiled top-3-bit convention (`tiles.FLIP_H/V/D`, mask with `GID_MASK`).

## The township-modern kit (rows 17-29)

Local ids 0-169 are frozen — the shipped maps reference them and
`tests/test_tilekit.py` pins their pixels to the committed sheet (the eight
ground props `hydrant`, `mailbox`, `trash_bin`, `planter_box`, `newsbox`,
`bench_h`, `bollard`, `brazier` carry a 2 px ordered-dither contact shadow;
only their translucent pixels may differ). New material is registered in
`moderntiles.IDS` in these blocks (`IDS` is asserted unique and in range at
import):

| ids | block | exports |
|-----|-------|---------|
| 170-173 | building shadows `sh_full`, `sh_fade_n`, `sh_fade_w`, `sh_corner` (translucent `SHADOW` ink, alpha 64; overlay on deco-below along a building's south row / east column, fades soften the far edge, the corner is the SE quarter) | singles |
| 174-179 | ground litter `clover_a/b`, `litter_a/b` (transparent), `mulch_a/b` (opaque bark bed) | singles |
| 180-195 | `GRASS_DARK` autotile: the sampled `R.GRASS` pixels darkened ~12% and cooled (the one block exempt from palette quantization, `NO_QUANTIZE`), 4 px ordered-dither edges back into plain grass; fill x4, edges, convex corners, 4 hole fillets | `Blob GRASS_DARK` |
| 196-207 | `WORN` autotile: trodden tan dirt under sparse grass tufts, dithered edges; fill x4, edges, corners (no holes) | `Blob WORN` |
| 210-242 | vehicles: `car_{red,blue,white,silver,green}_{h,v}_{a,b}` (h faces east, v faces south; `a` = front tile), `pickup_{h,v}_{a,b}`, `bus_{h,v}_{a,b,c}` (NJ Transit-like white / blue), `schoolbus_h_{a,b,c}` | `CAR_H[color]`, `CAR_V[color]`, `PICKUP_H/V`, `BUS_H/V`, `SCHOOLBUS_H` |
| 243-252 | hedge line pieces: `hedge_h/v`, ends `w/e/n/s`, corners `nw/ne/sw/se` | `HEDGE = {"h", "v", "end_*", "corner_*"}` (1x1 stamps, keyed like `R.FENCE_WOOD`) |
| 253-262 | street kit: `pole_top/base`, `wire_h/v` (1 px wires: horizontal at the insulator row, vertical under both insulators), `signal_red/green`, `signal_pole`, `stop_top`, `sign_post`, `blade_top` | `POLE`, `SIGNAL`, `SIGNAL_GREEN`, `STOP_SIGN`, `STREET_BLADE` (all 1x2) |
| 263-273 | suburb kit: `steps`, `house_num`, `ac_window` (transparent overlays), `garage_door_*` (2x2, opaque stone surround like `WINDOW`), `shed_*` (2x2, cedar roof over clapboard) | `GARAGE_DOOR`, `SHED` |
| 274-291 | set-pieces: `shelter_rc` 3x2 (glass shelter with a bench), `backstop_rc` 3x2 (chain-link, see-through), `fountain_*` 2x2, `exit_sign_t/b` 1x2 (blank face — the runtime letters it) | `SHELTER`, `BACKSTOP`, `FOUNTAIN`, `EXIT_SIGN` |
| 292-294 | `bike_a/b` (leaning bicycles), `bike_rack` (hoops); 295-299 are free | `BIKE_RACK`, singles |

`KIT_STAMPS` collects every multi-tile stamp above by export name — that is
what `export_window_gids.py` writes into `stampDefs.json` (`stamps` +
`singles`). `export_road_gids.py` puts every `WORN` gid in the `sidewalk`
class and every `GRASS_DARK` gid in the `grass` class (`crosswalk` / `road` /
`rough` are unchanged). The contact sheet's KIT STRIP shows all of it
assembled; `python3 -m scripts.mapgen.moderntiles` rewrites both.

### Seasons

`seasons.py` reads the exact canopy greens and fruit colours of the rpg tree
stamps, the `R.GRASS` / `R.GRASS_LIGHT` fills and `GRASS_DARK` out of the two
PNGs and derives one exact-colour LUT per season: spring (fresh yellow-green,
fruit to blossom), summer (identity), autumn (amber / rust / olive canopies,
olive grass), winter (desaturated canopies, straw grass). Hedges and planters
deliberately reuse the canopy greens so they turn with the trees; signs, lamps
and car paint use greens off the LUT so they do not. `seasons.json` carries
`{"seasons": {name: [[from, to], ...]}, "byMonth": [...]}` for a runtime remap
of both sheets.

## Overworld contract (District Atlas)

`python3 -m scripts.mapgen.overworld --scenario <id>` (or `--all`) writes four
assets plus one JSON into `frontend/public/assets/maps/<scenario-id>/`:

| File | Contents |
|------|----------|
| `overworld.png` | 1600x1024 opaque terrain panel (@1x) — a real 100x64-tile map render of 16 px registry tiles, so the material is identical to a town screenshot |
| `overworld@2x.png` | 3200x2048 nearest-neighbour upscale of the same frame |
| `overworld-clouds.png` / `overworld-clouds@2x.png` | translucent cloud-shadow blobs on transparency, **tileable on both axes** — the frontend can wrap-drift the layer freely (respect reduced motion) |
| `overworld-sites.json` | town-site coordinates for vignette/pin placement |

`overworld-sites.json` schema (all pixel values are in the 1600x1024 @1x
space; multiply by 2 for the @2x assets):

```json
{
  "version": 1,
  "scenario": "nj11-2026",
  "image":  { "path": "overworld.png", "path2x": "overworld@2x.png",
              "width": 1600, "height": 1024 },
  "clouds": { "path": "overworld-clouds.png",
              "path2x": "overworld-clouds@2x.png", "tileable": true },
  "sites": [
    {
      "town_id": "dover",            // matches scenarios/<id>/towns/<town>.json
      "name": "Dover",               // display name from the town payload
      "x": 320, "y": 416,            // clearing center — put the vignette here
      "clearing": { "rx": 64, "ry": 48 }  // cobble-pad radii around it (px)
    }
  ]
}
```

`sites` is sorted by `town_id` and contains one entry per town in the
scenario package. Each clearing is a flat plaza-cobble pad (~8x6 tiles) with
a tan apron, guaranteed free of trees, props, and water (connector roads end
at its rim), so a vignette of `2*rx x 2*ry` or smaller never covers terrain
features that matter. Chrome (parchment frame, cartouche, compass, pins,
hover cards) belongs to the frontend, never to these PNGs.

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
`township-modern` adds), and it has no pitched roofs, diners, or churches —
those come from the `township-modern` kits (`shingle_stamp`, `diner_row`,
and the church tiles the `church` recipe composes: steeple + belfry +
lancets + arched door in clapboard/stone variants). The stone bridge is
horizontal-only (flip for vertical). Some sibling prop tiles in the raw
sheet are fully transparent — the registry already excludes them; never
reach around `tiles.py` for raw GIDs.
