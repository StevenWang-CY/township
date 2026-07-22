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
substitute for visual judgment.
