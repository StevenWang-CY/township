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
| [`hero.gif`](hero.gif) | README opening, canvas-only, cut from the recorded 21-day NJ-11 campaign: a weekday morning in Dover as commuters leave for work, a recorded conversation between two voices speaking their own lines, a week of the calendar passing as yard signs take colour, election day at the Public Library as residents queue, vote and take their stickers, results night under the bunting, and the district atlas to close. Nothing is staged by hand — every frame is the recording at a real moment (`scripts/capture/campaign.mjs`) |
| [`social-preview.png`](social-preview.png) | 1280×640 repository/social card composed from the real town renderer |
| [`demo-player/`](demo-player/) | Map, replay, readable-dialogue timeline, final dashboard, God's View, decision day at the polling place, the results (bunting, tally at the kiosk), the day in review as a campaign calendar turns (`08-campaign-week.png`), and the roster with its neighbors group open (`09-neighbors.png`) from the zero-backend demo |
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
docker run --rm -v "$PWD":/work -v /work/frontend/node_modules -w /work/frontend --ipc=host \
  mcr.microsoft.com/playwright:v1.61.1-noble bash -lc "npm ci && npm run test:visual"

# (the anonymous volume on frontend/node_modules keeps the container's Linux
#  install from overwriting your host's macOS/Windows node_modules)
# regenerate after an intentional visual change (review the diff before committing)
docker run --rm -v "$PWD":/work -v /work/frontend/node_modules -w /work/frontend --ipc=host \
  mcr.microsoft.com/playwright:v1.61.1-noble bash -lc "npm ci && npm run test:visual:update"
```

Tolerances: 1% of pixels for DOM surfaces, 2% for canvas stills (the world
clock is frozen with `__town.freeze()` before each canvas shot).
