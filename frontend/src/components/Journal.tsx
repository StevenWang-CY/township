import { useEffect, useState, useCallback } from "react";
import { useUserProfile } from "../context/UserProfileContext";
import SpritePortrait from "./SpritePortrait";
import TrustBadge from "./TrustBadge";
import { resolveAgentSprite } from "../game/spriteCustomization";
import type { LeanId, TownId, JournalEntry } from "../types/messages";
import { CANDIDATE_NAMES, CANDIDATE_COLORS, TOWN_META } from "../types/messages";

interface JournalProps {
  open: boolean;
  onClose: () => void;
}

export default function Journal({ open, onClose }: JournalProps) {
  const { profile } = useUserProfile();
  const playerId = profile?.playerId;
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const refresh = useCallback(async () => {
    if (!playerId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/journal/${encodeURIComponent(playerId)}`);
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

  if (!open) return null;

  return (
    <>
      <div className="journal-backdrop" onClick={onClose} />
      <aside className="journal-panel" role="dialog" aria-label="Journal">
        <div className="journal-header">
          <h2 className="journal-title">Journal</h2>
          <div className="journal-header-actions">
            <button className="journal-refresh" onClick={refresh} title="Refresh">↻</button>
            <button className="journal-close" onClick={onClose} aria-label="Close journal">×</button>
          </div>
        </div>

        <div className="journal-body">
          {loading && (
            <p className="journal-empty">Loading entries…</p>
          )}
          {!loading && error && (
            <p className="journal-empty">
              Could not load your journal. ({error})
            </p>
          )}
          {!loading && !error && entries.length === 0 && (
            <p className="journal-empty">
              Your journal is empty. Talk to a neighbor to create your first entry.
            </p>
          )}
          {!loading && !error && entries.map((entry, i) => {
            const isOpen = !!expanded[i];
            const sprite = resolveAgentSprite(entry.agent_id);
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

            return (
              <article
                key={`${entry.agent_id}-${i}-${entry.created_at}`}
                className={`journal-entry ${shifted ? "journal-entry--shifted" : ""}`}
              >
                <button
                  className="journal-entry-head"
                  onClick={() => setExpanded((m) => ({ ...m, [i]: !m[i] }))}
                  aria-expanded={isOpen}
                >
                  <SpritePortrait
                    agentId={entry.agent_id}
                    spriteKey={sprite.spriteKey}
                    size={40}
                  />
                  <div className="journal-entry-head-info">
                    <strong className="journal-entry-name">
                      {entry.agent_name || entry.agent_id.replace(/-/g, " ")}
                    </strong>
                    <span className="journal-entry-ts">
                      {entry.town && TOWN_META[entry.town] && (
                        <span
                          className={`town-badge town-badge--${entry.town}`}
                          style={{ marginRight: 6 }}
                        >
                          {TOWN_META[entry.town].name}
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
                          color: trustDelta > 0 ? "#4A9B5C" : "#B85050",
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
                      <span style={{ color: CANDIDATE_COLORS[opBefore] }}>
                        {CANDIDATE_NAMES[opBefore]}
                      </span>{" "}
                      → <span style={{ color: CANDIDATE_COLORS[opAfter] }}>
                        {CANDIDATE_NAMES[opAfter]}
                      </span>
                    </span>
                  )}
                </div>

                {isOpen && (
                  <div className="journal-entry-transcript">
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
