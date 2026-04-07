import { useEffect, useRef, useCallback } from "react";
import type Phaser from "phaser";

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
}

/**
 * Renders absolute-positioned DOM labels over the Phaser canvas.
 * Uses direct DOM manipulation via RAF for 60fps position sync
 * (bypasses React reconciler for transforms).
 */
export function CanvasOverlay({ gameRef, getOverlayData }: CanvasOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const elementsMapRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const rafRef = useRef<number>(0);

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

    for (const item of items) {
      activeIds.add(item.id);

      // World → screen coordinate transform
      const screenX = (item.x - cam.scrollX) * cam.zoom * (displayW / gameW) + offsetX;
      const screenY = (item.y - cam.scrollY) * cam.zoom * (displayH / gameH) + offsetY;

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

    rafRef.current = requestAnimationFrame(syncPositions);
  }, [gameRef, getOverlayData]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(syncPositions);
    return () => {
      cancelAnimationFrame(rafRef.current);
      // Clean up DOM elements
      elementsMapRef.current.forEach((el) => el.remove());
      elementsMapRef.current.clear();
    };
  }, [syncPositions]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: 10, willChange: "transform" }}
    />
  );
}
