import { useEffect, useState } from "react";
import { useUserProfile } from "../context/UserProfileContext";
import WeatherWidget from "./WeatherWidget";
import type { WeatherKind } from "../types/messages";

interface PlayerHUDProps {
  /** When true, hides the clock/weather chips and only shows scoreboard. */
  compact?: boolean;
  worldClock?: { hour: number; minute: number };
  weather?: WeatherKind;
  /** Total NPC count (defaults to 26 — the demo agent count). */
  totalAgents?: number;
}

const ELECTION_DATE = new Date("2026-04-16T00:00:00");

function formatTime(h: number, m: number): string {
  const period = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  const mm = m < 10 ? `0${m}` : `${m}`;
  return `${hh}:${mm} ${period}`;
}

function daysUntilElection(): number {
  const now = new Date();
  const ms = ELECTION_DATE.getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
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
  totalAgents = 26,
}: PlayerHUDProps) {
  const { profile } = useUserProfile();
  const metCount = profile?.metAgents?.length ?? 0;
  const persuadedCount = profile?.persuadedAgents?.length ?? 0;

  const [days, setDays] = useState(daysUntilElection());
  useEffect(() => {
    const id = setInterval(() => setDays(daysUntilElection()), 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className={`player-hud ${compact ? "player-hud--compact" : ""}`}>
      {!compact && worldClock && (
        <div className="player-hud-chip" title="In-game time">
          <span style={{ display: "inline-flex" }}>
            {worldClock.hour >= 19 || worldClock.hour < 6 ? <MoonIcon /> : <SunIcon />}
          </span>
          <span>{formatTime(worldClock.hour, worldClock.minute)}</span>
        </div>
      )}

      {!compact && (
        <WeatherWidget weather={weather} compact />
      )}

      <div className="player-hud-chip player-hud-chip--met" title="Agents you've met">
        <span>Met</span>
        <strong>{metCount} / {totalAgents}</strong>
      </div>

      <div className="player-hud-chip player-hud-chip--persuaded" title="Agents you have persuaded">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <StarIcon /> Persuaded
        </span>
        <strong>{persuadedCount} / {totalAgents}</strong>
      </div>

      {!compact && (
        <div className="player-hud-chip player-hud-chip--countdown" title="Election countdown">
          <span>Election in</span>
          <strong>{days}d</strong>
        </div>
      )}
    </div>
  );
}
