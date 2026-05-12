/**
 * Per-agent daily routine — parses YAML-style entries (already deserialized
 * to JS objects by the backend) and answers "where should this agent be
 * right now?" Used by TownScene to drive routine-aware movement.
 */

export interface RoutineEntry {
  /** "HH:MM" 24-hour. */
  time: string;
  /** Landmark name (must match `LandmarkData.name`). */
  location: string;
  /** Free-text description, e.g. "Opens restaurant, prep". */
  activity: string;
}

export class Routine {
  public entries: RoutineEntry[];

  constructor(entries: RoutineEntry[] = []) {
    // Pre-sort so currentEntryAt is O(n) without redundant compares.
    this.entries = [...entries].sort((a, b) =>
      Routine.timeToMinutes(a.time) - Routine.timeToMinutes(b.time),
    );
  }

  /** Returns the most recent qualifying entry — i.e. the row whose `time` is
   * the latest one not later than (hour:minute). Wraps around midnight if
   * no row matches (returns the LAST entry of the day). */
  currentEntryAt(hour: number, minute: number): RoutineEntry | undefined {
    if (this.entries.length === 0) return undefined;
    const now = hour * 60 + minute;
    let candidate: RoutineEntry | undefined;
    for (const e of this.entries) {
      const t = Routine.timeToMinutes(e.time);
      if (t <= now) candidate = e;
      else break;
    }
    // Wrap: if before the earliest entry today, use yesterday's last.
    return candidate ?? this.entries[this.entries.length - 1];
  }

  static timeToMinutes(t: string): number {
    const [h, m] = t.split(":").map((s) => parseInt(s, 10));
    return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
  }
}
