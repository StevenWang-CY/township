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

/* Head crop: at sidebar sizes (28px) a full 32px body frame reads as a dark,
 * samey smudge — the face is ~10px tall. Portraits now crop the HEAD rows of
 * the down-facing frame, centered on the character's actual pixels (sheets
 * place bodies anywhere from x=1 to x=6), over a warm parchment backdrop. */
const HEAD_CROP = 21; // source px — head + a hint of shoulders

/**
 * Find the head crop rect inside one 32x32 frame by scanning its alpha:
 * horizontally centered on the sprite's pixels, vertically anchored just
 * above its top row. Falls back to a centered crop for blank frames.
 */
function headCropRect(
  frame: CanvasRenderingContext2D,
): { sx: number; sy: number; size: number } {
  const { data } = frame.getImageData(0, 0, FRAME_W, FRAME_H);
  let minX = FRAME_W, maxX = -1, minY = FRAME_H;
  for (let y = 0; y < FRAME_H; y++) {
    for (let x = 0; x < FRAME_W; x++) {
      if (data[(y * FRAME_W + x) * 4 + 3] > 24) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
      }
    }
  }
  if (maxX < 0) return { sx: (FRAME_W - HEAD_CROP) / 2, sy: 2, size: HEAD_CROP };
  const centerX = (minX + maxX + 1) / 2;
  const sx = Math.max(0, Math.min(FRAME_W - HEAD_CROP, Math.round(centerX - HEAD_CROP / 2)));
  // Anchor at the hair's top row: tall Smallville hairstyles put the face
  // low in the frame, so the window must reach the mouth, not just the brow.
  const sy = Math.max(0, Math.min(FRAME_H - HEAD_CROP, minY));
  return { sx, sy, size: HEAD_CROP };
}

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
        const frameX = col * FRAME_W;
        const frameY = row * FRAME_H;

        // Composite body + accessory at native resolution first, so the head
        // scan sees the finished character (hijab/cap pixels included).
        const composite = document.createElement("canvas");
        composite.width = FRAME_W;
        composite.height = FRAME_H;
        const cctx = composite.getContext("2d");
        if (!cctx) return;
        cctx.imageSmoothingEnabled = false;
        cctx.drawImage(body, frameX, frameY, FRAME_W, FRAME_H, 0, 0, FRAME_W, FRAME_H);
        if (overlay) {
          cctx.drawImage(overlay, frameX, frameY, FRAME_W, FRAME_H, 0, 0, FRAME_W, FRAME_H);
        }
        const { sx, sy, size: cropSize } = headCropRect(cctx);

        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(composite, sx, sy, cropSize, cropSize, 0, 0, size, size);
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
        // Warm parchment backdrop behind the transparent sprite — faces read
        // bright at 28px. The colored initials tile only appears on failure.
        background: failed
          ? color
          : "radial-gradient(140% 120% at 32% 24%, #FBF2DD 0%, #F1E2C2 58%, #E4CFA4 100%)",
        border: ringColor ? `2px solid ${ringColor}` : undefined,
        // Inner hairline keeps the opinion ring crisp against the parchment.
        boxShadow: ringColor ? "inset 0 0 0 1px rgba(255,252,244,0.85)" : undefined,
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
            color: failed ? "var(--text-on-accent)" : "rgba(120,100,70,0.55)",
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
