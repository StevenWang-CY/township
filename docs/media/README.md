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
| [`hero.gif`](hero.gif) | README opening, canvas-only, four beats: the living overview at golden hour, a framed two-shot speaking the recorded Miguel ↔ Esperanza exchange, his recorded flip to Mejia (ring + confetti), then dusk-to-night as windows and lamps come on |
| [`social-preview.png`](social-preview.png) | 1280×640 repository/social card composed from the real town renderer |
| [`demo-player/`](demo-player/) | Map, replay, readable-dialogue timeline, final dashboard, and God's View surfaces from the zero-backend demo |
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
