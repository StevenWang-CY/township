# Township brand

A warm parchment atlas framing a living pixel town: the mark is a 32×32 pixel-art
town hall raising a speech bubble, set in a rounded parchment badge with a 2px gold
border. The wordmark is Cinzel SemiBold (the app's display font), outlined to SVG
paths so it renders identically everywhere — including GitHub READMEs, which load
no external fonts.

## Assets

| File | What it is | Use it for |
|------|-----------|------------|
| `icon.svg` | The emblem as an exact pixel-rect SVG (156 rects, scales infinitely) | Anywhere you need the mark alone |
| `icon-32.png` / `icon-128.png` / `icon-512.png` | Native grid + nearest-neighbor upscales | Contexts that need raster (app stores, social) |
| `wordmark.svg` / `wordmark-dark.svg` | "TOWNSHIP" as paths + gold flourish (light / dark theme) | Text-only branding |
| `lockup.svg` / `lockup-dark.svg` | Icon + wordmark, 419×74 | README header, docs, slides |
| `../../../frontend/public/favicon.svg` (+ `favicon.png`) | Copies of `icon.svg` / `icon-32.png` | Browser tab |

The SVGs deliberately omit `shape-rendering="crispEdges"`: at any multiple of 32px
every rect edge lands exactly on a pixel boundary (perfectly crisp), while at
favicon sizes (16–20px) antialiasing preserves the drawing instead of dropping rows.

## README header snippet

GitHub supports theme-aware images via `<picture>`:

```html
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)"
            srcset="docs/media/brand/lockup-dark.svg">
    <img src="docs/media/brand/lockup.svg" alt="Township" width="420">
  </picture>
</p>
```

For the icon alone, `icon.svg` works on both themes (the parchment badge carries
its own background).

## Palette

Chrome (from `frontend/src/styles/index.css` design tokens):

| Hex | Token / role |
|-----|--------------|
| `#C4A35A` | `--gold-accent` — badge border, entablature, flourish (light) |
| `#D9C48E` | `--gold-light` — border bevel, flourish (dark theme) |
| `#F5EDE0` | `--bg-cream` — parchment field |
| `#EDE4D3` | `--bg-warm` — ground band, grain speckles, wordmark ink (dark theme) |
| `#3A3226` | wordmark ink (light theme) |

Pixels (sampled from `frontend/public/assets/tilesets/rpg-tileset.png`):

| Hex | Role |
|-----|------|
| `#352434` | 1px dark outline (the tileset's outline convention) |
| `#C16F59` / `#954A4D` | terracotta roof, light / shadow |
| `#A7BAB9` / `#94A2A3` / `#7D8188` | stone: steps / wall / side shading |
| `#7ED7FF` + `#FFFFFF` | window glass + sparkle; bubble fill |
| `#E3C654` / `#B79543` | gold doorknob (tileset gold) |
| `#9A7239` / `#704325` | door wood, light / shadow |

## Construction grid

32×32 logical pixels. Badge corners are cut `[4,2,1,1]`; the border is 1px
`#C4A35A` outside, 1px `#D9C48E` bevel inside. The hall: flat-topped pediment
(2px/row slope), gilded entablature, two teal windows, wood door with gold knob,
two stone steps. Legend: `G/g` golds, `P/p` parchment, `O` outline, `R/r` roof,
`S/s/d` stone, `W/w` glass/white, `Y` gold knob, `B/b` wood.

```text
....GGGGGGGGGGGGGGGGGGGGGGGG....
..GGGggggggggggggggggggggggGGG..
.GGgggPPPPPPPPPPPPPPPPPPPPgggGG.
.GggPPPPPPPPPPPPPPPOOOOOOOPPggG.
GGgPPPPPPPPPPPPPPPOwwwwwwwOPPgGG
GggPPPppPPPPPPPPPPOwOwOwOwOPPggG
GgPPPPPPPPPPPPPPPPOwwwwwwwOPPPgG
GgPPPPPPPPPPPPPPPPOwwwwwwwOPPPgG
GgPPPPPPPPPpPPPPPPPOOOOOOOPPPPgG
GgPPPPPPPPPPPPPPPPPOwOPPPPPPPPgG
GgPPPpPPPPPPPPPPPPPPOPPPPPPPPPgG
GgPPPPPPPPPPPPPPPPPPPPPPPPPPPPgG
GgPPPPPPPPPPPOOOOOOPPPPPPPpPPPgG
GgPPPPPPPPPOORRRRRROOPPPPPPPPPgG
GgPPPPPPPOOrRRRRRRRRrOOPPPPPPPgG
GgPPPPPOOrRRRRRRRRRRRRrOOPPPPPgG
GgPPPOOrrrrrrrrrrrrrrrrrrOOPPPgG
GgPPOOOOOOOOOOOOOOOOOOOOOOOOPPgG
GgPPPPOGGGGGGGGGGGGGGGGGGOPPPPgG
GgPPPPOdsOOOOssssssOOOOsdOPPPPgG
GgPPPPOdsOwWOsOOOOsOwWOsdOPPPPgG
GgPPPPOdsOWWOsOBbOsOWWOsdOPPPPgG
GgPPPPOdsOOOOsOBbOsOOOOsdOPPPPgG
GgppppOdssssssOBYOssssssdOppppgG
GgppppOdssssssOBbOssssssdOppppgG
GgppppOdssssssOBbOssssssdOppppgG
GggppOSSSSSSSSSSSSSSSSSSSSOppggG
GGgpOssssssssssssssssssssssOpgGG
.GggppppppppppppppppppppppppggG.
.GGgggppppppppppppppppppppgggGG.
..GGGggggggggggggggggggggggGGG..
....GGGGGGGGGGGGGGGGGGGGGGGG....
```

## Provenance

Composed programmatically (PIL for the pixel grid, fontTools + HarfBuzz for the
type). Cinzel is licensed under the SIL Open Font License; the wordmark embeds
outlines only, no font files. Tile colors are sampled from the vendored
rpg-tileset so the mark lives in the same universe as the town maps.
