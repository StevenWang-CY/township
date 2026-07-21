/* ── App-root URL resolution ─────────────────────────────────
 *
 * The GitHub Pages demo build ships with a RELATIVE Vite base (`--base ./`)
 * so the bundle works under any sub-path (e.g. /township/). A relative base
 * means naive absolute references like "/assets/x.png" would escape the
 * deployment prefix and 404.
 *
 * APP_ROOT is resolved ONCE at module-evaluation time — which happens on the
 * initial page load, before any client-side navigation — so every static
 * file URL stays anchored to the app's deploy root no matter what route the
 * SPA has since navigated to.
 *
 * In dev / same-origin backend builds BASE_URL is "/" and this collapses to
 * plain origin-absolute URLs — zero behavior change.
 * ─────────────────────────────────────────────────────────── */

const APP_ROOT = new URL(import.meta.env.BASE_URL || "/", window.location.href).href;

/** Absolute URL for a static file served from the app root.
 *  Accepts "assets/x.png" or "/assets/x.png" — both resolve under APP_ROOT. */
export function appUrl(path: string): string {
  return new URL(path.replace(/^\/+/, ""), APP_ROOT).href;
}
