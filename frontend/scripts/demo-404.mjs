#!/usr/bin/env node
/* ── demo-404.mjs ────────────────────────────────────────────
 *
 * Writes dist-demo/404.html — the GitHub Pages SPA fallback for the
 * zero-backend demo player (runs via the `postdemo:build` npm hook, so it
 * never touches the ordinary live build in dist/).
 *
 * The demo uses HashRouter, so every real route lives behind "#/". But
 * path-style deep links still arrive — copied from a live install
 * (/town/randolph), typed by hand, or linked from old posts — and a static
 * host has no server to rewrite them, so GitHub Pages serves this 404 page.
 * The inline script forwards the visitor to the hash-route equivalent:
 *
 *   /<repo>/town/randolph?scenario=x  →  /<repo>/?scenario=x#/town/randolph
 *
 * Project sites (user.github.io/<repo>/…) keep their first path segment;
 * any other host (custom domain, local preview) is treated as site-root.
 * ─────────────────────────────────────────────────────────── */

import { existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

export const FALLBACK_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<title>Township — redirecting…</title>
<script>
(function () {
  var l = window.location;
  // Project Pages live one segment deep (user.github.io/<repo>/…); custom
  // domains and local previews serve from the site root.
  var keep = /\\.github\\.io$/i.test(l.hostname) ? 1 : 0;
  var segments = l.pathname.split("/").filter(Boolean);
  var base = "/" + segments.slice(0, keep).map(encodeURIComponent).join("/");
  if (base !== "/") base += "/";
  var route = "/" + segments.slice(keep).join("/");
  l.replace(base + (l.search || "") + "#" + route);
})();
</script>
</head>
<body>
<noscript>
  <p>This page moved. Open the <a href="/">Township demo</a> instead.</p>
</noscript>
</body>
</html>
`;

export function writeDemoFallback({ outDir = join(FRONTEND_DIR, "dist-demo") } = {}) {
  if (!existsSync(outDir)) {
    throw new Error(`demo-404: ${outDir} does not exist — run the demo build first`);
  }
  const target = join(outDir, "404.html");
  writeFileSync(target, FALLBACK_HTML);
  console.log(`demo-404: wrote ${target}`);
  return target;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    writeDemoFallback();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "demo-404: write failed");
    process.exitCode = 1;
  }
}
