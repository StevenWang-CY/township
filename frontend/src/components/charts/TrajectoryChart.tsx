/* ── TrajectoryChart ─────────────────────────────────────────
 * How the tally moved round by round: a stacked area in the scenario's
 * stance order, undecided on top and hatched, drawn as plain SVG so it
 * scales with its card and needs no chart library. Static under reduced
 * motion (it never animates anyway).
 * ─────────────────────────────────────────────────────────── */

import { useId } from "react";
import { useScenario } from "../../hooks/useScenario";

interface TrajectoryChartProps {
  points: Array<{ round: number; counts: Record<string, number> }>;
  /** Label under the x axis for each point (defaults to "r<n>"). */
  labelFor?: (round: number) => string;
  height?: number;
}

export default function TrajectoryChart({ points, labelFor, height = 120 }: TrajectoryChartProps) {
  const scen = useScenario();
  const patternId = useId();
  if (points.length < 2) {
    return <p className="trajectory-empty">The trajectory appears once two rounds have closed.</p>;
  }
  const W = 320;
  const H = height;
  const padL = 8;
  const padR = 8;
  const padT = 6;
  const padB = 4;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const ids = scen.stanceIds;
  const totals = points.map((p) => ids.reduce((a, id) => a + (p.counts[id] ?? 0), 0));
  const maxTotal = Math.max(1, ...totals);
  const x = (i: number) => padL + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  // Stack bottom-up in stance order: options first, undecided last (top).
  const cumulative: number[][] = points.map(() => []);
  points.forEach((p, i) => {
    let acc = 0;
    ids.forEach((id) => { acc += p.counts[id] ?? 0; cumulative[i].push(acc); });
  });
  const y = (v: number) => padT + innerH - (v / maxTotal) * innerH;
  const areas = ids.map((id, k) => {
    const top = points.map((_, i) => `${x(i).toFixed(1)},${y(cumulative[i][k]).toFixed(1)}`);
    const bottom = points.map((_, i) => `${x(i).toFixed(1)},${y(k === 0 ? 0 : cumulative[i][k - 1]).toFixed(1)}`).reverse();
    return { id, d: `M${top.join(" L")} L${bottom.join(" L")} Z` };
  });
  const label = labelFor ?? ((r: number) => `r${r}`);
  const summary = points.map((p) => `round ${p.round}: ` + ids.map((id) => `${scen.optionLabel(id)} ${p.counts[id] ?? 0}`).join(", ")).join("; ");
  return (
    <div className="trajectory">
      <svg className="trajectory-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Tally by round — ${summary}`} preserveAspectRatio="none">
        <defs>
          <pattern id={patternId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="var(--color-undecided)" />
            <rect width="3" height="6" fill="var(--color-surface-2)" />
          </pattern>
        </defs>
        {areas.map((a) => (
          <path
            key={a.id}
            d={a.d}
            fill={a.id === scen.undecidedId ? `url(#${patternId})` : scen.optionColor(a.id)}
            fillOpacity={a.id === scen.undecidedId ? 1 : 0.85}
            stroke="var(--color-surface-card)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {points.map((p, i) => (
          <line key={p.round} x1={x(i)} x2={x(i)} y1={padT} y2={padT + innerH} stroke="var(--color-line)" strokeWidth="1" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className="trajectory-ticks" aria-hidden="true">
        {points.map((p, i) => (
          <span
            key={p.round}
            className="trajectory-tick"
            style={{ left: `${((x(i) - padL) / innerW) * 100}%`, transform: i === 0 ? "none" : i === points.length - 1 ? "translateX(-100%)" : "translateX(-50%)" }}
          >
            {label(p.round)}
          </span>
        ))}
      </div>
    </div>
  );
}
