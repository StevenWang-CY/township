import { useEffect, useRef, useState } from "react";
import { appUrl } from "../lib/assetUrl";
import { resolveAgentSprite } from "../game/spriteCustomization";
import { useScenario } from "../hooks/useScenario";

export interface SpritePortraitProps {
  agentId: string;
  /** Optional explicit body sheet. Known agents resolve automatically. */
  spriteKey?: string;
  /** Optional explicit accessory overlay. Known agents resolve automatically. */
  accessoryKey?: string;
  fallbackInitials?: string;
  color?: string;
  size?: number;
  /** Optional frame index (0..11) — defaults to 0 (idle, down-facing). */
  frame?: number;
  /**
   * Opinion-colored inner border (2px). The gold pixel ring is applied
   * outside it via the .pixel-portrait utility. Omit for a plain frame.
   */
  ringColor?: string;
  /** "pixel" (default): rounded-square gold pixel frame. "circle": legacy. */
  shape?: "pixel" | "circle";
}

const FRAME_W = 32;
const FRAME_H = 32;
const SHEET_COLS = 3; // Smallville: 3 frames per row
const SHEET_ROWS = 4;

function bodyAssetPath(key: string): string {
  if (key.startsWith("char-custom-")) {
    return `assets/characters/custom/${key.slice("char-custom-".length)}_custom.png`;
  }
  const cleanKey = key.startsWith("char-") ? key.slice(5) : key;
  return `assets/characters/${cleanKey}.png`;
}

function accessoryAssetPath(key: string): string {
  const cleanKey = key.startsWith("acc-") ? key.slice(4) : key;
  return `assets/characters/accessories/${cleanKey}.png`;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load portrait asset: ${url}`));
    image.src = url;
  });
}

/**
 * Renders a single sprite frame to a canvas. Falls back to a colored initials
 * tile if the texture can't be loaded.
 */
export default function SpritePortrait({
  agentId,
  spriteKey,
  accessoryKey,
  fallbackInitials,
  color = "#8B7D6B",
  size = 64,
  frame = 0,
  ringColor,
  shape = "pixel",
}: SpritePortraitProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const { scenario } = useScenario();

  const resolved = resolveAgentSprite(agentId, scenario.id);
  // The in-world sprite prefers its baked palette-swap sheet when one exists;
  // portraits mirror that decision so the resident is visually consistent.
  const bodyKey = spriteKey ?? resolved.customKey ?? resolved.spriteKey;
  const overlayKey = accessoryKey ?? resolved.accessoryKey;

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setFailed(false);
    if (!bodyKey) {
      setFailed(true);
      return;
    }

    const bodyPromise = loadImage(appUrl(bodyAssetPath(bodyKey)));
    // Accessories are enhancement-only: a missing overlay must never hide an
    // otherwise valid resident portrait.
    const overlayPromise: Promise<HTMLImageElement | null> = overlayKey
      ? loadImage(appUrl(accessoryAssetPath(overlayKey))).catch(() => null)
      : Promise.resolve(null);

    Promise.all([bodyPromise, overlayPromise])
      .then(([body, overlay]) => {
        if (cancelled || !canvasRef.current) return;
        const ctx = canvasRef.current.getContext("2d");
        if (!ctx) return;
        ctx.imageSmoothingEnabled = false;

        const safeFrame = ((frame % (SHEET_COLS * SHEET_ROWS)) + (SHEET_COLS * SHEET_ROWS))
          % (SHEET_COLS * SHEET_ROWS);
        const col = safeFrame % SHEET_COLS;
        const row = Math.floor(safeFrame / SHEET_COLS);
        const sx = col * FRAME_W;
        const sy = row * FRAME_H;

        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(body, sx, sy, FRAME_W, FRAME_H, 0, 0, size, size);
        if (overlay) {
          ctx.drawImage(overlay, sx, sy, FRAME_W, FRAME_H, 0, 0, size, size);
        }
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [bodyKey, overlayKey, frame, size]);

  const initials =
    fallbackInitials ||
    agentId
      .split(/[-_\s]/)
      .filter(Boolean)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("")
      .slice(0, 2);

  const isPixel = shape === "pixel";

  return (
    <div
      className={`sprite-portrait${isPixel ? " pixel-portrait" : ""}${loaded ? " sprite-portrait--loaded" : ""}${failed ? " sprite-portrait--failed" : ""}`}
      data-agent-id={agentId}
      data-portrait-state={failed ? "fallback" : loaded ? "loaded" : "loading"}
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: isPixel ? undefined : "50%",
        background: color,
        border: ringColor ? `2px solid ${ringColor}` : undefined,
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        flexShrink: 0,
      }}
    >
      {!failed && (
        <canvas
          ref={canvasRef}
          width={size}
          height={size}
          style={{
            width: "100%",
            height: "100%",
            imageRendering: "pixelated",
            opacity: loaded ? 1 : 0,
          }}
        />
      )}
      {(failed || !loaded) && (
        <span
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-on-accent)",
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: size * 0.36,
            opacity: failed ? 1 : 0.5,
          }}
        >
          {initials}
        </span>
      )}
    </div>
  );
}
