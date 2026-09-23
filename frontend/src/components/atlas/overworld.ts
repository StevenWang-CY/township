/* ── Overworld atlas data ────────────────────────────────────
 * scripts/mapgen/overworld.py renders a per-scenario 960x608 pixel
 * overworld plus overworld-sites.json (v2): one record per town with its
 * pad (tile rect of the mini-town) and a walk loop (pixel polyline along
 * the main street's sidewalks). This module validates that document,
 * resolves the asset URLs, and offers the small geometry helpers the atlas
 * layers need. Presentation-only: a missing or malformed document simply
 * leaves the atlas "missing" and the page falls back to town buttons.
 * ─────────────────────────────────────────────────────────── */

import { useEffect, useState } from "react";
import { appUrl } from "../../lib/assetUrl";
import type { TownId } from "../../types/messages";

export interface AtlasPad {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type AtlasPoint = [number, number];

export interface AtlasSiteRecord {
  id: TownId;
  name: string;
  /** Pad centre, overworld px. */
  x: number;
  y: number;
  pad: AtlasPad;
  /** Closed polyline in overworld px; residents stroll along it. */
  walk: AtlasPoint[];
}

export interface OverworldAtlas {
  width: number;
  height: number;
  tile: number;
  imageUrl: string;
  image2xUrl: string | null;
  cloudsUrl: string | null;
  sites: AtlasSiteRecord[];
}

export type OverworldStatus =
  | { state: "loading" }
  | { state: "ready"; atlas: OverworldAtlas }
  | { state: "missing" };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function parsePad(raw: unknown): AtlasPad | null {
  const p = (raw ?? null) as Record<string, unknown> | null;
  if (!p || !isNum(p.x) || !isNum(p.y) || !isNum(p.w) || !isNum(p.h)) return null;
  return p.w > 0 && p.h > 0 ? { x: p.x, y: p.y, w: p.w, h: p.h } : null;
}

function parseWalk(raw: unknown): AtlasPoint[] {
  if (!Array.isArray(raw)) return [];
  const pts: AtlasPoint[] = [];
  for (const p of raw) {
    if (Array.isArray(p) && isNum(p[0]) && isNum(p[1])) pts.push([p[0], p[1]]);
  }
  return pts.length >= 2 ? pts : [];
}

/** Validate + resolve overworld-sites.json. Null unless the image metadata
 *  is sound and EVERY town of the scenario has a site with a pad. */
export function parseOverworldAtlas(
  payload: unknown,
  scenarioId: string,
  townIds: string[],
): OverworldAtlas | null {
  if (typeof payload !== "object" || payload === null) return null;
  const data = payload as Record<string, unknown>;
  const image = (data.image ?? null) as Record<string, unknown> | null;
  const clouds = (data.clouds ?? null) as Record<string, unknown> | null;
  if (!image || typeof image.path !== "string" || !Array.isArray(data.sites)) return null;
  if (!isNum(image.width) || !isNum(image.height) || image.width <= 0 || image.height <= 0) {
    return null;
  }
  const tile = isNum(image.tile) && image.tile > 0 ? image.tile : 16;
  const asset = (p: unknown): string | null =>
    typeof p === "string" && p.length > 0 ? appUrl(`assets/maps/${scenarioId}/${p}`) : null;
  const sites: AtlasSiteRecord[] = [];
  for (const raw of data.sites) {
    const s = (raw ?? null) as Record<string, unknown> | null;
    if (!s) continue;
    const id = typeof s.id === "string" ? s.id : typeof s.town_id === "string" ? s.town_id : null;
    if (!id || !townIds.includes(id) || !isNum(s.x) || !isNum(s.y)) continue;
    const pad = parsePad(s.pad);
    if (!pad) continue;
    sites.push({
      id,
      name: typeof s.name === "string" ? s.name : id,
      x: s.x,
      y: s.y,
      pad,
      walk: parseWalk(s.walk),
    });
  }
  if (townIds.length === 0 || !townIds.every((id) => sites.some((s) => s.id === id))) return null;
  return {
    width: image.width,
    height: image.height,
    tile,
    imageUrl: asset(image.path) as string,
    image2xUrl: asset(image.path2x),
    cloudsUrl: clouds ? asset(clouds.path) : null,
    sites,
  };
}

/** Fetch + parse the scenario's overworld document. */
export function useOverworldAtlas(scenarioId: string, townIds: string[]): OverworldStatus {
  const [status, setStatus] = useState<OverworldStatus>({ state: "loading" });
  const townKey = townIds.join("|");
  useEffect(() => {
    setStatus({ state: "loading" });
    const ctrl = new AbortController();
    fetch(appUrl(`assets/maps/${scenarioId}/overworld-sites.json`), { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((payload) => {
        const atlas = parseOverworldAtlas(payload, scenarioId, townKey ? townKey.split("|") : []);
        setStatus(atlas ? { state: "ready", atlas } : { state: "missing" });
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setStatus({ state: "missing" });
      });
    return () => ctrl.abort();
  }, [scenarioId, townKey]);
  return status;
}

/** SVG path data for `offset-path: path(...)`. */
export function walkPath(walk: AtlasPoint[]): string {
  return walk.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ");
}

export function walkLength(walk: AtlasPoint[]): number {
  let total = 0;
  for (let i = 1; i < walk.length; i++) total += Math.hypot(walk[i][0] - walk[i - 1][0], walk[i][1] - walk[i - 1][1]);
  return total;
}

/** The point a given fraction (0..1) along the polyline — for the static
 *  (reduced-motion / no offset-path) layout of the resident figures. */
export function pointAlong(walk: AtlasPoint[], fraction: number): AtlasPoint {
  const total = walkLength(walk);
  if (walk.length === 0) return [0, 0];
  let remaining = Math.max(0, Math.min(1, fraction)) * total;
  for (let i = 1; i < walk.length; i++) {
    const [ax, ay] = walk[i - 1];
    const [bx, by] = walk[i];
    const seg = Math.hypot(bx - ax, by - ay);
    if (remaining <= seg || i === walk.length - 1) {
      const t = seg === 0 ? 0 : Math.min(1, remaining / seg);
      return [ax + (bx - ax) * t, ay + (by - ay) * t];
    }
    remaining -= seg;
  }
  return walk[walk.length - 1];
}
