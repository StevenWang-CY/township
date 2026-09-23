/* ── LiveTransport ───────────────────────────────────────────
 * The campaign's transport in the dock under a live town's canvas:
 * pause/resume at the next beat, the pace between beats (1× / 4× / 16×),
 * "Skip to next day", where the calendar stands with the run's progress,
 * the budget when one is armed, and a notice when the provider — not the
 * viewer — paused the run. Shown only for a campaign that is running or
 * paused; the quick plan and the hosted replay never mount it.
 * ─────────────────────────────────────────────────────────── */

import { useState } from "react";
import type { SimulationStatus } from "../types/messages";
import { calendarHeadline, pausedNotice, type CalendarState } from "../lib/calendar";
import Icon from "./Icon";

export const TRANSPORT_SPEEDS = [1, 4, 16] as const;

interface LiveTransportProps {
  status: SimulationStatus;
  /** The reducer's calendar (rides the socket, so it leads the polled status). */
  calendar: CalendarState | null;
  electionDate?: string | null;
  busy?: boolean;
  error?: string | null;
  onPause: () => unknown;
  onResume: () => unknown;
  onSpeed: (multiplier: number) => unknown;
  onSkipDay: () => unknown;
}

/** A campaign that is under way (running, or paused between beats). */
export function transportVisible(status: SimulationStatus | null | undefined): status is SimulationStatus {
  return Boolean(status && status.preset === "campaign" && (status.status === "running" || status.paused));
}

/** The calendar as the polled status reports it (before the first beat's
 *  round_started reaches the socket, or on a page opened mid-run). */
function calendarFromStatus(status: SimulationStatus): CalendarState | null {
  if (typeof status.day !== "number") return null;
  return {
    day: status.day,
    // The status carries no plan, so the day's place in the run is unknown
    // here; the reducer's calendar supplies it as soon as a beat arrives.
    dayIndex: null,
    date: status.date ?? null,
    weekday: status.weekday ?? null,
    beat: status.beat ?? null,
    label: status.label ?? null,
    totalDays: status.total_days ?? null,
    preset: status.preset ?? null,
  };
}

export default function LiveTransport({
  status, calendar, electionDate, busy = false, error, onPause, onResume, onSpeed, onSkipDay,
}: LiveTransportProps) {
  const paused = Boolean(status.paused);
  const providerPause = pausedNotice(status.paused_reason);
  const cal = calendar ?? calendarFromStatus(status);
  const readout = cal ? calendarHeadline(cal, electionDate) : "Starting the campaign…";
  const progress = typeof status.progress === "number" ? Math.max(0, Math.min(1, status.progress)) : null;
  const pct = progress === null ? null : Math.round(progress * 100);
  const speed = typeof status.speed === "number" ? status.speed : 1;
  const activeSpeed = TRANSPORT_SPEEDS.reduce(
    (best, s) => (Math.abs(s - speed) < Math.abs(best - speed) ? s : best),
    TRANSPORT_SPEEDS[0] as number,
  );
  const budget = status.budget;

  // "Skip to next day" reads as pending until the calendar turns over: the
  // day it was pressed on is remembered, and the button wakes with day + 1.
  const [skipFrom, setSkipFrom] = useState<number | null>(null);
  const day = cal?.day ?? null;
  const skipping = skipFrom !== null && (day === null || day === skipFrom);

  return (
    <div className="media-bar media-bar--transport live-transport" role="group" aria-label="Campaign transport">
      <button
        type="button"
        className="live-transport-btn live-transport-btn--primary"
        onClick={() => { void (paused ? onResume() : onPause()); }}
        disabled={busy}
        title={paused ? "Resume the campaign" : "Pause at the next beat"}
      >
        <Icon name={paused ? "play" : "pause"} size={13} />
        <span>{paused ? "Resume" : "Pause"}</span>
      </button>

      <div className="live-transport-speeds" role="group" aria-label="Pace between beats">
        {TRANSPORT_SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            className={`live-transport-speed${activeSpeed === s ? " live-transport-speed--active" : ""}`}
            aria-pressed={activeSpeed === s}
            aria-label={`${s}× pace`}
            disabled={busy}
            onClick={() => { void onSpeed(s); }}
          >
            {s}×
          </button>
        ))}
      </div>

      <button
        type="button"
        className="live-transport-btn"
        disabled={busy || skipping}
        onClick={() => { setSkipFrom(day ?? 0); void onSkipDay(); }}
        title="Run the rest of today without pausing between beats"
      >
        <span>{skipping ? "Skipping…" : "Skip to next day"}</span>
        <Icon name="arrow-right" size={12} />
      </button>

      <div className="live-transport-readout" aria-live="off">
        <span className="live-transport-day" title={readout}>{readout}</span>
        {pct !== null && (
          <span className="live-transport-progress" title={`${pct}% of the run's beats`}>
            <span className="live-transport-track" aria-hidden="true">
              <span className="live-transport-fill" style={{ width: `${pct}%` }} />
            </span>
            <span className="live-transport-pct">{pct}%</span>
          </span>
        )}
      </div>

      {budget && budget.limit != null && (
        <span
          className="live-transport-budget"
          title={`${budget.calls} calls so far · about $${budget.estimate_per_beat.toFixed(2)} per beat`}
        >
          Budget ${budget.spent.toFixed(2)} of ${budget.limit.toFixed(2)}
        </span>
      )}

      {providerPause ? (
        <span className="live-transport-notice" role="status">
          <Icon name="info" size={13} /> {providerPause}
        </span>
      ) : paused ? (
        <span className="live-transport-notice live-transport-notice--quiet" role="status">Paused</span>
      ) : null}

      {error && <span className="live-transport-error" role="alert">{error}</span>}
    </div>
  );
}
