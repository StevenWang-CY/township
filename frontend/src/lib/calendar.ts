/**
 * Pure campaign-calendar helpers: the day, date, weekday and beat a run is
 * on, how the HUD and the Today strip phrase them, how far the election is,
 * which phases a round has (the run's own plan first, the scenario's quick
 * plan as the fallback), and how a recorded feed splits into chapters —
 * one per campaign day when the recording carries days, one per round when
 * it does not. No Intl, no time zones: the scenario's calendar is spelled
 * out from its ISO dates so a replay reads the same everywhere.
 */
import type {
  CampaignBeat,
  RunPlanEntry,
  RunPreset,
  ScenarioRoundPlanEntry,
  SimulationEvent,
  Weekday,
} from "../types/messages";

/* ── The calendar the reducer keeps ─────────────────────────── */

export interface CalendarState {
  /** The campaign day as the wire numbers it — counted from the scenario's
   *  authored start, so a run trimmed to its last 3 days opens on day 19. */
  day: number;
  /** 1-based position of `day` among the run's own days (null without a
   *  plan). This is what "Day 1 of 4" reads; `day` still matches the plan. */
  dayIndex: number | null;
  /** "YYYY-MM-DD" when the wire carried it. */
  date: string | null;
  weekday: Weekday | null;
  beat: CampaignBeat | null;
  /** A named beat ("Debate night in Montclair", "Election day"). */
  label: string | null;
  /** Days in the run's plan, or null when the plan never arrived. */
  totalDays: number | null;
  preset: RunPreset | null;
}

/* ── Dates without Intl ─────────────────────────────────────── */

export const WEEKDAYS: readonly Weekday[] = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
];

const WEEKDAY_SHORT: Record<Weekday, string> = {
  monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun",
};
const WEEKDAY_LONG: Record<Weekday, string> = {
  monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday", friday: "Friday", saturday: "Saturday", sunday: "Sunday",
};
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export interface ISODateParts { year: number; month: number; day: number }

/** Strict "YYYY-MM-DD" → parts, or null for anything else (no Date parsing). */
export function parseISODate(iso: string | null | undefined): ISODateParts | null {
  if (typeof iso !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Reject Feb 30 and friends: the UTC round trip must land on the same day.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return { year, month, day };
}

function utcDays(parts: ISODateParts): number {
  return Math.round(Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000);
}

/** Whole days from `fromISO` to `toISO` (positive when `to` is later). */
export function daysBetween(fromISO: string | null | undefined, toISO: string | null | undefined): number | null {
  const a = parseISODate(fromISO);
  const b = parseISODate(toISO);
  if (!a || !b) return null;
  return utcDays(b) - utcDays(a);
}

/** The weekday of an ISO date, computed in UTC so no viewer time zone can shift it. */
export function weekdayForDate(iso: string | null | undefined): Weekday | null {
  const parts = parseISODate(iso);
  if (!parts) return null;
  // getUTCDay: 0 = Sunday … 6 = Saturday; WEEKDAYS starts on Monday.
  const dow = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return WEEKDAYS[(dow + 6) % 7];
}

export function isWeekend(weekday: string | null | undefined): boolean {
  return weekday === "saturday" || weekday === "sunday";
}

/** Any wire spelling ("Wed", "wednesday") → the canonical weekday, or null. */
export function normalizeWeekday(value: string | null | undefined): Weekday | null {
  if (!value) return null;
  const key = value.trim().toLowerCase();
  return WEEKDAYS.find((w) => w === key || w.slice(0, 3) === key.slice(0, 3)) ?? null;
}

/** "M", "T", "W", "T", "F", "S", "S" — the ticks of a day timeline. */
export function weekdayInitial(weekday: string | null | undefined): string {
  const w = normalizeWeekday(weekday);
  return w ? WEEKDAY_LONG[w].charAt(0) : "";
}

export function formatWeekday(weekday: string | null | undefined, style: "short" | "long" = "short"): string | null {
  const w = normalizeWeekday(weekday);
  if (!w) return null;
  return style === "long" ? WEEKDAY_LONG[w] : WEEKDAY_SHORT[w];
}

export interface FormatDateOptions {
  /** Prefix the weekday: true/"short" → "Wed", "long" → "Wednesday". */
  weekday?: boolean | "short" | "long";
  /** Comma after the weekday (default true): "Wed, Apr 8" vs "Wed Apr 8". */
  comma?: boolean;
  month?: "short" | "long";
}

/**
 * "2026-04-08" → "Apr 8"; with `{ weekday: true }` → "Wed, Apr 8"; with
 * `{ weekday: "long", month: "long" }` → "Wednesday, April 8". Null when the
 * date is not a real ISO day.
 */
export function formatDate(iso: string | null | undefined, opts: FormatDateOptions = {}): string | null {
  const parts = parseISODate(iso);
  if (!parts) return null;
  const month = (opts.month === "long" ? MONTH_LONG : MONTH_SHORT)[parts.month - 1];
  const core = `${month} ${parts.day}`;
  if (!opts.weekday) return core;
  const weekday = formatWeekday(weekdayForDate(iso), opts.weekday === "long" ? "long" : "short");
  if (!weekday) return core;
  return `${weekday}${opts.comma === false ? "" : ","} ${core}`;
}

/* ── Day, beat, progress ────────────────────────────────────── */

/** "Day 12 of 21" — the day's place in this run; "Day 19" alone when the
 *  run's plan (and so its length) is unknown. */
export function formatDay(cal: Pick<CalendarState, "day" | "dayIndex" | "totalDays"> | null | undefined): string {
  if (!cal) return "";
  const n = cal.dayIndex ?? cal.day;
  return cal.dayIndex && cal.totalDays && cal.totalDays > 0 ? `Day ${n} of ${cal.totalDays}` : `Day ${n}`;
}

const BEAT_LABELS: Record<string, string> = {
  morning: "Morning",
  midday: "Midday",
  afternoon: "Afternoon",
  evening: "Evening",
  night: "Night",
  early: "Early voting",
  late: "Late",
};

/**
 * A beat's display name. On election day the night beat is "Election
 * night" (the count) and the early beat is "Early voting" (the polls open
 * before the town wakes). Unknown beats are title-cased as they came.
 */
export function beatLabel(beat: string | null | undefined, opts: { electionDay?: boolean } = {}): string {
  if (!beat) return "";
  const key = beat.trim().toLowerCase();
  if (opts.electionDay && key === "night") return "Election night";
  if (BEAT_LABELS[key]) return BEAT_LABELS[key];
  return key.charAt(0).toUpperCase() + key.slice(1).replace(/[-_]/g, " ");
}

/** Share of the campaign passed (0..1 by day), or null without a plan length. */
export function progressOf(cal: Pick<CalendarState, "day" | "dayIndex" | "totalDays"> | null | undefined): number | null {
  if (!cal || !cal.totalDays || cal.totalDays <= 0) return null;
  return Math.max(0, Math.min(1, (cal.dayIndex ?? cal.day) / cal.totalDays));
}

/* ── The election on the calendar ───────────────────────────── */

export function isElectionDay(cal: Pick<CalendarState, "date"> | null | undefined, electionDate: string | null | undefined): boolean {
  if (!cal?.date || !electionDate) return false;
  return daysBetween(cal.date, electionDate) === 0;
}

/** Days from the calendar's date to election day (negative afterwards). */
export function daysUntilElection(cal: Pick<CalendarState, "date"> | null | undefined, electionDate: string | null | undefined): number | null {
  if (!cal?.date || !electionDate) return null;
  return daysBetween(cal.date, electionDate);
}

/** "in 4 days" · "tomorrow" · "today" · "yesterday" · "3 days ago" — or null. */
export function electionRelative(cal: Pick<CalendarState, "date"> | null | undefined, electionDate: string | null | undefined): string | null {
  const d = daysUntilElection(cal, electionDate);
  if (d === null) return null;
  if (d > 1) return `in ${d} days`;
  if (d === 1) return "tomorrow";
  if (d === 0) return "today";
  if (d === -1) return "yesterday";
  return `${-d} days ago`;
}

/** "Election day in 4 days" · "Election day tomorrow" · "Election day" ·
 *  "The morning after" · "3 days after the election" — or null. A policy
 *  vote passes its own words: `{ label: "Decision day", after: "vote" }`. */
export function electionCountdown(
  cal: Pick<CalendarState, "date"> | null | undefined,
  electionDate: string | null | undefined,
  words: { label?: string; after?: string } = {},
): string | null {
  const d = daysUntilElection(cal, electionDate);
  if (d === null) return null;
  const label = words.label ?? "Election day";
  const after = words.after ?? "election";
  if (d > 1) return `${label} in ${d} days`;
  if (d === 1) return `${label} tomorrow`;
  if (d === 0) return label;
  if (d === -1) return "The morning after";
  return `${-d} days after the ${after}`;
}

/**
 * The HUD chip's line: "Day 12 of 21 · Wed Apr 8 · Morning", the beat's
 * label appended when the day has one ("· Debate night in Montclair"). On
 * election night the generic "Election day" label is dropped because the
 * beat already says it.
 */
export function calendarHeadline(cal: CalendarState | null | undefined, electionDate?: string | null): string {
  if (!cal) return "";
  const electionDay = isElectionDay(cal, electionDate) || cal.label === "Election day";
  const parts = [formatDay(cal)];
  const date = formatDate(cal.date, { weekday: true, comma: false });
  if (date) parts.push(date);
  const beat = cal.beat ? beatLabel(cal.beat, { electionDay }) : "";
  if (beat) parts.push(beat);
  if (cal.label && !(cal.label === "Election day" && beat === "Election night")) parts.push(cal.label);
  return parts.join(" · ");
}

/** Why a run stopped early, in words: "Stopped at the budget after day 12". */
export function stoppedReasonText(reason: string | null | undefined, day?: number | null): string | null {
  if (!reason) return null;
  const after = day ? ` after day ${day}` : "";
  if (reason === "budget") return `Stopped at the budget${after}`;
  if (reason === "error") return `Stopped on an error${after}`;
  return `Stopped (${reason})${after}`;
}

/** A provider's pause, in words; null for a plain user pause. */
export function pausedNotice(reason: string | null | undefined): string | null {
  if (!reason || reason === "paused") return null;
  return `Paused by the provider: ${reason}`;
}

/* ── Plans ──────────────────────────────────────────────────── */

/** The run's distinct campaign days, ascending (empty without a calendar). */
export function planDays(plan: ReadonlyArray<RunPlanEntry> | null | undefined): number[] {
  const days = new Set<number>();
  for (const r of plan ?? []) if (typeof r.day === "number") days.add(r.day);
  return [...days].sort((a, b) => a - b);
}

/** Distinct campaign days in a run plan, or null when the plan has none. */
export function totalDaysOf(plan: ReadonlyArray<RunPlanEntry> | null | undefined): number | null {
  const n = planDays(plan).length;
  return n > 0 ? n : null;
}

/** 1-based place of `day` among the run's days ("Day 1 of 4" for authored
 *  day 19 of a run trimmed to its last four), or null when unknown. */
export function dayOrdinal(plan: ReadonlyArray<RunPlanEntry> | null | undefined, day: number | null | undefined): number | null {
  if (typeof day !== "number") return null;
  const i = planDays(plan).indexOf(day);
  return i >= 0 ? i + 1 : null;
}

/** The plan entry for `round`: the run's own plan wins, the scenario's quick
 *  plan is the fallback (a fixed replay carries no run plan). */
export function planEntryForRound(
  runPlan: ReadonlyArray<RunPlanEntry> | null | undefined,
  scenarioPlan: ReadonlyArray<ScenarioRoundPlanEntry> | null | undefined,
  round: number,
): RunPlanEntry | ScenarioRoundPlanEntry | undefined {
  return runPlan?.find((r) => r.round === round) ?? scenarioPlan?.find((r) => r.round === round);
}

/** Phases of `round` (see planEntryForRound); empty when neither plan knows it. */
export function phasesForRound(
  runPlan: ReadonlyArray<RunPlanEntry> | null | undefined,
  scenarioPlan: ReadonlyArray<ScenarioRoundPlanEntry> | null | undefined,
  round: number,
): string[] {
  return [...(planEntryForRound(runPlan, scenarioPlan, round)?.phases ?? [])];
}

/* ── Chapters of a recording ────────────────────────────────── */

/** A tick on the replay timeline: a campaign day, or a round when the
 *  recording predates the calendar. */
export interface DayChapter {
  kind: "day" | "round";
  /** The chapter's first round (unique per chapter either way). */
  round: number;
  /** Index of the chapter's first round_started in the feed. */
  index: number;
  /** In-world clock at that round (first world_clock_tick after it). */
  hour: number | null;
  minute: number | null;
  /** The wire's day number (authored numbering) — matches plan entries. */
  day: number | null;
  /** 1-based place among the recording's days — what the tick is called. */
  dayIndex: number | null;
  date: string | null;
  weekday: Weekday | null;
  /** The day's first labelled beat ("Saturday market in Dover"). */
  label: string | null;
}

/** The first clock tick after `i`, up to the next round_started — or, for a
 *  day chapter, up to the first round_started of another day. */
function clockAfter(events: SimulationEvent[], i: number, day: number | null): { hour: number | null; minute: number | null } {
  for (let j = i + 1; j < events.length; j++) {
    const e = events[j];
    if (e.type === "round_started" && (day === null || e.day !== day)) break;
    if (e.type === "world_clock_tick") return { hour: e.hour, minute: e.minute };
  }
  return { hour: null, minute: null };
}

/**
 * Chapters of a feed. When any round_started carries a day, one chapter
 * per day at the index of the day's first round; otherwise one per round
 * (multi-town runs emit round_started once per town — the first occurrence
 * of each round or day is the chapter).
 */
export function chaptersByDay(events: SimulationEvent[]): DayChapter[] {
  const dayMode = events.some((e) => e.type === "round_started" && typeof e.day === "number");
  const out: DayChapter[] = [];
  const seen = new Map<number, DayChapter>();
  for (let i = 0; i < events.length; i++) {
    const evt = events[i];
    if (evt.type !== "round_started") continue;
    if (dayMode) {
      if (typeof evt.day !== "number") continue;
      const existing = seen.get(evt.day);
      if (existing) {
        if (!existing.label && evt.label) existing.label = evt.label;
        continue;
      }
      const clock = clockAfter(events, i, evt.day);
      const chapter: DayChapter = {
        kind: "day",
        round: evt.round,
        index: i,
        hour: clock.hour,
        minute: clock.minute,
        day: evt.day,
        dayIndex: seen.size + 1,
        date: evt.date ?? null,
        weekday: normalizeWeekday(evt.weekday) ?? weekdayForDate(evt.date),
        label: evt.label ?? null,
      };
      seen.set(evt.day, chapter);
      out.push(chapter);
    } else {
      if (seen.has(evt.round)) continue;
      const clock = clockAfter(events, i, null);
      const chapter: DayChapter = {
        kind: "round",
        round: evt.round,
        index: i,
        hour: clock.hour,
        minute: clock.minute,
        day: null,
        dayIndex: null,
        date: null,
        weekday: null,
        label: null,
      };
      seen.set(evt.round, chapter);
      out.push(chapter);
    }
  }
  return out;
}

/** "Day 6 · Sat Apr 11 · Saturday market in Dover", or "Round 3". */
export function chapterTitle(ch: Pick<DayChapter, "kind" | "round" | "day" | "dayIndex" | "date" | "label">): string {
  if (ch.kind !== "day" || ch.day == null) return `Round ${ch.round}`;
  const parts = [`Day ${ch.dayIndex ?? ch.day}`];
  const date = formatDate(ch.date, { weekday: true, comma: false });
  if (date) parts.push(date);
  if (ch.label) parts.push(ch.label);
  return parts.join(" · ");
}
