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
  /** Called when the player clicks on an agent dot. */
  onPinClick?: (agentId: string) => void;
  width?: number;
  height?: number;
}

export default function MiniMap({
  getData,
  townId,
  onPinClick,
  width = 180,
  height = 120,
}: MiniMapProps) {
  const [data, setData] = useState<MiniMapData | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
        className="minimap"
        style={{ width, height, opacity: 0.5 }}
        aria-label="Mini-map"
      >
        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Map loading…</span>
      </div>
    );
  }

  const scaleX = width / data.width;
  const scaleY = height / data.height;

  return (
    <div
      className="minimap"
      style={{ width, height }}
      aria-label="Mini-map"
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: "block" }}
      >
        {/* Generated map preview as the background — keep it crisp. */}
        {townId ? (
          <image
            href={appUrl(`assets/maps/${townId}-preview.png`)}
            x={0}
            y={0}
            width={width}
            height={height}
            preserveAspectRatio="none"
            style={{ imageRendering: "pixelated" }}
          />
        ) : (
          <rect x={0} y={0} width={width} height={height} fill="rgba(255,252,245,0.85)" />
        )}
        {/* Agent dots (town accent colors) */}
        {data.agents.map((a) => (
          <circle
            key={a.id}
            cx={a.x * scaleX}
            cy={a.y * scaleY}
            r={2.5}
            fill={a.color}
            stroke="#fff"
            strokeWidth={0.6}
            style={{ cursor: onPinClick ? "pointer" : "default", pointerEvents: "all" }}
            onClick={(e) => {
              e.stopPropagation();
              onPinClick?.(a.id);
            }}
          >
            <title>{a.id}</title>
          </circle>
        ))}
        {/* Player dot */}
        {data.player && (
          <g>
            <circle
              cx={data.player.x * scaleX}
              cy={data.player.y * scaleY}
              r={4}
              fill="#C4A35A"
              stroke="#fff"
              strokeWidth={1}
            >
              <animate attributeName="r" values="4;5;4" dur="1.6s" repeatCount="indefinite" />
            </circle>
          </g>
        )}
      </svg>
    </div>
  );
}
