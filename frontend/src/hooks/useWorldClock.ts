import { useMemo } from "react";

/* ── Helper: format world-clock fields for display ─────────── */

export interface WorldClockFormatted {
  hour: number;
  minute: number;
  hour12: number;
  meridiem: "AM" | "PM";
  label: string; // e.g. "7:42 AM"
  partOfDay: "dawn" | "morning" | "afternoon" | "evening" | "night";
  isDaytime: boolean;
}

function partOfDay(hour: number): WorldClockFormatted["partOfDay"] {
  if (hour < 6) return "night";
  if (hour < 9) return "dawn";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 21) return "evening";
  return "night";
}

export function useWorldClock(clock: { hour: number; minute: number }): WorldClockFormatted {
  return useMemo(() => {
    const hour = ((clock.hour % 24) + 24) % 24;
    const minute = Math.max(0, Math.min(59, Math.floor(clock.minute)));
    const meridiem: "AM" | "PM" = hour < 12 ? "AM" : "PM";
    const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    const label = `${hour12}:${minute.toString().padStart(2, "0")} ${meridiem}`;
    const pod = partOfDay(hour);
    return {
      hour,
      minute,
      hour12,
      meridiem,
      label,
      partOfDay: pod,
      isDaytime: hour >= 6 && hour < 20,
    };
  }, [clock.hour, clock.minute]);
}
