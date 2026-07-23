import { useEffect, useRef, useCallback, useState } from "react";
import type Phaser from "phaser";
import ProximityCard from "./ProximityCard";
import { INTERACTION_RADIUS } from "../game/PlayerSprite";
import type { AgentState } from "../types/messages";

interface OverlayItem {
  id: string;
  name: string;
  x: number;
  y: number;
  visible: boolean;
  type: "agent" | "landmark";
}

interface CanvasOverlayProps {
  gameRef: React.RefObject<Phaser.Game | null>;
  getOverlayData: () => OverlayItem[];
  /** Look up player world position (for the talk card). */
  getPlayer?: () => { x: number; y: number } | null;
  /** Resolve an agent's full state (for the talk card). */
  getAgent?: (id: string) => AgentState | undefined;
  /** Look up trust for an agent (for the talk card). */
  getTrust?: (id: string) => number;
  /** Proximity threshold in world coordinates — matches the E-key radius. */
  proximityRadius?: number;
  /** Keep floating cards clear of fixed controls at the canvas bottom. */
  bottomInset?: number;
  /** Start a conversation with this resident (talk-card action). */
  onTalk?: (agentId: string) => void;
  /** Hide the talk card entirely (e.g. while a chat panel is open). */
  suppressed?: boolean;
}

/** How long the talk card lingers (disabled, fading) after the resident
 *  steps out of range — so E never dies with zero feedback. */
const CARD_LINGER_MS = 600;

/**
 * Renders absolute-positioned DOM labels over the Phaser canvas.
 * Uses direct DOM manipulation via RAF for 60fps position sync
 * (bypasses React reconciler for transforms).
 *
 * Also renders THE walk-up talk card: one NPC-anchored card at the same
 * radius as the E key, carrying the talk action itself.
 */
export function CanvasOverlay({
  gameRef,
  getOverlayData,
  getPlayer,
  getAgent,
  getTrust,
  proximityRadius = INTERACTION_RADIUS,
  bottomInset = 12,
  onTalk,
  suppressed = false,
}: CanvasOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const elementsMapRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const rafRef = useRef<number>(0);
  const [proximity, setProximity] = useState<{
    agentId: string;
    screenX: number;
    screenY: number;
    anchorOffsetX: number;
    stale: boolean;
  } | null>(null);
  const lastProxIdRef = useRef<string | null>(null);
  const staleTimerRef = useRef<number | undefined>(undefined);

  const clearProximity = useCallback(() => {
    if (staleTimerRef.current) {
      window.clearTimeout(staleTimerRef.current);
      staleTimerRef.current = undefined;
    }
    if (lastProxIdRef.current) {
      lastProxIdRef.current = null;
      setProximity(null);
    }
  }, []);

  const syncPositions = useCallback(() => {
    const game = gameRef.current;
    const container = containerRef.current;
    if (!game || !container) {
      rafRef.current = requestAnimationFrame(syncPositions);
      return;
    }

    const scene = game.scene?.getScene("TownScene");
    if (!scene?.scene?.isActive()) {
      rafRef.current = requestAnimationFrame(syncPositions);
      return;
    }

    const cam = scene.cameras.main;
    const scale = game.scale;
    if (!cam || !scale) {
      rafRef.current = requestAnimationFrame(syncPositions);
      return;
    }

    const gameW = Number(game.config.width);
    const gameH = Number(game.config.height);
    const displayW = scale.displaySize.width;
    const displayH = scale.displaySize.height;

    // Offset from the canvas element within the container
    const canvas = game.canvas;
    const canvasRect = canvas.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const offsetX = canvasRect.left - containerRect.left;
    const offsetY = canvasRect.top - containerRect.top;

    const items = getOverlayData();
    const activeIds = new Set<string>();

    const worldToScreen = (wx: number, wy: number) => {
      const sx = (wx - cam.scrollX) * cam.zoom * (displayW / gameW) + offsetX;
      const sy = (wy - cam.scrollY) * cam.zoom * (displayH / gameH) + offsetY;
      return { sx, sy };
    };

    for (const item of items) {
      activeIds.add(item.id);

      const { sx: screenX, sy: screenY } = worldToScreen(item.x, item.y);

      let el = elementsMapRef.current.get(item.id);

      if (!el) {
        // Create new DOM element
        el = document.createElement("div");
        el.dataset.overlayId = item.id;

        if (item.type === "agent") {
          el.className = "overlay-agent-label";
        } else {
          el.className = "overlay-landmark-label";
        }

        el.textContent = item.name;
        container.appendChild(el);
        elementsMapRef.current.set(item.id, el);
      }

      // Update position directly (no React re-render)
      el.style.transform = `translate(${screenX}px, ${screenY}px)`;
      el.style.display = item.visible ? "" : "none";

      // Update text if name changed
      if (el.textContent !== item.name) {
        el.textContent = item.name;
      }
    }

    // Remove stale elements
    for (const [id, el] of elementsMapRef.current) {
      if (!activeIds.has(id)) {
        el.remove();
        elementsMapRef.current.delete(id);
      }
    }

    // ── Talk card (walk-up proximity) ─────────────────────────
    if (getPlayer && !suppressed) {
      const player = getPlayer();
      if (player) {
        let bestId: string | null = null;
        let bestDist = proximityRadius;
        let bestX = 0;
        let bestY = 0;
        for (const item of items) {
          if (item.type !== "agent") continue;
          // exclude the player from being its own proximity target
          if (item.id.startsWith("player-")) continue;
          const dx = item.x - player.x;
          const dy = item.y - player.y;
          const d = Math.hypot(dx, dy);
          if (d < bestDist) {
            bestDist = d;
            bestId = item.id;
            bestX = item.x;
            bestY = item.y;
          }
        }
        if (bestId) {
          if (staleTimerRef.current) {
            window.clearTimeout(staleTimerRef.current);
            staleTimerRef.current = undefined;
          }
          const { sx, sy } = worldToScreen(bestX, bestY - 50);
          // The card is 240px wide on desktop and narrows on phones. Clamp
          // its center to the canvas—not the viewport—so it can never bleed
          // into the resident rail or be cut off at either mobile edge.
          const cardHalf = Math.min(120, Math.max(90, (containerRect.width - 20) / 2));
          const safeX = Math.max(cardHalf + 10, Math.min(containerRect.width - cardHalf - 10, sx));
          // On narrow canvases the HUD and mini-map occupy the top band. Keep
          // the card below both instead of layering a third panel over them.
          const topInset = containerRect.width <= 600
            ? Math.min(210, containerRect.height - bottomInset)
            : 112;
          const safeY = Math.max(topInset, Math.min(containerRect.height - bottomInset, sy));
          const anchorOffsetX = sx - safeX;
          if (bestId !== lastProxIdRef.current) {
            lastProxIdRef.current = bestId;
            setProximity({ agentId: bestId, screenX: safeX, screenY: safeY, anchorOffsetX, stale: false });
          } else {
            // smooth-update without recreating
            setProximity((prev) => {
              if (!prev) {
                return {
                  agentId: bestId!,
                  screenX: safeX,
                  screenY: safeY,
                  anchorOffsetX,
                  stale: false,
                };
              }
              // Only update if moved meaningfully (or coming back in range)
              if (
                prev.stale
                || Math.abs(prev.screenX - safeX) > 1
                || Math.abs(prev.screenY - safeY) > 1
                || Math.abs(prev.anchorOffsetX - anchorOffsetX) > 1
              ) {
                return {
                  agentId: bestId!,
                  screenX: safeX,
                  screenY: safeY,
                  anchorOffsetX,
                  stale: false,
                };
              }
              return prev;
            });
          }
        } else if (lastProxIdRef.current && !staleTimerRef.current) {
          // The resident stepped out of range: linger briefly (faded, action
          // disabled) so the affordance never vanishes mid-keypress.
          setProximity((prev) => (prev && !prev.stale ? { ...prev, stale: true } : prev));
          staleTimerRef.current = window.setTimeout(() => {
            staleTimerRef.current = undefined;
            lastProxIdRef.current = null;
            setProximity(null);
          }, CARD_LINGER_MS);
        }
      }
    } else if (lastProxIdRef.current) {
      // Chat open (or no player): no talk card at all.
      clearProximity();
    }

    rafRef.current = requestAnimationFrame(syncPositions);
  }, [gameRef, getOverlayData, getPlayer, proximityRadius, bottomInset, suppressed, clearProximity]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(syncPositions);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.clearTimeout(staleTimerRef.current);
      // Clean up DOM elements
      elementsMapRef.current.forEach((el) => el.remove());
      elementsMapRef.current.clear();
    };
  }, [syncPositions]);

  const proxAgent = proximity && getAgent ? getAgent(proximity.agentId) : undefined;

  return (
    <>
      <div
        ref={containerRef}
        className="absolute inset-0 pointer-events-none overflow-hidden"
        style={{ zIndex: 10, willChange: "transform" }}
      />
      {proximity && proxAgent && (
        <ProximityCard
          agent={proxAgent}
          trust={getTrust ? getTrust(proxAgent.id) : 0}
          x={proximity.screenX}
          y={proximity.screenY}
          anchorOffsetX={proximity.anchorOffsetX}
          stale={proximity.stale}
          onTalk={onTalk ? () => onTalk(proxAgent.id) : undefined}
        />
      )}
    </>
  );
}
