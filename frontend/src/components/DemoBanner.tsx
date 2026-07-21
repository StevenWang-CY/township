/* ── DemoBanner ──────────────────────────────────────────────
 * Slim dismissible ribbon under the header in demo mode: says what the
 * visitor is watching and points at the GitHub repo. Dismissal persists for
 * the session only — a fresh visit gets the context again.
 * ─────────────────────────────────────────────────────────── */

import { useState } from "react";
import { REPO_URL } from "../demo/demoMode";

const DISMISS_KEY = "township-demo-banner-dismissed";

export default function DemoBanner() {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  if (dismissed) return null;

  return (
    <div className="demo-banner" role="note">
      <span className="demo-banner-text">
        You're watching a <strong>recorded deliberation</strong> — a published simulation artifact, replayed locally in your browser.
      </span>
      <a
        className="demo-banner-star"
        href={REPO_URL}
        target="_blank"
        rel="noreferrer"
        aria-label="Star Township on GitHub"
      >
        ★ GitHub
      </a>
      <button
        className="demo-banner-dismiss"
        onClick={() => {
          setDismissed(true);
          try {
            sessionStorage.setItem(DISMISS_KEY, "1");
          } catch { /* ignore */ }
        }}
        aria-label="Dismiss banner"
      >
        ×
      </button>
    </div>
  );
}
