import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { AgentState, TownId } from "../../types/messages";
import { AtlasCartouche, AtlasCompass } from "./AtlasChrome";
import AtlasFolk from "./AtlasFolk";
import AtlasSite from "./AtlasSite";
import { AtlasSkeleton, AtlasUnavailable } from "./AtlasSkeleton";
import type { TownButton } from "./AtlasSkeleton";
import type { OverworldAtlas, OverworldStatus } from "./overworld";
import type { SiteView } from "./types";

/** Hover card footprint (CSS px) used to place it without covering text. */
const CARD_W = 240;
const CARD_H = 254;
const CARD_GAP = 12;
const CARD_MARGIN = 6;
/** A nameplate's reach below its pad (CSS px, generous): the plaque starts
 *  under 6 px of rope. */
const PLATE_W = 196;
const PLATE_H = 80;
const PLATE_ROPE = 6;
/** How far a card may hang below the panel (into the frame, never the page). */
const CARD_OVERFLOW = 72;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function overlap(a: Box, b: Box): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

function padBox(site: SiteView, t: number): Box {
  const { pad } = site.record;
  return { left: pad.x * t, top: pad.y * t, right: (pad.x + pad.w) * t, bottom: (pad.y + pad.h) * t };
}

function plateBox(site: SiteView, t: number): Box {
  const pad = padBox(site, t);
  const cx = (pad.left + pad.right) / 2;
  const top = pad.bottom + PLATE_ROPE;
  return { left: cx - PLATE_W / 2, top, right: cx + PLATE_W / 2, bottom: top + PLATE_H };
}

interface AtlasPanelProps {
  status: OverworldStatus;
  sites: SiteView[];
  towns: TownButton[];
  title: string;
  subtitle: string;
  hovered: TownId | null;
  onHover: (id: TownId | null) => void;
  onActivate: (id: TownId) => void;
  animateFolk: boolean;
  driftClouds: boolean;
  stanceColor: (agent: AgentState) => string;
  /** Desktop only: renders the hover card for the lit site at `style`. */
  renderHoverCard?: (site: SiteView, style: CSSProperties, id: string) => ReactNode;
}

/**
 * Where the hover card goes. Candidates: beside the pad (the side facing
 * away from the panel's centre first), above the pad, or hanging below the
 * town's own nameplate. Each is scored — covering any nameplate's text is
 * all but forbidden, covering the hovered town is worse, covering a
 * neighbour's streets is tolerated, hanging a little past the panel's
 * bottom edge is allowed, and nearer the pad is better — so even the
 * crowded north row gets a legible card.
 */
function hoverCardStyle(
  site: SiteView,
  sites: SiteView[],
  atlas: OverworldAtlas,
  scale: number,
): CSSProperties {
  const t = atlas.tile * scale;
  const panelW = atlas.width * scale;
  const panelH = atlas.height * scale;
  const own = padBox(site, t);
  const ownPlate = plateBox(site, t);
  const others = sites.filter((s) => s.id !== site.id);
  const plates = [ownPlate, ...others.map((s) => plateBox(s, t))];
  const pads = others.map((s) => padBox(s, t));
  const cx = (own.left + own.right) / 2;
  const cy = (own.top + own.bottom) / 2;
  const clampLeft = (v: number) => Math.max(CARD_MARGIN, Math.min(panelW - CARD_W - CARD_MARGIN, v));
  const clampTop = (v: number) => Math.max(CARD_MARGIN, Math.min(panelH - CARD_H + CARD_OVERFLOW, v));
  const preferRight = cx < panelW / 2;

  const candidates: Array<{ left: number; top: number; penalty: number }> = [];
  const sideLefts = [own.right + CARD_GAP, own.left - CARD_GAP - CARD_W];
  if (!preferRight) sideLefts.reverse();
  sideLefts.forEach((rawLeft, i) => {
    const left = clampLeft(rawLeft);
    const tops = new Set<number>([cy - CARD_H / 2]);
    for (const p of plates) {
      if (p.right > left && p.left < left + CARD_W) {
        tops.add(p.bottom + 8);
        tops.add(p.top - CARD_H - 8);
      }
    }
    for (const top of tops) candidates.push({ left, top: clampTop(top), penalty: i * 4000 });
  });
  const aligned = [cx - CARD_W / 2, own.left, own.right - CARD_W].map(clampLeft);
  for (const left of aligned) {
    candidates.push({ left, top: clampTop(own.top - CARD_H - 8), penalty: 0 });
    candidates.push({ left, top: clampTop(ownPlate.bottom + 4), penalty: 0 });
  }

  let bestBox: Box = { left: clampLeft(own.right + CARD_GAP), top: clampTop(cy - CARD_H / 2), right: 0, bottom: 0 };
  let bestCost = Infinity;
  for (const c of candidates) {
    const box: Box = { left: c.left, top: c.top, right: c.left + CARD_W, bottom: c.top + CARD_H };
    const distance = Math.hypot((box.left + box.right) / 2 - cx, (box.top + box.bottom) / 2 - cy);
    const cost =
      c.penalty +
      overlap(box, own) * 20 +
      plates.reduce((sum, p) => sum + overlap(box, p) * 40, 0) +
      pads.reduce((sum, p) => sum + overlap(box, p), 0) +
      Math.max(0, box.bottom - panelH) * CARD_W * 3 +
      distance * 30;
    if (cost < bestCost) {
      bestCost = cost;
      bestBox = box;
    }
  }
  return { left: Math.round(bestBox.left), top: Math.round(bestBox.top) };
}

/**
 * The parchment frame around the native-resolution pixel overworld: the
 * terrain image (1:1 at 960 px, `@2x` on retina), the drifting cloud
 * shadows, the scaled pixel layer the resident figures walk in, the
 * nameplates, the cartouche and compass chrome, and the hover card.
 */
export default function AtlasPanel({
  status,
  sites,
  towns,
  title,
  subtitle,
  hovered,
  onHover,
  onActivate,
  animateFolk,
  driftClouds,
  stanceColor,
  renderHoverCard,
}: AtlasPanelProps) {
  const atlas = status.state === "ready" ? status.atlas : null;
  const viewportRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [atlas?.imageUrl]);

  // One image pixel per CSS pixel at 960 px; below that the pixel-space
  // layers (figures, hover-card geometry) scale with the panel.
  useLayoutEffect(() => {
    const node = viewportRef.current;
    if (!node || !atlas) return;
    const measure = () => setScale(node.clientWidth / atlas.width || 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [atlas]);

  if (status.state === "missing" || failed) {
    return <AtlasUnavailable towns={towns} onActivate={onActivate} />;
  }

  const lit = hovered ? sites.find((s) => s.id === hovered) ?? null : null;
  const cardId = lit && renderHoverCard ? `atlas-hover-${lit.id}` : undefined;

  return (
    <div className="atlas-frame">
      <div
        className="atlas-panel"
        style={{
          aspectRatio: atlas ? `${atlas.width} / ${atlas.height}` : "960 / 608",
          ["--atlas-scale" as string]: scale,
        }}
      >
        {(!atlas || !loaded) && <AtlasSkeleton />}
        {atlas && (
          <>
            <div ref={viewportRef} className={`atlas-viewport${loaded ? " is-loaded" : ""}`}>
              <img
                className="atlas-terrain"
                src={atlas.imageUrl}
                srcSet={atlas.image2xUrl ? `${atlas.imageUrl} 1x, ${atlas.image2xUrl} 2x` : undefined}
                width={atlas.width}
                height={atlas.height}
                alt=""
                draggable={false}
                onLoad={() => setLoaded(true)}
                onError={() => setFailed(true)}
              />
              {atlas.cloudsUrl && (
                <div className="atlas-clouds" aria-hidden="true">
                  <div className={`atlas-clouds-strip${driftClouds ? " is-drifting" : ""}`}>
                    <img src={atlas.cloudsUrl} alt="" draggable={false} />
                    <img src={atlas.cloudsUrl} alt="" draggable={false} />
                  </div>
                </div>
              )}
              <div className="atlas-shade" aria-hidden="true" />
              <div
                className="atlas-folk-layer"
                style={{ width: atlas.width, height: atlas.height }}
                aria-hidden="true"
              >
                {sites.map((site) => (
                  <AtlasFolk key={site.id} site={site} stanceColor={stanceColor} animate={animateFolk} />
                ))}
              </div>
            </div>

            <div className="atlas-sites">
              {sites.map((site) => (
                <AtlasSite
                  key={site.id}
                  site={site}
                  atlas={atlas}
                  lit={hovered === site.id}
                  describedBy={hovered === site.id ? cardId : undefined}
                  onHover={onHover}
                  onActivate={onActivate}
                />
              ))}
            </div>

            <AtlasCartouche title={title} subtitle={subtitle} />
            <AtlasCompass />
            {lit && renderHoverCard && cardId && renderHoverCard(lit, hoverCardStyle(lit, sites, atlas, scale), cardId)}
          </>
        )}
      </div>
    </div>
  );
}
