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
python3 scripts/mapgen/render_postcards.py --all   # <town>-postcard.png (+@2x) set-piece crops
python3 -m scripts.mapgen.overworld --all          # District Atlas overworld + sites JSON
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
| `build_maps.py` | `MapCanvas` (layers, blob autotiler, stamps, road network, collision + anchor emitters), building recipes (`storefront`, `grand`, `cottage`, `church`, `diner`, `garage`, `shed`), the Map II dressing vocabulary (`vehicle`, `park_stalls`, `porch`, `driveway`, `hedge_line`, `poles`, `signal`, `stop_sign`, `street_blade`, `road_sign`, `bus_shelter`, `desire_path`, `shade`) and its post-passes (`emit_edge_ring`, `emit_ground_shade`, `emit_ground_wear`, `emit_building_shadows`), generic landmark interpreter, `.tmj` writer. See "Map II — density dressing" below. |
| `render_preview.py` | Compositor for generated maps; approximates anchors with registry stamps so previews match the in-game look, in the scenario's season (`--season` overrides; the decision day decides otherwise). |
| `overworld.py` | District-Atlas overworld: a TRUE tilemap render on a 60x38-tile `MapCanvas` (960x608 px, the panel's native size) built from the same registry material as the towns (grass + `GRASS_LIGHT` meadows, `TREE_*` stamps with cast shadows, `WATER_DEEP` shoreline autotiles, the cliff kit, wheat / tilled fields, `township-modern` asphalt with dashes, `PATH_TAN` district roads), with a real mini-town on every site, plus a translucent cloud-shadow layer and the v2 sites JSON (pad rect + walk loop per town). Geography per scenario lives in its `GEOGRAPHY` dict (tile coords); unknown scenarios get a deterministic generic layout. See "Overworld contract". |
| `atlas_towns.py` | The overworld's mini-towns: a shared 12x10 pad frame (building zone, sidewalks, 2-wide main street, asphalt connector to the highway, walk loop) and one signature per shipped town built from the town recipes — station + rail stub + bus, museum + fountain plaza, campus + lot + lake lobe, diner + crop rows, strip + zebra, mill + weir — with a generic pad for anything else. |
| `render_postcards.py` | 14x9-tile (224x144) set-piece crops of every town's `.tmj`, composited like the preview, at 1x and nearest-neighbour 2x; each layout names its crop with `POSTCARD = (tx, ty)`. |
| `layouts/<scenario>/<town>.py` | Optional hand-tuned layout per town; hyphens in both ids become underscores (for example `layouts/nj11_2026/dover.py`). Exports `compose(m)` and the atlas `POSTCARD` crop origin. |
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
  - `kind`: one of `lamp | tree | flower | smoke | water-foam | windmill | label`,
    the civic kinds `yardsign | noticeboard | pollplace | banner | bunting |
    brazier` (see below), or the street kinds `roadsign | signal`
  - `stamp` (trees): registry stamp name, e.g. `tree_light`, `tree_fruit_a`
  - `text` (labels): display text; the object `name` carries the landmark name
  - `text` (roadsign): the destination the runtime letters onto the blank
    green exit sign in a pixel-font chip (`"TO RT 46"`); the anchor stands
    at the sign post like any prop anchor
  - `axis` (signal): `h` or `v` — the traffic axis whose cars the head
    governs. A signal anchor is placed at the CENTRE of the head tile (not
    bottom-centre): the runtime swaps the tile at `floor(x/16)`,
    `floor(y/16)` between `signal_red` and `signal_green`, searching
    `deco-below`, `buildings-top` and `ground-detail`; `emit_traffic` marks
    a junction's stop lines `signal=1` when a head stands within two tiles
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

## Map II — density dressing

The second Map II pass places the kit below so the six towns read as
finished pixel places, and raises building density to at least 14% of the
map in `buildings-base` (`tests/test_mapgen_density.py` guards it, along
with parked vehicles, signed exits, a dressed rim, clean streets, signal
heads, byte-identical rebuilds and full-size previews).

Recipes in `build_maps.py` (all tile-space; every prop a person should not
walk through gets a collision rect; nothing lands on a street, a rail /
river cell, a collision rect, an authored spot or door apron, or under an
existing prop — the recipe skips the cell instead):

| recipe | what it places |
|--------|----------------|
| `vehicle(m, kind, x, y, orient="h", color=None, facing=None)` | one `car` / `pickup` / `bus` / `schoolbus` on deco-below (a low prop), collided; `h` faces east, `v` south, `facing="w"` / `"n"` mirrors it; returns False when the footprint is taken |
| `park_stalls(m, x, y, w, h, orient, landmark="", fill=0.7, surface="concrete", curb="n")` | a lot: 2x1 (h) or 1x2 (v) stalls at a one-cell pitch in `[2][aisle][2]` rhythm, each filled with p=`fill` by a random-colour car (one in eight a pickup) nosed in either way; concrete lots pour with the sidewalks (`m.pave`), asphalt lots join the road mask and get stall stripes on the `curb` side; a bike rack in the SE corner (+ a waiting spot on concrete lots with a landmark) |
| `shadow_rect(m, x, y, w, h)` | queued by every building recipe last; `emit_building_shadows` paints `sh_full` along the south row and east column with `sh_fade_w` / `sh_fade_n` (and their mirrors) at the run ends — after the spots exist, so a shadow never takes a doorstep |
| `garage(m, x, y, roof="cedar", door_dx=0, h=3)` / `shed(m, x, y)` | a 3-wide clapboard garage with the 2x2 `GARAGE_DOOR` (one eave row of shingles on the 3-tall box, ridge + eave with `h=4`); the 2x2 cedar shed. Both reserve, collide and shadow |
| `porch(m, x, y, w, door_x=None)` | a one-row plank deck along a house's apron row (inset a cell each end so yard signs keep their lawn) and a two-tile step below the door — deferred markings, so a later walk does not erase them. `cottage()` adds it from `w >= 6` (`deck=False` opts out) and a `house_num` plaque + `ac_window` from `w >= 5` |
| `driveway(m, x, y, w, h, car=True, car_at=None)` | concrete poured with the sidewalks, a car on it six times in ten |
| `hedge_line(m, x0, y0, x1, y1)` | a straight clipped hedge from the `HEDGE` kit with end caps, a mulch bed on bare grass, one collision rect per run |
| `poles(m, cells, pitch=6)` | utility poles every `pitch` cells along a verge (post on the cell, crossarm above on buildings-top) with `wire_h` / `wire_v` strung between aligned poles on buildings-top — over walkers, never over a street |
| `signal(m, jx0, jy0, jx1, jy1)` | four `SIGNAL` heads on a junction's sidewalk corners (north heads one row up, so no tile hangs over the road) with `signal` anchors; SW + NE heads govern the east-west street, NW + SE the north-south one |
| `stop_sign(m, x, y)` / `street_blade(m, x, y)` / `road_sign(m, x, y, text)` | 1x2 street props: post on deco-below (collided), face on buildings-top; the road sign also emits the `roadsign` anchor |
| `bus_shelter(m, x, y, landmark="")` | the 3x2 glass shelter (roof row on buildings-top) with three `bench`-role waiting spots in front |
| `shade(m, x, y, w, h)` / `MapCanvas.shade_cells` | the lawn's third tone: a `GRASS_DARK` patch over open grass, pouring together with every patch already painted |
| `desire_path(m, a, b)` | a one-wide `WORN` line (4-connected Bresenham) over open grass only |

Post-passes a layout calls at the end of `compose()` (after every building,
prop and tree), in this order:

1. `emit_edge_ring(m, EXITS)` — closes the map with woods: `GRASS_DARK`
   over the outer two cells, small round trees every two cells along the
   top, full canopies elsewhere wherever the canopy hides nothing (else a
   small tree), a big tree every eight cells behind the top row. `EXITS =
   [(side, c, text)]` names every road that leaves the map (`side` n/s/e/w,
   `c` the road segment's first row / column) — each keeps a gap (road +
   sidewalks) through the ring and gets an `EXIT_SIGN` + `roadsign` anchor
   on the outbound driver's right; an undeclared edge road raises.
2. `emit_ground_shade(m)` — shade under tree clusters (three or more trees
   within three cells) and along the north face of every building at least
   five wide; `clover` on 6% of park lawn, `mulch` under planters and
   hedges, `litter` on 4% of shaded cells.
3. `emit_ground_wear(m)` — desire lines from every dwelling's doorstep to
   the nearest pavement when two to six cells of grass separate them, and
   one diagonal across every park between its two farthest entrances.

`build_town` then runs the civic and spot passes, `emit_building_shadows`,
and `emit_traffic`. Buildings that front a street from behind (roof toward
the sidewalk) must leave one grass row above their roof: a recipe reserves
its `y - 1` row, and a reserved cell is skipped by the sidewalk ring and
blocks a neighbour's doorstep spot.

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
assets plus one JSON into `frontend/public/assets/maps/<scenario-id>/`. The
canvas is **60x38 tiles = 960x608 px @1x** — the exact size the atlas panel
shows it at (`width: min(100%, 960px)`, `image-rendering: pixelated`), so one
image pixel is one CSS pixel and the `@2x` file serves retina 1:1.

| File | Contents |
|------|----------|
| `overworld.png` | 960x608 opaque terrain panel (@1x) — a real 60x38-tile map render of 16 px registry tiles, so the material is identical to a town screenshot |
| `overworld@2x.png` | 1920x1216 nearest-neighbour upscale of the same frame |
| `overworld-clouds.png` / `overworld-clouds@2x.png` | translucent cloud-shadow blobs on transparency, **tileable on both axes** — the frontend can wrap-drift the layer freely (respect reduced motion) |
| `overworld-sites.json` | v2 site records: pad rect + walk loop per town |

Every town is a real **mini-town** (`atlas_towns.py`): a 12x10-tile pad with a
2-wide asphalt main street, sidewalks, the town's set-piece composed from the
town recipes (`storefront` / `grand` / `cottage` / `diner`, the modern street
kit, the rpg props) and an asphalt connector bending into the highway. The
shipped signatures: Dover — station house, rail stub along the back, a bus;
Montclair — the museum front and a fountain plaza; Parsippany — campus block,
parking lot, the lake lobe; Randolph — diner and crop rows; Harlow Crossing —
the strip with a zebra set; Millbrook Village — mill on the river with its
weir. Unknown scenarios or towns get a generic pad (two cottages, a shop, a
tree). Per-scenario geography (pads, highway course, river, ridge, lakes,
fields, tan district roads) lives in `overworld.GEOGRAPHY` in tile coordinates.

`overworld-sites.json` schema (pixel values are in the 960x608 @1x space,
`pad` is in tiles; multiply pixels by 2 for the @2x assets):

```json
{
  "version": 2,
  "scenario": "nj11-2026",
  "image":  { "path": "overworld.png", "path2x": "overworld@2x.png",
              "width": 960, "height": 608, "tile": 16 },
  "clouds": { "path": "overworld-clouds.png",
              "path2x": "overworld-clouds@2x.png", "tileable": true },
  "sites": [
    {
      "id": "dover", "town_id": "dover",     // matches scenarios/<id>/towns/<town>.json
      "name": "Dover",                       // display name from the town payload
      "x": 160, "y": 176,                    // pad centre (px)
      "pad": { "x": 4, "y": 6, "w": 12, "h": 10 },   // tile rect of the mini-town
      "walk": [[88, 200], [232, 200], [232, 248], [88, 248], [88, 200]],
      "connector": "e"                       // street end that meets the highway
    }
  ]
}
```

`sites` is sorted by `id` and contains one entry per town in the scenario
package. `pad` is the town's tile rectangle (hang the nameplate at its south
edge); `walk` is a closed polyline in pixels along both sidewalks of the main
street — the frontend's resident figures follow it with `offset-path`. Every
pad contains buildings-base tiles and no tree canopy ever covers a pad, a
connector leg or the highway. Chrome (parchment frame, cartouche, compass,
nameplates, hover cards) belongs to the frontend, never to these PNGs.

## Postcards

`python3 scripts/mapgen/render_postcards.py --all` (also run by `make maps`
after the previews) writes `<town>-postcard.png` (224x144) and
`<town>-postcard@2x.png` (448x288, nearest-neighbour) next to each preview: a
14x9-tile crop of the town's set-piece composited from the `.tmj` exactly like
the preview (ground, ground-detail, deco-below, buildings-base, tree / lamp
anchors, buildings-top). Each layout module exports the crop's top-left tile as
`POSTCARD = (tx, ty)`; a town without one gets the map's centre. The atlas
shows the postcard in the hover card and the town cards, so frame the corner a
visitor should recognise — the station, the museum garden, the lake bridge,
the diner, the crossing, the mill ruins.

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
     `pave()` → buildings (they `reserve()` their cells), lots → `paint_roads()`
     → dressing, trees (anchors), lamps, flowers, street kit, collision
     extras → `emit_edge_ring(m, EXITS)`, `emit_ground_shade(m)`,
     `emit_ground_wear(m)` → labels
   - declare `EXITS` for every road that leaves the map (the ring pass
     raises otherwise) with a real destination on the sign
   - composition rules: roads must connect landmarks and exit the map edge;
     every building door faces a road/path with a small apron; props go in
     CLUSTERS; buildings cover at least 14% of the map (`buildings-base`)
     and every town parks at least four vehicles; give the town one
     memorable set-piece.
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
