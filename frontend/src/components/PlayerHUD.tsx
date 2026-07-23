import { useUserProfile } from "../context/UserProfileContext";
import { useScenario } from "../hooks/useScenario";
import WeatherWidget from "./WeatherWidget";
import { DEMO_MODE } from "../demo/demoMode";
import type { WeatherKind } from "../types/messages";

interface PlayerHUDProps {
  /** When true, hides the clock/weather chips and only shows scoreboard. */
  compact?: boolean;
  worldClock?: { hour: number; minute: number };
  weather?: WeatherKind;
  /** Total resident count when an authoritative roster is available. */
  totalAgents?: number;
  /** Current simulation/replay round (used by the Recorded chip). */
  round?: number;
  /** Total rounds when known. */
  totalRounds?: number;
}

function formatTime(h: number, m: number): string {
  const period = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  const mm = m < 10 ? `0${m}` : `${m}`;
  return `${hh}:${mm} ${period}`;
}

/** "2026-04-16" → "Apr 16" — the scenario's own calendar, never the viewer's. */
function shortDate(dateISO: string | undefined): string | null {
  if (!dateISO) return null;
  const d = new Date(`${dateISO}T00:00:00`);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* ── Inline SVG icons (replaces emoji) ─────────────────────────── */

function SunIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
      <circle cx="8" cy="8" r="3" />
      <line x1="8" y1="1.5" x2="8" y2="3" />
      <line x1="8" y1="13" x2="8" y2="14.5" />
      <line x1="1.5" y1="8" x2="3" y2="8" />
      <line x1="13" y1="8" x2="14.5" y2="8" />
      <line x1="3.3" y1="3.3" x2="4.4" y2="4.4" />
      <line x1="11.6" y1="11.6" x2="12.7" y2="12.7" />
      <line x1="3.3" y1="12.7" x2="4.4" y2="11.6" />
      <line x1="11.6" y1="4.4" x2="12.7" y2="3.3" />
    </svg>
  );
}

function MoonIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 9.5A6 6 0 1 1 6.5 3a4.5 4.5 0 0 0 6.5 6.5z" />
    </svg>
  );
}

function StarIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 1.5l1.95 4.18 4.55.5-3.4 3.07.95 4.45L8 11.4l-4.05 2.3.95-4.45L1.5 6.18l4.55-.5L8 1.5z" />
    </svg>
  );
}

export default function PlayerHUD({
  compact = false,
  worldClock,
  weather = "clear",
  totalAgents,
  round,
  totalRounds,
}: PlayerHUDProps) {
  const { profile } = useUserProfile();
  const scen = useScenario();
  // Player-quest chrome (Met / Persuaded) exists only when a real player
  // walks the town. The hosted replay and any spectator view have none.
  const hasPlayer = !DEMO_MODE && profile !== null;
  const metCount = profile?.metAgents?.length ?? 0;
  const persuadedCount = profile?.persuadedAgents?.length ?? 0;
  const total = totalAgents;

  // The decision chip speaks the SIMULATION's calendar (scenario.dates), never
  // the viewer's wall clock — a 2026 replay watched in 2027 must not say "0d".
  const decisionDate = shortDate(scen.scenario.dates?.decision_day);
  const decisionLabel = scen.decisionKind === "election" ? "Election day" : "Decision day";

  const roundKnown = totalRounds != null && totalRounds > 0;
  const clockLabel = worldClock ? formatTime(worldClock.hour, worldClock.minute) : null;

  return (
    <div className={`player-hud ${compact ? "player-hud--compact" : ""}`}>
      {/* Replay provenance chip — the recorded round + the sim's own clock. */}
      {DEMO_MODE && (
        <div className="player-hud-chip player-hud-chip--recorded" title="A recorded simulation, replayed in your browser">
          <span className="player-hud-recorded-dot" aria-hidden="true" />
          <span>Recorded</span>
          {roundKnown && <strong>Round {round ?? 0}/{totalRounds}</strong>}
          {!compact && clockLabel && <span className="player-hud-chip-quiet">{clockLabel}</span>}
        </div>
      )}

      {!DEMO_MODE && !compact && worldClock && (
        <div className="player-hud-chip" title="In-simulation time">
          <span style={{ display: "inline-flex" }}>
            {worldClock.hour >= 19 || worldClock.hour < 6 ? <MoonIcon /> : <SunIcon />}
          </span>
          <span>{clockLabel}</span>
        </div>
      )}

      {!compact && !DEMO_MODE && (
        <WeatherWidget weather={weather} compact />
      )}

      {hasPlayer && (
        <div className="player-hud-chip player-hud-chip--met" title="Agents you've met">
          <span>Met</span>
          <strong>{total != null ? `${metCount} / ${total}` : metCount}</strong>
        </div>
      )}

      {hasPlayer && (
        <div className="player-hud-chip player-hud-chip--persuaded" title="Agents you have persuaded">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <StarIcon /> Persuaded
          </span>
          <strong>{total != null ? `${persuadedCount} / ${total}` : persuadedCount}</strong>
        </div>
      )}

      {!DEMO_MODE && !compact && decisionDate && (
        <div className="player-hud-chip player-hud-chip--countdown" title={scen.scenario.dates?.prose || decisionLabel}>
          <span>{decisionLabel}</span>
          <strong>{decisionDate}</strong>
        </div>
      )}
    </div>
  );
}
