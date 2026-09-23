# Product media

This directory is the curated visual record of Township. Every capture is
generated from the real product—never from a mockup. The demo-build set comes
from the committed replay caches:

```bash
make capture-setup   # once
make capture-media
```

The `live/` set needs a running mock stack (backend :8001, Vite :5273) and is
reproduced with `node scripts/capture/live-shots.mjs`.

| Artifact | Purpose |
|---|---|
| [`hero.gif`](hero.gif) | README opening, canvas-only, five beats: the living overview at golden hour, a framed two-shot speaking the recorded Miguel ↔ Esperanza exchange, his recorded flip to Mejia (ring + confetti), decision day at the Public Library as the recorded decide phase plays paced — the polling place opens and residents queue, vote and take their stickers, then the results bunting — and dusk-to-night as windows and lamps come on |
| [`social-preview.png`](social-preview.png) | 1280×640 repository/social card composed from the real town renderer |
| [`demo-player/`](demo-player/) | Map, replay, readable-dialogue timeline, final dashboard, God's View, decision day at the polling place, and the results (bunting, tally at the kiosk) from the zero-backend demo |
| [`scene/`](scene/) | Day/night coverage for every shipped town, plus the District Atlas pixel overworld for both scenarios |
| [`live/`](live/) | Live-backend surfaces: resident chat, a God's View injection before/after, the dashboard mid-run, and the narrative recap card |
| [`mobile/`](mobile/) | 390×844 map and town checks |
| [`brand/`](brand/) | Reusable Township lockups and marks |
| [`residents/`](residents/) | Nearest-neighbor crops of the real in-game resident sheets used by the README cast strip |

The capture script treats missing residents, browser/network errors, and an
incorrect final dashboard as failures. Replay content is deterministic, while
browser animation timing can move ambient pixels between captures. CI
separately exercises keyboard use, mobile overflow, replay seeking, and WCAG
A/AA checks. Review generated pixels before committing: reproducible inputs make a
regression diagnosable, not automatically beautiful.

Upstream art provenance and licenses are recorded in
[`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md).


## Visual baselines

`frontend/e2e/visual.spec.ts` snapshots the atlas, the town by day and night,
the results moment, the dashboard at the end of the replay, and the phone
town, at 1× and 2× device pixels. Fonts and GPU rasterisation differ per
machine, so the baselines under `frontend/e2e/__snapshots__/` are rendered
only inside the Playwright container, and the spec is skipped locally unless
`VISUAL=1` is set.

```bash
# from the repository root — compare against the committed baselines
docker run --rm -v "$PWD":/work -w /work/frontend --ipc=host \
  mcr.microsoft.com/playwright:v1.61.1-noble bash -lc "npm ci && npm run test:visual"

# regenerate after an intentional visual change (review the diff before committing)
docker run --rm -v "$PWD":/work -w /work/frontend --ipc=host \
  mcr.microsoft.com/playwright:v1.61.1-noble bash -lc "npm ci && npm run test:visual:update"
```

Tolerances: 1% of pixels for DOM surfaces, 2% for canvas stills (the world
clock is frozen with `__town.freeze()` before each canvas shot).
