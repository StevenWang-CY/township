/* ── DaySummaryCard ──────────────────────────────────────────
 * The day in review, shown for a few seconds when the calendar turns: who
 * changed their mind here and why, what the news said, how many voted.
 * A status region (announced, not focus-stealing); dismissable.
 * ─────────────────────────────────────────────────────────── */

import { useScenario } from "../hooks/useScenario";
import { formatDate, formatWeekday } from "../lib/calendar";
import { readableInk } from "../lib/color";
import type { DaySummary } from "../lib/selectors";
import Icon from "./Icon";

interface DaySummaryCardProps {
  summary: DaySummary;
  townId: string;
  onDismiss: () => void;
}

export default function DaySummaryCard({ summary, townId, onDismiss }: DaySummaryCardProps) {
  const scen = useScenario();
  const here = summary.flips.filter((f) => f.town === townId);
  const flips = (here.length > 0 ? here : summary.flips).slice(0, 3);
  const elsewhere = here.length === 0 && summary.flips.length > 0;
  const date = formatDate(summary.date) ?? null;
  const weekday = formatWeekday(summary.weekday, "long");
  return (
    <div className="day-summary-card pixel-frame" role="status" aria-live="polite">
      <div className="day-summary-head">
        <span className="day-summary-kicker">Day {summary.day} in review</span>
        {(weekday || date) && (
          <span className="day-summary-date">{[weekday, date].filter(Boolean).join(", ")}</span>
        )}
        <button type="button" className="day-summary-close" onClick={onDismiss} aria-label="Dismiss the day in review">
          <Icon name="close" size={12} />
        </button>
      </div>
      <ul className="day-summary-list">
        {flips.map((f) => {
          const color = scen.optionColor(f.to ?? undefined);
          return (
            <li key={`${f.agentId}-${f.id}`} className="day-summary-flip">
              <strong>{f.agentName}</strong>
              {elsewhere && <span className="day-summary-town"> ({scen.townMeta(f.town).name})</span>}
              <span className="day-summary-arrow" aria-hidden="true"> → </span>
              <span className="sr-only"> now leans </span>
              <strong style={{ color: readableInk(color, 5) }}>{scen.optionLabel(f.to ?? undefined)}</strong>
              {f.cause && <span className="day-summary-cause"> · {f.cause}</span>}
            </li>
          );
        })}
        {flips.length === 0 && <li className="day-summary-quiet">Nobody changed their mind.</li>}
        {summary.headlines.slice(0, 2).map((h) => (
          <li key={h} className="day-summary-news"><span className="day-summary-label">News</span> {h}</li>
        ))}
        {summary.votes > 0 && (
          <li className="day-summary-votes"><span className="day-summary-label">Ballots</span> {summary.votes} cast</li>
        )}
      </ul>
    </div>
  );
}
