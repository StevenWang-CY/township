# Product media

This directory is the curated visual record of Township's zero-backend demo.
Every product capture is generated from the committed replay caches—never from
a mockup—and can be reproduced with:

```bash
make capture-setup   # once
make capture-media
```

| Artifact | Purpose |
|---|---|
| [`hero.gif`](hero.gif) | README opening sequence inside the living town: residents out at golden hour, two neighbors meeting to talk it over, then dusk and a lamplit night |
| [`social-preview.png`](social-preview.png) | 1280×640 repository/social card composed from the real town renderer |
| [`demo-player/`](demo-player/) | Map, replay, timeline, final dashboard, and God's View product surfaces |
| [`scene/`](scene/) | Reproducible day/night scene coverage for every shipped town |
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
