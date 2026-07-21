import { useEffect, useState, useCallback, useRef } from "react";
import { useUserProfile } from "../context/UserProfileContext";
import SpritePortrait from "./SpritePortrait";
import TrustBadge from "./TrustBadge";
import type { LeanId, JournalEntry } from "../types/messages";
import { useScenario } from "../hooks/useScenario";
import { DEMO_MODE, REPO_URL } from "../demo/demoMode";
import { readableInk } from "../lib/color";
import {
  playerCapabilityHeaders,
  registerPlayerCapability,
} from "../lib/playerCapability";

interface JournalProps {
  open: boolean;
  onClose: () => void;
}

export default function Journal({ open, onClose }: JournalProps) {
  const { profile } = useUserProfile();
  const { townMeta, optionColor, optionLabel } = useScenario();
  const playerId = profile?.playerId;
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const panelRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const refresh = useCallback(async () => {
    if (DEMO_MODE) {
      setEntries([]);
      setLoading(false);
      setError(null);
      return;
    }
    if (!playerId) return;
    setLoading(true);
    setError(null);
    try {
      if (!await registerPlayerCapability(playerId)) {
        throw new Error("Private journal access could not be established.");
      }
      const res = await fetch(`/api/journal/${encodeURIComponent(playerId)}`, {
        headers: playerCapabilityHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items = Array.isArray(data?.entries) ? (data.entries as JournalEntry[]) : [];
      // newest first
      setEntries(items.slice().reverse());
    } catch (e: any) {
      setError(e?.message || "Could not load journal.");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [playerId]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    requestAnimationFrame(() => closeButtonRef.current?.focus());

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      const previous = previousFocusRef.current;
      if (previous?.isConnected) requestAnimationFrame(() => previous.focus());
    };
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div className="journal-backdrop" onClick={onClose} aria-hidden="true" />
      <aside
        id="journal-panel"
        ref={panelRef}
        className="journal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="journal-title"
      >
        <div className="journal-header">
          <h2 id="journal-title" className="journal-title">Journal</h2>
          <div className="journal-header-actions">
            {!DEMO_MODE && (
              <button
                className={`journal-refresh${loading ? " journal-refresh--loading" : ""}`}
                onClick={refresh}
                title="Refresh journal"
                aria-label="Refresh journal"
                disabled={loading}
              >
                ↻
              </button>
            )}
            <button ref={closeButtonRef} className="journal-close" onClick={onClose} aria-label="Close journal">×</button>
          </div>
        </div>

        <div className="journal-body">
          {loading && (
            <div className="journal-state" role="status" aria-live="polite">
              <span className="journal-state-mark journal-state-mark--loading" aria-hidden="true" />
              <strong>Opening your journal</strong>
              <span>Gathering the conversations you’ve saved.</span>
            </div>
          )}
          {!loading && error && (
            <div className="journal-state journal-state--error" role="alert">
              <span className="journal-state-mark" aria-hidden="true">!</span>
              <strong>Journal unavailable</strong>
              <span>We couldn’t reach your saved conversations.</span>
              <small>{error}</small>
              <button type="button" onClick={refresh}>Try again</button>
            </div>
          )}
          {!loading && !error && entries.length === 0 && DEMO_MODE && (
            <div className="journal-state journal-state--demo">
              <span className="journal-state-mark" aria-hidden="true">◇</span>
              <strong>This replay keeps no personal history</strong>
              <span>
                The hosted demo is read-only and stores neither conversations nor a profile.
                Run Township locally to talk with residents and build your private session journal.
              </span>
              <a href={REPO_URL} target="_blank" rel="noreferrer">Run Township locally</a>
            </div>
          )}
          {!loading && !error && entries.length === 0 && !DEMO_MODE && (
            <div className="journal-state">
              <span className="journal-state-mark" aria-hidden="true">＋</span>
              <strong>Your first page is waiting</strong>
              <span>Talk with a neighbor and the conversation will be kept here.</span>
            </div>
          )}
          {!loading && !error && entries.map((entry, i) => {
            const isOpen = !!expanded[i];
            const trustBefore = entry.trust_before ?? 0;
            const trustAfter = entry.trust_after ?? 0;
            const trustDelta = trustAfter - trustBefore;
            const opBefore = entry.opinion_before?.candidate as LeanId | undefined;
            const opAfter = entry.opinion_after?.candidate as LeanId | undefined;
            const shifted = opBefore && opAfter && opBefore !== opAfter;
            const date = new Date(entry.created_at);
            const dateStr = isNaN(date.getTime())
              ? entry.created_at
              : date.toLocaleString();
            const displayName = entry.agent_name || entry.agent_id.replace(/-/g, " ");
            const entryTown = entry.town ? townMeta(entry.town) : null;
            const fallbackInitials = displayName
              .split(/\s+/)
              .filter(Boolean)
              .map((word) => word[0])
              .join("")
              .toUpperCase()
              .slice(0, 2);

            return (
              <article
                key={`${entry.agent_id}-${i}-${entry.created_at}`}
                className={`journal-entry ${shifted ? "journal-entry--shifted" : ""}`}
              >
                <button
                  className="journal-entry-head"
                  onClick={() => setExpanded((m) => ({ ...m, [i]: !m[i] }))}
                  aria-expanded={isOpen}
                  aria-controls={`journal-transcript-${i}`}
                >
                  <SpritePortrait
                    agentId={entry.agent_id}
                    fallbackInitials={fallbackInitials}
                    color={entryTown?.color}
                    ringColor={opAfter ? optionColor(opAfter) : undefined}
                    size={40}
                  />
                  <div className="journal-entry-head-info">
                    <strong className="journal-entry-name">
                      {displayName}
                    </strong>
                    <span className="journal-entry-ts">
                      {entry.town && (
                        <span
                          className="town-badge"
                          style={{
                            marginRight: 6,
                            color: readableInk(townMeta(entry.town).color),
                            background: `color-mix(in srgb, ${townMeta(entry.town).color} 15%, white)`,
                          }}
                        >
                          {townMeta(entry.town).name}
                        </span>
                      )}
                      {dateStr}
                    </span>
                  </div>
                  <TrustBadge trust={trustAfter} size="small" />
                  <span className="journal-entry-caret" aria-hidden>
                    {isOpen ? "▾" : "▸"}
                  </span>
                </button>

                <div className="journal-entry-meta">
                  <span className="journal-entry-meta-item">
                    Trust:{" "}
                    <strong>{trustBefore} → {trustAfter}</strong>{" "}
                    {trustDelta !== 0 && (
                      <span
                        style={{
                          color: trustDelta > 0 ? "var(--color-success)" : "var(--color-danger)",
                          fontWeight: 600,
                        }}
                      >
                        ({trustDelta > 0 ? "+" : ""}{trustDelta})
                      </span>
                    )}
                  </span>
                  {opBefore && opAfter && (
                    <span className="journal-entry-meta-item">
                      Opinion:{" "}
                      <span style={{ color: readableInk(optionColor(opBefore)) }}>
                        {optionLabel(opBefore)}
                      </span>{" "}
                      → <span style={{ color: readableInk(optionColor(opAfter)) }}>
                        {optionLabel(opAfter)}
                      </span>
                    </span>
                  )}
                </div>

                {isOpen && (
                  <div id={`journal-transcript-${i}`} className="journal-entry-transcript">
                    {entry.transcript.length === 0 && (
                      <p className="journal-empty" style={{ padding: 0 }}>
                        No messages recorded.
                      </p>
                    )}
                    {entry.transcript.map((m, j) => (
                      <div
                        key={j}
                        className={`journal-line journal-line--${m.role}`}
                      >
                        <span className="journal-line-role">
                          {m.role === "user" ? "You" : m.role}
                        </span>
                        <span className="journal-line-content">{m.content}</span>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </aside>
    </>
  );
}
