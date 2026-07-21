/* ── Demo mode ───────────────────────────────────────────────
 *
 * VITE_DEMO_MODE=1 (the `npm run demo:build` flag) turns the app into the
 * zero-backend replay player deployed to GitHub Pages: the WebSocket provider
 * is swapped for a recorded event feed, backend-only affordances (chat send,
 * mic, TTS, God's View injection, Start Simulation) become gentle pointers at
 * the local zero-key install, and the DemoTimeline media bar drives playback.
 *
 * Everything demo-specific keys off this ONE flag so tree-shaken production
 * builds carry no demo chrome.
 * ─────────────────────────────────────────────────────────── */

import { appUrl } from "../lib/assetUrl";

export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "1";

export const REPO_URL = "https://github.com/StevenWang-CY/township";

/** The one-line pointer used wherever a live-backend feature is gated. */
export const INSTALL_HINT = "Live chat needs the local install — zero keys required.";

/** URL of a staged demo file (see frontend/scripts/stage-demo.mjs). */
export function demoUrl(file: string): string {
  return appUrl(`demo/${file}`);
}

/** Manifest written by stage-demo.mjs listing every staged scenario. */
export interface DemoManifest {
  default: string;
  scenarios: string[];
}

/** `?scenario=<id>` runtime override (validated to a safe slug). */
export function requestedScenarioId(): string | null {
  try {
    const q = new URLSearchParams(window.location.search).get("scenario");
    return q && /^[a-zA-Z0-9_-]+$/.test(q) ? q : null;
  } catch {
    return null;
  }
}

/** Pick the active demo scenario: URL override when staged, else the default. */
export function resolveDemoScenarioId(manifest: DemoManifest): string {
  const wanted = requestedScenarioId();
  if (wanted && manifest.scenarios.includes(wanted)) return wanted;
  return manifest.default;
}
