import { useEffect, useRef, useCallback, useState } from "react";
import type Phaser from "phaser";
import ProximityCard from "./ProximityCard";
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
  /** Look up player world position (for proximity card). */
  getPlayer?: () => { x: number; y: number } | null;
  /** Resolve an agent's full state (for the proximity card). */
  getAgent?: (id: string) => AgentState | undefined;
  /** Look up trust for an agent (for the proximity card). */
  getTrust?: (id: string) => number;
  /** Proximity threshold in world coordinates. */
  proximityRadius?: number;
}

/**
 * Renders absolute-positioned DOM labels over the Phaser canvas.
 * Uses direct DOM manipulation via RAF for 60fps position sync
 * (bypasses React reconciler for transforms).
 *
 * Also renders a ProximityCard for the closest agent within proximityRadius.
 */
export function CanvasOverlay({
  gameRef,
  getOverlayData,
  getPlayer,
  getAgent,
  getTrust,
  proximityRadius = 120,
}: CanvasOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const elementsMapRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const rafRef = useRef<number>(0);
  const [proximity, setProximity] = useState<{
    agentId: string;
    screenX: number;
    screenY: number;
  } | null>(null);
  const lastProxIdRef = useRef<string | null>(null);

  const syncPositions = useCallback(() => {
    const game = gameRef.current;
    const container = containerRef.current;
    if (!game || !container) {
      rafRef.current = requestAnimationFrame(syncPositions);
      return;
    }

    const scene = game.scene.getScene("TownScene");
    if (!scene || !scene.scene.isActive()) {
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

    // ── Proximity card ────────────────────────────────────────
    if (getPlayer) {
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
          const { sx, sy } = worldToScreen(bestX, bestY - 50);
          if (bestId !== lastProxIdRef.current) {
            lastProxIdRef.current = bestId;
            setProximity({ agentId: bestId, screenX: sx, screenY: sy });
          } else {
            // smooth-update without recreating
            setProximity((prev) => {
              if (!prev) return { agentId: bestId!, screenX: sx, screenY: sy };
              // Only update if moved meaningfully
              if (Math.abs(prev.screenX - sx) > 1 || Math.abs(prev.screenY - sy) > 1) {
                return { agentId: bestId!, screenX: sx, screenY: sy };
              }
              return prev;
            });
          }
        } else if (lastProxIdRef.current) {
          lastProxIdRef.current = null;
          setProximity(null);
        }
      }
    }

    rafRef.current = requestAnimationFrame(syncPositions);
  }, [gameRef, getOverlayData, getPlayer, proximityRadius]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(syncPositions);
    return () => {
      cancelAnimationFrame(rafRef.current);
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
        />
      )}
    </>
  );
}
