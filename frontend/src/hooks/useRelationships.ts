import { useEffect, useState, useCallback } from "react";
import { TRUST_BAND, type Relationship } from "../types/messages";
import { DEMO_MODE } from "../demo/demoMode";
import {
  playerCapabilityHeaders,
  registerPlayerCapability,
} from "../lib/playerCapability";

/* ── Storage helpers ───────────────────────────────────────── */

const STORAGE_KEY_PREFIX = "township-relationships-";
const RELATIONSHIP_UPDATED_EVENT = "township:relationship-updated";

interface PrivateRelationshipUpdate {
  playerId: string;
  agentId: string;
  relationship: Relationship;
}

export function publishPrivateRelationshipUpdate(
  playerId: string,
  agentId: string,
  relationship: Relationship,
) {
  window.dispatchEvent(new CustomEvent<PrivateRelationshipUpdate>(
    RELATIONSHIP_UPDATED_EVENT,
    { detail: { playerId, agentId, relationship } },
  ));
}

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

export function useRelationships(playerId: string | undefined) {
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
    if (!playerId || DEMO_MODE) return;
    let cancelled = false;
    void (async () => {
      if (!await registerPlayerCapability(playerId) || cancelled) return;
      try {
        const response = await fetch(
          `/api/chat/relationships/${encodeURIComponent(playerId)}`,
          { headers: playerCapabilityHeaders() },
        );
        if (!response.ok || cancelled) return;
        const data = await response.json();
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
      } catch {
        // Cached state remains available while a local server is offline.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playerId]);

  // Chat responses publish only inside the initiating browser.  Relationship
  // state never traverses the global simulation WebSocket, where it could be
  // observed by or merged into another viewer's session.
  useEffect(() => {
    if (!playerId) return;
    const onRelationship = (rawEvent: Event) => {
      const event = rawEvent as CustomEvent<PrivateRelationshipUpdate>;
      const detail = event.detail;
      if (!detail || detail.playerId !== playerId) return;
      setRelationships((prev) => {
        const merged = { ...prev, [detail.agentId]: detail.relationship };
        writeCached(playerId, merged);
        return merged;
      });
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY_PREFIX + playerId) {
        setRelationships(readCached(playerId));
      }
    };
    window.addEventListener(RELATIONSHIP_UPDATED_EVENT, onRelationship);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(RELATIONSHIP_UPDATED_EVENT, onRelationship);
      window.removeEventListener("storage", onStorage);
    };
  }, [playerId]);

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
