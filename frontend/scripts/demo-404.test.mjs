import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FALLBACK_HTML, writeDemoFallback } from "./demo-404.mjs";

test("writeDemoFallback writes 404.html into the demo dist", () => {
  const outDir = mkdtempSync(join(tmpdir(), "township-demo-404-"));
  try {
    const target = writeDemoFallback({ outDir });
    assert.equal(target, join(outDir, "404.html"));
    assert.equal(readFileSync(target, "utf8"), FALLBACK_HTML);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("writeDemoFallback refuses a missing dist directory", () => {
  assert.throws(
    () => writeDemoFallback({ outDir: join(tmpdir(), "township-demo-404-missing") }),
    /run the demo build first/,
  );
});

test("fallback page redirects path routes to their hash equivalent", () => {
  // The page must never index, must run its redirect inline (Pages serves it
  // with a 404 status — no server rewrite possible), and must preserve both
  // the query string and the original path as a hash route.
  assert.match(FALLBACK_HTML, /<meta name="robots" content="noindex">/);
  assert.match(FALLBACK_HTML, /\\\.github\\\.io\$/); // project-site base detection
  assert.match(FALLBACK_HTML, /l\.search/); // ?scenario=… survives the hop
  assert.match(FALLBACK_HTML, /"#" \+ route/); // /town/x → #/town/x
  assert.match(FALLBACK_HTML, /l\.replace/); // no history entry for the 404 hop
});
