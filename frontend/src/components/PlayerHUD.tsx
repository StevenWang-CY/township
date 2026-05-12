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
          <span style={{ fontSize: 12 }}>{worldClock.hour >= 18 || worldClock.hour < 6 ? "🌙" : "☀"}</span>
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
        <span>★ Persuaded</span>
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
