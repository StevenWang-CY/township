import { useEffect, useRef, useState } from "react";
import { appUrl } from "../lib/assetUrl";

interface SpritePortraitProps {
  agentId: string;
  spriteKey?: string;
  fallbackInitials?: string;
  color?: string;
  size?: number;
  /** Optional frame index (0..11) — defaults to 0 (idle, down-facing). */
  frame?: number;
}

const FRAME_W = 32;
const FRAME_H = 32;
const SHEET_COLS = 3; // Smallville: 3 frames per row

/**
 * Renders a single sprite frame to a canvas. Falls back to a colored initials
 * circle if the texture can't be loaded.
 */
export default function SpritePortrait({
  agentId,
  spriteKey,
  fallbackInitials,
  color = "#8B7D6B",
  size = 64,
  frame = 0,
}: SpritePortraitProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
    if (!spriteKey) {
      setFailed(true);
      return;
    }

    // "char-Maria_Lopez" → "Maria_Lopez.png"
    const cleanKey = spriteKey.startsWith("char-") ? spriteKey.slice(5) : spriteKey;
    const url = appUrl(`assets/characters/${cleanKey}.png`);

    const img = new Image();
    img.onload = () => {
      if (!canvasRef.current) return;
      const ctx = canvasRef.current.getContext("2d");
      if (!ctx) return;

      // disable smoothing for crisp pixel art
      (ctx as any).imageSmoothingEnabled = false;

      const col = frame % SHEET_COLS;
      const row = Math.floor(frame / SHEET_COLS);
      const sx = col * FRAME_W;
      const sy = row * FRAME_H;

      ctx.clearRect(0, 0, size, size);
      try {
        ctx.drawImage(img, sx, sy, FRAME_W, FRAME_H, 0, 0, size, size);
        setLoaded(true);
      } catch {
        setFailed(true);
      }
    };
    img.onerror = () => setFailed(true);
    img.src = url;
    // Run cleanup
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [spriteKey, frame, size]);

  const initials =
    fallbackInitials ||
    agentId
      .split(/[-_\s]/)
      .filter(Boolean)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("")
      .slice(0, 2);

  return (
    <div
      className="sprite-portrait"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
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
            imageRendering: "pixelated",
            opacity: loaded ? 1 : 0,
            transition: "opacity 200ms ease",
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
            color: "#fff",
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: size * 0.36,
            opacity: failed ? 1 : 0.5,
            transition: "opacity 200ms ease",
          }}
        >
          {initials}
        </span>
      )}
    </div>
  );
}
