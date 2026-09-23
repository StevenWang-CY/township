/**
 * seasonPalette — one colour LUT shared with `scripts/mapgen/seasons.py`.
 *
 * The two tile sheets ship in their summer palette. Before a town map is
 * built, the sheet textures are remapped pixel-for-pixel through the
 * season's `[from, to]` colour pairs (spring blossoms and fresh grass,
 * autumn amber and olive, winter straw) and re-registered under the same
 * texture keys, so tilemap layers and blitted prop stamps all pick the
 * season up with no other change. Previews rendered by mapgen use the
 * same table, so what the README shows is what the town draws.
 */
import Phaser from "phaser";
import seasons from "./seasons.json";

export type Season = "spring" | "summer" | "autumn" | "winter";
export const SEASONS: readonly Season[] = ["spring", "summer", "autumn", "winter"];

type Rgb = [number, number, number] | string;
interface SeasonsJson {
  seasons: Record<string, Array<[Rgb, Rgb]>>;
  byMonth?: string[];
}

const TABLE = seasons as unknown as SeasonsJson;
export const SHEET_KEYS = ["rpg-tileset", "township-modern"] as const;

/** Season for an ISO date (`YYYY-MM-DD`); summer when the date is unusable. */
export function seasonForDate(iso: string | null | undefined): Season {
  const month = Number(String(iso ?? "").slice(5, 7));
  if (!Number.isFinite(month) || month < 1 || month > 12) return "summer";
  const byMonth = TABLE.byMonth?.[month - 1];
  if (byMonth && (SEASONS as readonly string[]).includes(byMonth)) return byMonth as Season;
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "autumn";
  return "winter";
}

function packRgb(c: Rgb): number | null {
  if (typeof c === "string") {
    const hex = c.replace("#", "");
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
    return parseInt(hex, 16);
  }
  if (!Array.isArray(c) || c.length < 3) return null;
  return ((c[0] & 255) << 16) | ((c[1] & 255) << 8) | (c[2] & 255);
}

/** Packed `rgb → rgb` map for a season (empty for summer / unknown). */
export function lutFor(season: Season): Map<number, number> {
  const out = new Map<number, number>();
  for (const [from, to] of TABLE.seasons?.[season] ?? []) {
    const a = packRgb(from);
    const b = packRgb(to);
    if (a !== null && b !== null && a !== b) out.set(a, b);
  }
  return out;
}

/** Remap every opaque pixel of `src` through `lut` (in place). */
export function remapImageData(src: ImageData, lut: Map<number, number>): ImageData {
  if (lut.size === 0) return src;
  const d = src.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const to = lut.get((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    if (to === undefined) continue;
    d[i] = (to >> 16) & 255;
    d[i + 1] = (to >> 8) & 255;
    d[i + 2] = to & 255;
  }
  return src;
}

/** Summer pixels of each sheet, captured the first time a season is applied. */
const originals = new Map<string, ImageData>();

function readPixels(source: CanvasImageSource, w: number, h: number): ImageData | null {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0);
  try {
    return ctx.getImageData(0, 0, w, h);
  } catch {
    return null;
  }
}

/**
 * Re-register the tile sheets in `season`'s palette. Idempotent per season
 * (a texture already in that season is left alone). Prop stamps blitted
 * from a previous season are dropped so they re-blit from the new sheet.
 * Returns the keys that changed.
 */
export function applySeasonPalette(scene: Phaser.Scene, season: Season): string[] {
  const textures = scene.textures;
  const changed: string[] = [];
  const lut = lutFor(season);
  for (const key of SHEET_KEYS) {
    if (!textures.exists(key)) continue;
    const tex = textures.get(key);
    const data = tex.customData as { season?: Season };
    const current: Season = data.season ?? "summer";
    if (current === season) continue;
    const source = tex.getSourceImage() as HTMLImageElement | HTMLCanvasElement;
    const w = tex.source[0]?.width ?? (source as HTMLImageElement).width;
    const h = tex.source[0]?.height ?? (source as HTMLImageElement).height;
    if (!w || !h) continue;
    let base = originals.get(key);
    if (!base) {
      // The first sheet we see is summer only if no season was applied yet.
      if (current !== "summer") continue;
      const read = readPixels(source, w, h);
      if (!read) continue;
      originals.set(key, read);
      base = read;
    }
    if (lut.size === 0 && current === "summer") {
      // Identity palette: keep the loaded image, just record the season.
      data.season = season;
      continue;
    }
    const out = new ImageData(new Uint8ClampedArray(base.data), w, h);
    remapImageData(out, lut);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    ctx.putImageData(out, 0, 0);
    textures.remove(key);
    const added = textures.addCanvas(key, canvas);
    if (!added) continue;
    (added.customData as { season?: Season }).season = season;
    changed.push(key);
  }
  if (changed.length > 0) {
    // Blitted stamps and single tiles cache sheet pixels — rebuild lazily.
    for (const key of Object.keys(textures.list)) {
      if (key.startsWith("stamp-") || key.startsWith("tile-")) textures.remove(key);
    }
  }
  return changed;
}
