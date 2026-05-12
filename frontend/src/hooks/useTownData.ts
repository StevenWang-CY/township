import { useEffect, useState } from "react";
import type {
  TownDataResponse,
  TownData,
  TownId,
  LandmarkData,
} from "../types/messages";

/* ── Fallback landmark data (kept identical to the old game/config.ts
 *    TOWN_LANDMARKS table so the app still works with /api/towns down) ── */

const DOVER_LANDMARKS: LandmarkData[] = [
  { name: "Blackwell Street", x: 200, y: 380, width: 800, height: 30, color: "#D4A574", type: "road" },
  { name: "Dover Station", x: 100, y: 550, width: 140, height: 90, color: "#8B7355", type: "transport" },
  { name: "St. Mary's Church", x: 750, y: 180, width: 110, height: 120, color: "#C9B896", type: "church" },
  { name: "La Finca Restaurant", x: 350, y: 280, width: 100, height: 70, color: "#E8763B", type: "building" },
  { name: "Public Library", x: 550, y: 500, width: 120, height: 80, color: "#A0C4E8", type: "building" },
  { name: "Factory", x: 950, y: 300, width: 160, height: 120, color: "#7A7A7A", type: "building" },
  { name: "Public Housing", x: 150, y: 150, width: 140, height: 90, color: "#C4B5A0", type: "housing" },
  { name: "Bodega Row", x: 500, y: 280, width: 120, height: 60, color: "#E8A060", type: "building" },
  { name: "Town Park", x: 400, y: 600, width: 180, height: 140, color: "#7CB87C", type: "park" },
];

const MONTCLAIR_LANDMARKS: LandmarkData[] = [
  { name: "Bloomfield Ave", x: 100, y: 380, width: 1000, height: 30, color: "#D4A574", type: "road" },
  { name: "Bay Street Station", x: 900, y: 550, width: 140, height: 90, color: "#8B7355", type: "transport" },
  { name: "Art Museum", x: 200, y: 180, width: 150, height: 120, color: "#6B5CE7", type: "building" },
  { name: "Town Hall", x: 550, y: 200, width: 130, height: 100, color: "#C9B896", type: "building" },
  { name: "Public Library", x: 350, y: 500, width: 120, height: 80, color: "#A0C4E8", type: "building" },
  { name: "Anderson Park", x: 750, y: 150, width: 200, height: 160, color: "#7CB87C", type: "park" },
  { name: "St. Paul Baptist", x: 150, y: 550, width: 110, height: 90, color: "#C9B896", type: "church" },
  { name: "Watchung Plaza", x: 500, y: 500, width: 140, height: 70, color: "#D4A574", type: "building" },
  { name: "Boutique Row", x: 300, y: 280, width: 160, height: 60, color: "#B8A0D4", type: "building" },
];

const PARSIPPANY_LANDMARKS: LandmarkData[] = [
  { name: "Route 46", x: 100, y: 350, width: 1000, height: 35, color: "#B0A090", type: "road" },
  { name: "Corporate Park", x: 800, y: 150, width: 200, height: 150, color: "#607090", type: "building" },
  { name: "Lake Parsippany", x: 200, y: 150, width: 180, height: 140, color: "#70B8D0", type: "park" },
  { name: "Hindu Temple", x: 600, y: 200, width: 100, height: 100, color: "#D4A060", type: "church" },
  { name: "Indian Grocery", x: 450, y: 250, width: 120, height: 60, color: "#2DA8A8", type: "building" },
  { name: "Public Library", x: 350, y: 500, width: 120, height: 80, color: "#A0C4E8", type: "building" },
  { name: "Residential Area", x: 150, y: 500, width: 160, height: 120, color: "#C4B5A0", type: "housing" },
  { name: "NJ Transit Stop", x: 700, y: 500, width: 100, height: 60, color: "#8B7355", type: "transport" },
  { name: "Community Center", x: 900, y: 450, width: 130, height: 90, color: "#A0C4B0", type: "building" },
];

const RANDOLPH_LANDMARKS: LandmarkData[] = [
  { name: "Main Road", x: 100, y: 400, width: 1000, height: 30, color: "#D4A574", type: "road" },
  { name: "Town Hall", x: 500, y: 200, width: 140, height: 110, color: "#C9B896", type: "building" },
  { name: "High School", x: 800, y: 180, width: 180, height: 130, color: "#A0B8C8", type: "building" },
  { name: "Commercial Strip", x: 300, y: 280, width: 200, height: 60, color: "#D4B896", type: "building" },
  { name: "Sports Fields", x: 200, y: 550, width: 200, height: 140, color: "#90C890", type: "park" },
  { name: "Hedden Park", x: 750, y: 530, width: 180, height: 160, color: "#7CB87C", type: "park" },
  { name: "Church", x: 950, y: 300, width: 100, height: 90, color: "#C9B896", type: "church" },
  { name: "Randolph Diner", x: 150, y: 300, width: 100, height: 60, color: "#E8C080", type: "building" },
  { name: "Residential Cul-de-sacs", x: 600, y: 550, width: 140, height: 100, color: "#C4B5A0", type: "housing" },
];

export const FALLBACK_TOWN_DATA: Record<TownId, TownData> = {
  dover: {
    name: "Dover",
    tagline: "The Working-Class Heart",
    accent_color: "#E8763B",
    landmarks: DOVER_LANDMARKS,
  },
  montclair: {
    name: "Montclair",
    tagline: "The Progressive Hub",
    accent_color: "#6B5CE7",
    landmarks: MONTCLAIR_LANDMARKS,
  },
  parsippany: {
    name: "Parsippany",
    tagline: "The Suburban Melting Pot",
    accent_color: "#2DA8A8",
    landmarks: PARSIPPANY_LANDMARKS,
  },
  randolph: {
    name: "Randolph",
    tagline: "The Republican Suburb",
    accent_color: "#4A9B5C",
    landmarks: RANDOLPH_LANDMARKS,
  },
};

/* ── Hook ──────────────────────────────────────────────────── */

export function useTownData() {
  const [data, setData] = useState<Record<TownId, TownData>>(FALLBACK_TOWN_DATA);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/towns")
      .then((r) => (r.ok ? (r.json() as Promise<TownDataResponse>) : null))
      .then((d) => {
        if (cancelled) return;
        if (d?.towns) {
          // Merge per-town to allow partial responses (keep fallback for any
          // missing town).
          setData((prev) => ({ ...prev, ...d.towns }));
        }
      })
      .catch(() => {
        /* swallow — fallback is already loaded */
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
