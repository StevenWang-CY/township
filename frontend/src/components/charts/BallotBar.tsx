/* ── BallotBar ───────────────────────────────────────────────
 * A stacked horizontal bar of a tally: one segment per stance in the
 * scenario's canonical order, undecided last and hatched. Labels with
 * counts and shares sit beneath; the bar itself carries an accessible
 * summary. Replaces the dashboard donuts.
 * ─────────────────────────────────────────────────────────── */

import { useScenario } from "../../hooks/useScenario";
import { readableInk } from "../../lib/color";

interface BallotBarProps {
  counts: Record<string, number>;
  /** Hide the label row (tight cards). */
  compact?: boolean;
  /** Bar height in px. */
  height?: number;
  /** Optional caption before the label row. */
  caption?: string;
}

export default function BallotBar({ counts, compact = false, height = compact ? 10 : 14, caption }: BallotBarProps) {
  const scen = useScenario();
  const ids = scen.stanceIds.filter((id) => (counts[id] ?? 0) > 0);
  const total = ids.reduce((a, id) => a + (counts[id] ?? 0), 0);
  const summary = ids.map((id) => `${scen.optionLabel(id)} ${counts[id]}`).join(", ");
  if (total === 0) {
    return (
      <div className={`ballot-bar ballot-bar--empty${compact ? " ballot-bar--compact" : ""}`} aria-label="No tally yet">
        <div className="ballot-bar-track" style={{ height }} />
        {!compact && <p className="ballot-bar-empty">No tally yet</p>}
      </div>
    );
  }
  return (
    <div className={`ballot-bar${compact ? " ballot-bar--compact" : ""}`}>
      {caption && <p className="ballot-bar-caption">{caption}</p>}
      <div className="ballot-bar-track" style={{ height }} role="img" aria-label={`${summary} of ${total}`}>
        {ids.map((id) => {
          const n = counts[id] ?? 0;
          const undecided = id === scen.undecidedId;
          return (
            <span
              key={id}
              className={`ballot-bar-seg${undecided ? " ballot-bar-seg--undecided" : ""}`}
              style={{ width: `${(n / total) * 100}%`, background: undecided ? undefined : scen.optionColor(id) }}
              title={`${scen.optionLabel(id)}: ${n} (${Math.round((n / total) * 100)}%)`}
            />
          );
        })}
      </div>
      {!compact && (
        <ul className="ballot-bar-legend">
          {ids.map((id) => {
            const n = counts[id] ?? 0;
            const undecided = id === scen.undecidedId;
            return (
              <li key={id} data-stance-id={id} data-stance-count={n}>
                <span className={`ballot-bar-dot${undecided ? " ballot-bar-dot--undecided" : ""}`} style={{ background: undecided ? undefined : scen.optionColor(id) }} aria-hidden="true" />
                <span className="ballot-bar-label" style={{ color: undecided ? "var(--color-ink-2)" : readableInk(scen.optionColor(id), 5) }}>{scen.optionLabel(id)}</span>
                <span className="ballot-bar-count">{n}</span>
                <span className="ballot-bar-pct">{Math.round((n / total) * 100)}%</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
