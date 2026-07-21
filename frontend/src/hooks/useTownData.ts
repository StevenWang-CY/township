import { useEffect, useState } from "react";
import type {
  TownDataResponse,
  TownData,
  TownId,
  LandmarkData,
} from "../types/messages";
import { DEMO_MODE, demoUrl, resolveDemoScenarioId } from "../demo/demoMode";
import type { DemoManifest } from "../demo/demoMode";

/* ── Scenario-neutral fallback ──────────────────────────────── */
//
// Scenario packages serve authoritative landmarks via /api/towns or the
// staged demo payload. Until that arrives, a small generic village keeps the
// scene warm and usable without leaking a different scenario's civic facts.

export function genericLandmarks(): LandmarkData[] {
  return [
    { name: "Main Street", x: 150, y: 380, width: 900, height: 30, color: "#D4A574", type: "road" },
    { name: "Town Hall", x: 520, y: 210, width: 140, height: 110, color: "#C9B896", type: "building" },
    { name: "Town Green", x: 250, y: 520, width: 200, height: 150, color: "#7CB87C", type: "park" },
    { name: "General Store", x: 300, y: 280, width: 120, height: 70, color: "#D4B896", type: "building" },
    { name: "Public Library", x: 760, y: 280, width: 120, height: 80, color: "#A0C4E8", type: "building" },
    { name: "Old Church", x: 900, y: 180, width: 100, height: 110, color: "#C9B896", type: "church" },
    { name: "Riverside Park", x: 780, y: 540, width: 190, height: 140, color: "#90C890", type: "park" },
    { name: "Cottage Row", x: 130, y: 160, width: 150, height: 90, color: "#C4B5A0", type: "housing" },
  ];
}

/** Generic bootstrap landmarks; authoritative town data rebases the scene. */
export function landmarksFor(_townId: TownId): LandmarkData[] {
  return genericLandmarks();
}

/* ── Hook ──────────────────────────────────────────────────── */

export function useTownData() {
  const [data, setData] = useState<Record<TownId, TownData>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const source = DEMO_MODE
      ? fetch(demoUrl("manifest.json"))
          .then((r) => {
            if (!r.ok) throw new Error(`Demo manifest returned HTTP ${r.status}`);
            return r.json() as Promise<DemoManifest>;
          })
          .then((manifest) => fetch(demoUrl(`${resolveDemoScenarioId(manifest)}-towns.json`)))
      : fetch("/api/towns");

    source
      .then((r) => (r.ok ? (r.json() as Promise<TownDataResponse>) : null))
      .then((d) => {
        if (cancelled) return;
        if (d?.towns) {
          setData(d.towns);
        }
      })
      .catch(() => {
        /* swallow — the generic scene bootstrap remains available */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { data, loading };
}
