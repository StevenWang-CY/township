import { useEffect, useState, useCallback } from "react";
import { TRUST_BAND, type Relationship } from "../types/messages";

/* ── Storage helpers ───────────────────────────────────────── */

const STORAGE_KEY_PREFIX = "township-relationships-";

function readCached(playerId: string): Record<string, Relationship> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + playerId);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as Record<string, Relationship>;
  } catch {
    /* ignore */
  }
  return {};
}

function writeCached(playerId: string, data: Record<string, Relationship>) {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + playerId, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

/* ── Hook ──────────────────────────────────────────────────── */

interface UseRelationshipsOptions {
  /** Live relationships from WS state — preferred source of truth. */
  liveRelationships?: Record<string, Relationship>;
}

export function useRelationships(
  playerId: string | undefined,
  opts: UseRelationshipsOptions = {}
) {
  const [relationships, setRelationships] = useState<Record<string, Relationship>>(
    () => (playerId ? readCached(playerId) : {})
  );

  // Re-hydrate from localStorage when playerId changes
  useEffect(() => {
    if (!playerId) return;
    setRelationships(readCached(playerId));
  }, [playerId]);

  // Initial fetch from backend
  useEffect(() => {
    if (!playerId) return;
    let cancelled = false;
    fetch(`/api/chat/relationships/${playerId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const incoming: Record<string, Relationship> =
          (data.relationships as Record<string, Relationship>) ??
          (data as Record<string, Relationship>);
        if (incoming && typeof incoming === "object") {
          setRelationships((prev) => {
            const merged = { ...prev, ...incoming };
            writeCached(playerId, merged);
            return merged;
          });
        }
      })
      .catch(() => {
        /* swallow */
      });
    return () => {
      cancelled = true;
    };
  }, [playerId]);

  // Merge live WS updates and persist to localStorage
  useEffect(() => {
    if (!playerId || !opts.liveRelationships) return;
    const live = opts.liveRelationships;
    if (Object.keys(live).length === 0) return;
    setRelationships((prev) => {
      const merged = { ...prev, ...live };
      writeCached(playerId, merged);
      return merged;
    });
  }, [opts.liveRelationships, playerId]);

  const trustFor = useCallback(
    (agentId: string): number => relationships[agentId]?.trust ?? 0,
    [relationships]
  );

  const bandFor = useCallback(
    (agentId: string) => TRUST_BAND(trustFor(agentId)),
    [trustFor]
  );

  return { relationships, trustFor, bandFor };
}
