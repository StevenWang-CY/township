/* ── TodayStrip ──────────────────────────────────────────────
 * Where the town is in its deliberation: the round (or, on a campaign,
 * the day and its date), the beats of the day with the current one lit,
 * the sim clock and weather, the distance to election day, what is on
 * today, and the latest headline. A recording without a calendar reads
 * exactly as before: "Round 3 of 5" and the quick plan's beats.
 * ─────────────────────────────────────────────────────────── */

import { useScenario } from "../hooks/useScenario";
import { PHASE_LABEL, normalizePhase } from "../lib/election";
import {
  beatLabel,
  electionCountdown,
  formatDate,
  formatDay,
  isElectionDay,
  phasesForRound,
  type CalendarState,
} from "../lib/calendar";
import type { ElectionPhase } from "../game/CivicLayer";
import type { RunPlanEntry, ScenarioRoundPlanEntry, WeatherKind } from "../types/messages";
import WeatherWidget from "./WeatherWidget";
import Icon from "./Icon";

interface TodayStripProps {
  plan: ScenarioRoundPlanEntry[];
  round: number;
  totalRounds: number;
  phase: ElectionPhase;
  running: boolean;
  ended: boolean;
  clock: { hour: number; minute: number };
  weather: WeatherKind;
  headline?: string | null;
  headlineRound?: number | null;
  /** The campaign calendar (null on the quick plan and older recordings). */
  calendar?: CalendarState | null;
  /** The run's own plan (empty for a fixed replay; the scenario plan then wins). */
  runPlan?: RunPlanEntry[];
}

function fmtClock(h: number, m: number): string {
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

function shortDate(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  return isNaN(d.getTime()) ? null : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

const KNOWN: ElectionPhase[] = ["seed", "converse", "news", "opinion", "decide", "results"];

/** The round's beats in the town's vocabulary, each once, plan aliases resolved. */
function beatsOf(phases: string[]): ElectionPhase[] {
  const out: ElectionPhase[] = [];
  for (const raw of phases) {
    const p = normalizePhase(raw);
    if ((KNOWN as string[]).includes(p) && !out.includes(p as ElectionPhase)) out.push(p as ElectionPhase);
  }
  return out;
}

export default function TodayStrip({
  plan, round, totalRounds, phase, running, ended, clock, weather, headline, headlineRound,
  calendar = null, runPlan = [],
}: TodayStripProps) {
  const scen = useScenario();
  const beats = beatsOf(phasesForRound(runPlan, plan, round));
  const current = beats.indexOf(phase);
  const decision = shortDate(scen.scenario.dates?.decision_day);
  const decisionLabel = scen.decisionKind === "election" ? "Election day" : "Decision day";
  const roundKnown = totalRounds > 0;
  const night = clock.hour >= 19 || clock.hour < 6;

  // The campaign day: "Day 12 of 21", "Wednesday, April 8 · Morning", how
  // far the election is, and what the plan has on today.
  const electionDate = scen.scenario.campaign?.election_date ?? scen.scenario.dates?.decision_day ?? null;
  const electionDay = calendar ? isElectionDay(calendar, electionDate) || calendar.label === "Election day" : false;
  const dateLine = calendar
    ? [
      formatDate(calendar.date, { weekday: "long", month: "long" }),
      calendar.beat ? beatLabel(calendar.beat, { electionDay }) : null,
    ].filter(Boolean).join(" · ")
    : null;
  const countdown = calendar && scen.scenario.campaign
    ? electionCountdown(calendar, electionDate, {
      label: decisionLabel,
      after: scen.decisionKind === "election" ? "election" : "vote",
    })
    : null;
  const todaysEvents = (() => {
    if (!calendar) return [] as string[];
    const labels: string[] = [];
    for (const r of runPlan) {
      if (r.day === calendar.day && r.label && !labels.includes(r.label)) labels.push(r.label);
    }
    if (labels.length === 0 && calendar.label) labels.push(calendar.label);
    // "Election day" / "The morning after" already head the strip.
    return labels.filter((l) => l !== "Election day" && l !== "The morning after");
  })();

  const heading = calendar
    ? formatDay(calendar)
    : ended ? "The town has decided" : roundKnown ? `Round ${round} of ${totalRounds}` : running ? "Starting…" : "No run yet";

  return (
    <div className="today-strip">
      <div className="today-head">
        <span className="today-round">{heading}</span>
        <span className="today-clock" title="In-simulation time">
          <Icon name={night ? "moon" : "sun"} size={13} /> {fmtClock(clock.hour, clock.minute)}
        </span>
      </div>

      {dateLine && (
        <p className="today-date">
          {dateLine}
          {ended && <span className="today-date-note"> · The town has decided</span>}
        </p>
      )}

      {countdown && (
        <p className={`today-countdown${electionDay ? " today-countdown--today" : ""}`}>
          <Icon name="ballot" size={13} /> {countdown}
        </p>
      )}

      {beats.length > 0 && (
        <ol className="today-beats" aria-label={calendar ? "Phases of this beat" : "Phases of this round"}>
          {beats.map((b, i) => {
            const state = ended ? "done" : i < current ? "done" : i === current ? "now" : "next";
            return (
              <li key={b} className={`today-beat today-beat--${state}`} aria-current={state === "now" ? "step" : undefined}>
                <span className="today-beat-mark" aria-hidden="true">{state === "done" ? <Icon name="check" size={10} /> : null}</span>
                <span className="today-beat-label">{PHASE_LABEL[b]}</span>
              </li>
            );
          })}
        </ol>
      )}

      {todaysEvents.length > 0 && (
        <p className="today-events">
          <span className="today-kicker"><Icon name="star" size={12} /> Events today</span>
          <span className="today-events-list">{todaysEvents.join(" · ")}</span>
        </p>
      )}

      <dl className="today-facts">
        <div>
          <dt>Weather</dt>
          <dd><WeatherWidget weather={weather} compact /></dd>
        </div>
        {decision && (
          <div>
            <dt>{decisionLabel}</dt>
            <dd><Icon name="calendar" size={13} /> {decision}</dd>
          </div>
        )}
      </dl>

      {headline && (
        <div className="today-headline">
          <span className="today-kicker"><Icon name="news" size={13} /> Latest news{headlineRound != null ? ` · r${headlineRound}` : ""}</span>
          <p>{headline}</p>
        </div>
      )}
      {!headline && roundKnown && !ended && (
        <p className="today-quiet">No headline has landed yet this run.</p>
      )}
    </div>
  );
}
