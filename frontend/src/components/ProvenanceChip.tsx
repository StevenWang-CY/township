/* ── ProvenanceChip ──────────────────────────────────────────
 * Header chip saying what the viewer is looking at: a recorded replay (with
 * a popover explaining the artifact and a link to the repo) or the live
 * connection state. The recorded note is always in the accessibility tree.
 * ─────────────────────────────────────────────────────────── */

import { useEffect, useRef, useState } from "react";
import { DEMO_MODE, REPO_URL } from "../demo/demoMode";
import Icon from "./Icon";

interface ProvenanceChipProps {
  connected: boolean;
}

export default function ProvenanceChip({ connected }: ProvenanceChipProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!DEMO_MODE) {
    return (
      <div
        className={`provenance-chip provenance-chip--${connected ? "live" : "offline"}`}
        title={connected ? "Connected to the local simulation server" : "The simulation server is not reachable"}
      >
        <span className="provenance-dot" aria-hidden="true" />
        <span>{connected ? "Live" : "Offline"}</span>
      </div>
    );
  }

  return (
    <div className="provenance" role="note" ref={wrapRef}>
      <button
        type="button"
        className="provenance-chip provenance-chip--recorded"
        aria-expanded={open}
        aria-controls="provenance-note"
        onClick={() => setOpen((o) => !o)}
        title="A recorded simulation, replayed in your browser"
      >
        <span className="provenance-dot" aria-hidden="true" />
        <span>Recorded replay</span>
        <Icon name="chevron-down" size={12} className="provenance-caret" />
      </button>
      <span className="sr-only">
        You're watching a recorded deliberation — a published simulation artifact, replayed locally in your browser.
      </span>
      {open && (
        <div id="provenance-note" className="provenance-popover">
          <p>
            You're watching a <strong>recorded deliberation</strong> — a published simulation artifact, replayed
            locally in your browser. Nothing you do here leaves this page.
          </p>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="provenance-link">
            <Icon name="star" size={13} /> Star Township on GitHub
          </a>
        </div>
      )}
    </div>
  );
}
