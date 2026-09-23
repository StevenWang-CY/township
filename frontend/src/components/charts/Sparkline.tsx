/* ── Sparkline ───────────────────────────────────────────────
 * A resident's confidence over their opinion trajectory, each segment in
 * the stance held at its end, a 4×4 pixel mark where the stance changed.
 * Pure SVG, crisp edges, no motion.
 * ─────────────────────────────────────────────────────────── */

export interface SparkPoint {
  confidence: number;
  candidate: string;
}

interface SparklineProps {
  points: SparkPoint[];
  colorFor: (candidate: string) => string;
  width?: number;
  height?: number;
  title?: string;
}

export default function Sparkline({ points, colorFor, width = 72, height = 18, title }: SparklineProps) {
  if (points.length < 2) return null;
  const step = width / (points.length - 1);
  const y = (c: number) => Math.round(height - 2 - (Math.max(0, Math.min(100, c)) / 100) * (height - 4));
  return (
    <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role={title ? "img" : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      {points.slice(1).map((p, i) => (
        <line
          key={i}
          x1={Math.round(i * step)}
          y1={y(points[i].confidence)}
          x2={Math.round((i + 1) * step)}
          y2={y(p.confidence)}
          stroke={colorFor(p.candidate)}
          strokeWidth={2}
          strokeLinecap="square"
          shapeRendering="crispEdges"
        />
      ))}
      {points.map((p, i) =>
        i > 0 && p.candidate !== points[i - 1].candidate ? (
          <rect key={`f${i}`} x={Math.round(i * step) - 2} y={y(p.confidence) - 2} width={4} height={4} fill={colorFor(p.candidate)} shapeRendering="crispEdges" />
        ) : null,
      )}
    </svg>
  );
}
