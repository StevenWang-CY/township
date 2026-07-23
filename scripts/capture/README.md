# Product-media capture

`capture.mjs` drives Township's recorded demo with Playwright and writes the
launch media under `docs/media/`. It uses fixed-seed `?capture=1` TownScene
controls, the product's ephemeral demo guest, and committed replay caches; it
does not call an LLM or read credentials. The same command also crops the README
resident strip from the exact front-facing frames used by the game. Browser
animation timing can change individual pixels between runs, so generated images
still require review.

From the repository root:

```bash
make capture-setup   # once: install Playwright's Chromium
make capture-media   # build demo, capture surfaces, assemble docs/media/hero.gif
```

The capture fails on missing residents, console/page errors, failed requests,
HTTP errors, an incorrect final dashboard, or a README GIF over 8 MiB. Review
every generated image before committing it—this is a visual QA tool, not a
substitute for visual judgment. Set `TOWNSHIP_KEEP_FRAMES=1` to keep the raw
hero frames for frame-by-frame review.

`live-shots.mjs` covers the surfaces a static demo cannot: resident chat, a
God's View injection (before/after), the dashboard mid-run, and the recap card.
It needs the zero-key live stack running first — `LLM_PROVIDER=mock uvicorn
backend.main:app --port 8001` plus `npx vite --port 5273` in `frontend/` — and
writes to `docs/media/live/`. `TOWNSHIP_LIVE_ONLY=chat|dashboard|gods` reshoots
a single surface.
