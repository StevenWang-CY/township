import { useMemo } from "react";
import type { LeanId } from "../types/messages";
import { CANDIDATE_COLORS, CANDIDATE_NAMES } from "../types/messages";

interface OpinionChartProps {
  opinions: Record<LeanId, number>;
  size?: number;
  showLegend?: boolean;
}

export default function OpinionChart({ opinions, size = 140, showLegend = true }: OpinionChartProps) {
  const total = useMemo(
    () => Object.values(opinions).reduce((a, b) => a + b, 0),
    [opinions]
  );

  const segments = useMemo(() => {
    const order: LeanId[] = ["mejia", "hathaway", "bond", "undecided"];
    let cumAngle = -Math.PI / 2; // start at top
    return order
      .filter((k) => opinions[k] > 0)
      .map((k) => {
        const fraction = total > 0 ? opinions[k] / total : 0;
        const angle = fraction * Math.PI * 2;
        const start = cumAngle;
        cumAngle += angle;
        return { candidate: k, count: opinions[k], fraction, startAngle: start, endAngle: cumAngle };
      });
  }, [opinions, total]);

  const r = size / 2;
  const innerR = r * 0.55;
  const cx = r;
  const cy = r;

  function arcPath(startAngle: number, endAngle: number, outerR: number, innerRadius: number): string {
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
    const x1 = cx + outerR * Math.cos(startAngle);
    const y1 = cy + outerR * Math.sin(startAngle);
    const x2 = cx + outerR * Math.cos(endAngle);
    const y2 = cy + outerR * Math.sin(endAngle);
    const x3 = cx + innerRadius * Math.cos(endAngle);
    const y3 = cy + innerRadius * Math.sin(endAngle);
    const x4 = cx + innerRadius * Math.cos(startAngle);
    const y4 = cy + innerRadius * Math.sin(startAngle);

    return [
      `M ${x1} ${y1}`,
      `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2}`,
      `L ${x3} ${y3}`,
      `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${x4} ${y4}`,
      "Z",
    ].join(" ");
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {total === 0 ? (
          <circle cx={cx} cy={cy} r={r - 2} fill="none" stroke="#E5E7EB" strokeWidth="2" />
        ) : (
          segments.map((seg, i) => (
            <path
              key={seg.candidate}
              d={arcPath(seg.startAngle, seg.endAngle, r - 2, innerR)}
              fill={CANDIDATE_COLORS[seg.candidate]}
              opacity={0.85}
              style={{
                transition: "d 0.6s ease",
              }}
            >
              <title>
                {CANDIDATE_NAMES[seg.candidate]}: {seg.count} ({Math.round(seg.fraction * 100)}%)
              </title>
            </path>
          ))
        )}
        {/* Center text */}
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          fontSize="20"
          fontWeight="700"
          fill="var(--township-ink)"
          fontFamily="Inter, sans-serif"
        >
          {total}
        </text>
        <text
          x={cx}
          y={cy + 12}
          textAnchor="middle"
          fontSize="9"
          fill="var(--township-ink-muted)"
          fontFamily="Inter, sans-serif"
        >
          agents
        </text>
      </svg>

      {showLegend && (
        <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">
          {(["mejia", "hathaway", "bond", "undecided"] as LeanId[]).map((k) => (
            <div key={k} className="flex items-center gap-1 text-xs" style={{ color: "var(--township-ink-muted)" }}>
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: CANDIDATE_COLORS[k] }} />
              <span>
                {CANDIDATE_NAMES[k]} ({opinions[k] || 0})
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
