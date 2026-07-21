import { useEffect, useRef, useState } from "react";
import { appUrl } from "../lib/assetUrl";

export interface MiniMapData {
  width: number;
  height: number;
  landmarks: { x: number; y: number; w: number; h: number; type: string; color?: string; name: string }[];
  agents: { id: string; x: number; y: number; color: string }[];
  player?: { x: number; y: number };
}

interface MiniMapProps {
  getData: () => MiniMapData | null;
  /** Town id — selects the generated map preview used as the background. */
  townId?: string;
  /** Scenario-qualified preview asset declared by the town package. */
  previewPath?: string;
  /** False for scenario-local town ids that do not own vendored preview art. */
  showAuthoredPreview?: boolean;
  /** Called when the player clicks on an agent dot. */
  onPinClick?: (agentId: string) => void;
  width?: number;
  height?: number;
}

export default function MiniMap({
  getData,
  townId,
  previewPath,
  showAuthoredPreview = true,
  onPinClick,
  width = 180,
  height = 120,
}: MiniMapProps) {
  const [data, setData] = useState<MiniMapData | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => setPreviewFailed(false), [townId, previewPath, showAuthoredPreview]);

  useEffect(() => {
    const tick = () => {
      const next = getData();
      if (next && next.width > 0) setData(next);
    };
    tick();
    intervalRef.current = setInterval(tick, 200); // 5 Hz
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [getData]);

  if (!data || data.width === 0) {
    return (
      <div
        className="minimap pixel-frame"
        style={{ width, height }}
        aria-label="Mini-map"
        aria-busy="true"
        role="status"
      >
        <span className="minimap-loading-mark" aria-hidden="true" />
        <span className="minimap-loading-label">Mapping the neighborhood…</span>
      </div>
    );
  }

  const scaleX = width / data.width;
  const scaleY = height / data.height;

  return (
    <div
      className="minimap pixel-frame"
      style={{ width, height }}
      aria-label="Mini-map"
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: "block" }}
      >
        <defs>
          <pattern id="minimap-fallback-grid" width="10" height="10" patternUnits="userSpaceOnUse">
            <rect width="10" height="10" fill="var(--bg-warm)" />
            <path d="M10 0H0V10" fill="none" stroke="var(--gold-light)" strokeOpacity="0.22" strokeWidth="1" />
          </pattern>
        </defs>
        <rect x={0} y={0} width={width} height={height} fill="url(#minimap-fallback-grid)" />
        {/* Generated map preview as the background — keep it crisp. */}
        {previewPath && showAuthoredPreview && !previewFailed ? (
          <image
            href={appUrl(previewPath)}
            x={0}
            y={0}
            width={width}
            height={height}
            preserveAspectRatio="none"
            onError={() => setPreviewFailed(true)}
            style={{ imageRendering: "pixelated" }}
          />
        ) : null}
        {/* Agent dots (town accent colors) */}
        {data.agents.map((a) => (
          <g
            key={a.id}
            role={onPinClick ? "button" : undefined}
            tabIndex={onPinClick ? 0 : undefined}
            aria-label={onPinClick ? `Focus resident ${a.id.replace(/-/g, " ")}` : undefined}
            style={{ cursor: onPinClick ? "pointer" : "default" }}
            onClick={(event) => {
              event.stopPropagation();
              onPinClick?.(a.id);
            }}
            onKeyDown={(event) => {
              if (!onPinClick || (event.key !== "Enter" && event.key !== " ")) return;
              event.preventDefault();
              onPinClick(a.id);
            }}
          >
            <circle cx={a.x * scaleX} cy={a.y * scaleY} r={7} fill="transparent" />
            <circle
              cx={a.x * scaleX}
              cy={a.y * scaleY}
              r={2.5}
              fill={a.color}
              stroke="var(--text-on-accent)"
              strokeWidth={0.8}
            />
            <title>{a.id.replace(/-/g, " ")}</title>
          </g>
        ))}
        {/* Player dot */}
        {data.player && (
          <g className="minimap-player-marker">
            <circle
              className="minimap-player-halo"
              cx={data.player.x * scaleX}
              cy={data.player.y * scaleY}
              r={6}
              fill="none"
              stroke="var(--gold-accent)"
              strokeWidth={1}
            />
            <circle
              cx={data.player.x * scaleX}
              cy={data.player.y * scaleY}
              r={4}
              fill="var(--gold-accent)"
              stroke="var(--text-on-accent)"
              strokeWidth={1}
            />
          </g>
        )}
      </svg>
    </div>
  );
}
