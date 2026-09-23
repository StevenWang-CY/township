/* ── TodayStrip ──────────────────────────────────────────────
 * Where the town is in its deliberation: the round, the beats of the day
 * with the current one lit, the sim clock and weather, the decision date,
 * and the latest headline. Phase 6 adds the campaign day and date.
 * ─────────────────────────────────────────────────────────── */

import { useScenario } from "../hooks/useScenario";
import { PHASE_LABEL } from "../lib/election";
import type { ElectionPhase } from "../game/CivicLayer";
import type { ScenarioRoundPlanEntry, WeatherKind } from "../types/messages";
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

export default function TodayStrip({ plan, round, totalRounds, phase, running, ended, clock, weather, headline, headlineRound }: TodayStripProps) {
  const scen = useScenario();
  const entry = plan.find((r) => r.round === round);
  const beats = (entry?.phases ?? []).filter((p): p is ElectionPhase => (KNOWN as string[]).includes(p));
  const current = beats.indexOf(phase);
  const decision = shortDate(scen.scenario.dates?.decision_day);
  const decisionLabel = scen.decisionKind === "election" ? "Election day" : "Decision day";
  const roundKnown = totalRounds > 0;
  const night = clock.hour >= 19 || clock.hour < 6;

  return (
    <div className="today-strip">
      <div className="today-head">
        <span className="today-round">
          {ended ? "The town has decided" : roundKnown ? `Round ${round} of ${totalRounds}` : running ? "Starting…" : "No run yet"}
        </span>
        <span className="today-clock" title="In-simulation time">
          <Icon name={night ? "moon" : "sun"} size={13} /> {fmtClock(clock.hour, clock.minute)}
        </span>
      </div>

      {beats.length > 0 && (
        <ol className="today-beats" aria-label="Phases of this round">
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
