import { describe, expect, it } from "vitest";
import {
  beatLabel,
  calendarHeadline,
  chapterTitle,
  chaptersByDay,
  dayOrdinal,
  daysBetween,
  electionCountdown,
  electionRelative,
  formatDate,
  formatDay,
  isElectionDay,
  parseISODate,
  pausedNotice,
  phasesForRound,
  planEntryForRound,
  progressOf,
  stoppedReasonText,
  totalDaysOf,
  weekdayForDate,
  weekdayInitial,
  type CalendarState,
} from "./calendar";
import type { RunPlanEntry, ScenarioRoundPlanEntry, SimulationEvent } from "../types/messages";

const cal = (over: Partial<CalendarState> = {}): CalendarState => ({
  day: 12,
  dayIndex: 12,
  date: "2026-04-08",
  weekday: "wednesday",
  beat: "morning",
  label: null,
  totalDays: 21,
  preset: "campaign",
  ...over,
});

describe("dates without Intl", () => {
  it("parses only real ISO days", () => {
    expect(parseISODate("2026-04-08")).toEqual({ year: 2026, month: 4, day: 8 });
    expect(parseISODate("2026-02-30")).toBeNull();
    expect(parseISODate("Apr 8 2026")).toBeNull();
    expect(parseISODate(null)).toBeNull();
  });

  it("knows the weekday of a date in any time zone", () => {
    expect(weekdayForDate("2026-04-08")).toBe("wednesday");
    expect(weekdayForDate("2026-04-16")).toBe("thursday");
    expect(weekdayForDate("2026-03-28")).toBe("saturday");
    expect(weekdayInitial("wednesday")).toBe("W");
    expect(weekdayInitial("sun")).toBe("S");
    expect(weekdayInitial(null)).toBe("");
  });

  it("formats 'Wed, Apr 8' and its HUD spelling", () => {
    expect(formatDate("2026-04-08")).toBe("Apr 8");
    expect(formatDate("2026-04-08", { weekday: true })).toBe("Wed, Apr 8");
    expect(formatDate("2026-04-08", { weekday: true, comma: false })).toBe("Wed Apr 8");
    expect(formatDate("2026-04-08", { weekday: "long", month: "long" })).toBe("Wednesday, April 8");
    expect(formatDate("nope", { weekday: true })).toBeNull();
    expect(daysBetween("2026-04-08", "2026-04-16")).toBe(8);
  });
});

describe("day, beat and progress", () => {
  it("formats the day of the campaign by its place in the run", () => {
    expect(formatDay(cal())).toBe("Day 12 of 21");
    expect(formatDay(cal({ totalDays: null }))).toBe("Day 12");
    // A run trimmed to its last four days opens on authored day 19.
    expect(formatDay(cal({ day: 19, dayIndex: 1, totalDays: 4 }))).toBe("Day 1 of 4");
    expect(formatDay(cal({ day: 19, dayIndex: null, totalDays: 4 }))).toBe("Day 19");
    expect(formatDay(null)).toBe("");
  });

  it("finds a day's place in the run plan", () => {
    const trimmed: RunPlanEntry[] = [19, 19, 20, 21, 21, 22].map((day, i) => ({ round: i, phases: ["converse"], day }));
    expect(dayOrdinal(trimmed, 19)).toBe(1);
    expect(dayOrdinal(trimmed, 21)).toBe(3);
    expect(dayOrdinal(trimmed, 5)).toBeNull();
    expect(dayOrdinal([], 1)).toBeNull();
    expect(totalDaysOf(trimmed)).toBe(4);
  });

  it("names the beats, election night included", () => {
    expect(beatLabel("morning")).toBe("Morning");
    expect(beatLabel("midday")).toBe("Midday");
    expect(beatLabel("evening")).toBe("Evening");
    expect(beatLabel("early")).toBe("Early voting");
    expect(beatLabel("night")).toBe("Night");
    expect(beatLabel("night", { electionDay: true })).toBe("Election night");
    expect(beatLabel("late-shift")).toBe("Late shift");
    expect(beatLabel(null)).toBe("");
  });

  it("measures progress by day", () => {
    expect(progressOf(cal({ day: 7, dayIndex: 7, totalDays: 21 }))).toBeCloseTo(1 / 3);
    expect(progressOf(cal({ day: 20, dayIndex: 2, totalDays: 4 }))).toBeCloseTo(0.5);
    expect(progressOf(cal({ totalDays: null }))).toBeNull();
  });
});

describe("the election on the calendar", () => {
  it("counts down to election day and past it", () => {
    expect(isElectionDay(cal({ date: "2026-04-16" }), "2026-04-16")).toBe(true);
    expect(isElectionDay(cal(), "2026-04-16")).toBe(false);
    expect(electionCountdown(cal({ date: "2026-04-12" }), "2026-04-16")).toBe("Election day in 4 days");
    expect(electionCountdown(cal({ date: "2026-04-15" }), "2026-04-16")).toBe("Election day tomorrow");
    expect(electionCountdown(cal({ date: "2026-04-16" }), "2026-04-16")).toBe("Election day");
    expect(electionCountdown(cal({ date: "2026-04-17" }), "2026-04-16")).toBe("The morning after");
    expect(electionCountdown(cal({ date: "2026-04-19" }), "2026-04-16")).toBe("3 days after the election");
    expect(electionCountdown(cal({ date: null }), "2026-04-16")).toBeNull();
    expect(electionCountdown(cal({ date: "2026-04-14" }), "2026-04-16", { label: "Decision day", after: "vote" }))
      .toBe("Decision day in 2 days");
    expect(electionCountdown(cal({ date: "2026-04-19" }), "2026-04-16", { label: "Decision day", after: "vote" }))
      .toBe("3 days after the vote");
    expect(electionRelative(cal({ date: "2026-04-12" }), "2026-04-16")).toBe("in 4 days");
    expect(electionRelative(cal({ date: "2026-04-16" }), "2026-04-16")).toBe("today");
  });

  it("writes the HUD line", () => {
    expect(calendarHeadline(cal())).toBe("Day 12 of 21 · Wed Apr 8 · Morning");
    expect(calendarHeadline(cal({ day: 9, dayIndex: 9, date: "2026-04-04", beat: "evening", label: "Debate night in Montclair" })))
      .toBe("Day 9 of 21 · Sat Apr 4 · Evening · Debate night in Montclair");
    expect(calendarHeadline(cal({ day: 21, dayIndex: 21, date: "2026-04-16", beat: "night", label: "Election day" }), "2026-04-16"))
      .toBe("Day 21 of 21 · Thu Apr 16 · Election night");
    expect(calendarHeadline(cal({ day: 21, dayIndex: 21, date: "2026-04-16", beat: "early", label: "Election day" }), "2026-04-16"))
      .toBe("Day 21 of 21 · Thu Apr 16 · Early voting · Election day");
    // A run trimmed to its last days: authored day 21 is its third.
    expect(calendarHeadline(cal({ day: 21, dayIndex: 3, totalDays: 4, date: "2026-04-16", beat: "midday", label: "Election day" }), "2026-04-16"))
      .toBe("Day 3 of 4 · Thu Apr 16 · Midday · Election day");
    expect(calendarHeadline(null)).toBe("");
  });

  it("phrases stops and provider pauses", () => {
    expect(stoppedReasonText("budget", 12)).toBe("Stopped at the budget after day 12");
    expect(stoppedReasonText("budget", null)).toBe("Stopped at the budget");
    expect(stoppedReasonText(null, 3)).toBeNull();
    expect(pausedNotice("paused")).toBeNull();
    expect(pausedNotice("usage limit reached")).toBe("Paused by the provider: usage limit reached");
  });
});

const quickPlan: ScenarioRoundPlanEntry[] = [
  { round: 0, phases: ["seed"], clock: "08:00" },
  { round: 1, phases: ["converse", "news"], clock: "10:00" },
  { round: 2, phases: ["converse", "opinion"], clock: "13:00" },
];
const runPlan: RunPlanEntry[] = [
  { round: 0, phases: ["seed", "converse"], clock: "07:30", day: 1, date: "2026-04-14", weekday: "tuesday", beat: "morning" },
  { round: 1, phases: ["news", "converse"], clock: "12:30", day: 1, date: "2026-04-14", weekday: "tuesday", beat: "midday" },
  { round: 2, phases: ["vote"], clock: "07:00", day: 2, date: "2026-04-15", weekday: "wednesday", beat: "early", label: "Election day" },
];

describe("plans", () => {
  it("prefers the run's plan and falls back to the scenario's", () => {
    expect(phasesForRound(runPlan, quickPlan, 1)).toEqual(["news", "converse"]);
    expect(phasesForRound([], quickPlan, 1)).toEqual(["converse", "news"]);
    expect(phasesForRound(undefined, quickPlan, 2)).toEqual(["converse", "opinion"]);
    expect(phasesForRound(runPlan, quickPlan, 9)).toEqual([]);
    expect(planEntryForRound(runPlan, quickPlan, 2)).toMatchObject({ beat: "early" });
    expect(totalDaysOf(runPlan)).toBe(2);
    expect(totalDaysOf(quickPlan as RunPlanEntry[])).toBeNull();
    expect(totalDaysOf([])).toBeNull();
  });
});

const rs = (round: number, town: string, extra: Record<string, unknown> = {}): SimulationEvent =>
  ({ type: "round_started", round, town, total_rounds: 9, ...extra }) as SimulationEvent;
const tick = (hour: number, minute: number, town: string): SimulationEvent =>
  ({ type: "world_clock_tick", hour, minute, town }) as SimulationEvent;

describe("chapters", () => {
  it("groups a campaign recording by day, one tick per day at its first round", () => {
    const events: SimulationEvent[] = [
      { type: "simulation_started", agents: [], towns: ["dover", "randolph"] } as SimulationEvent,
      rs(0, "dover", { day: 1, date: "2026-04-11", weekday: "saturday", beat: "morning" }),
      rs(0, "randolph", { day: 1, date: "2026-04-11", weekday: "saturday", beat: "morning" }),
      tick(9, 0, "dover"),
      rs(1, "dover", { day: 1, date: "2026-04-11", weekday: "saturday", beat: "midday", label: "Saturday market in Dover" }),
      tick(12, 30, "dover"),
      rs(2, "dover", { day: 2, date: "2026-04-12", weekday: "sunday", beat: "morning" }),
      tick(10, 0, "dover"),
      rs(3, "dover", { day: 2, date: "2026-04-12", weekday: "sunday", beat: "evening" }),
    ];
    const chapters = chaptersByDay(events);
    expect(chapters.map((c) => [c.kind, c.day, c.dayIndex, c.round, c.index, c.weekday, c.label, c.hour])).toEqual([
      ["day", 1, 1, 0, 1, "saturday", "Saturday market in Dover", 9],
      ["day", 2, 2, 2, 6, "sunday", null, 10],
    ]);
    expect(chapterTitle(chapters[0])).toBe("Day 1 · Sat Apr 11 · Saturday market in Dover");
    expect(chapterTitle(chapters[1])).toBe("Day 2 · Sun Apr 12");
    // A trimmed campaign's authored days (19, 20) are chapters 1 and 2.
    const trimmed = chaptersByDay([
      rs(0, "dover", { day: 19, date: "2026-04-14", weekday: "tuesday", beat: "morning" }),
      rs(1, "dover", { day: 20, date: "2026-04-15", weekday: "wednesday", beat: "morning" }),
    ]);
    expect(trimmed.map((c) => [c.day, c.dayIndex])).toEqual([[19, 1], [20, 2]]);
    expect(chapterTitle(trimmed[1])).toBe("Day 2 · Wed Apr 15");
  });

  it("falls back to one chapter per round for a recording without days", () => {
    // The legacy rule stands for round chapters: the clock is the first tick
    // before the NEXT round_started of any town (the flagship replay ticks
    // right after each town's round_started, so its chapters keep theirs).
    const events: SimulationEvent[] = [
      rs(0, "dover"), rs(0, "montclair"), tick(8, 0, "dover"),
      rs(1, "dover"), tick(10, 0, "dover"), rs(1, "montclair"),
    ];
    const chapters = chaptersByDay(events);
    expect(chapters.map((c) => [c.kind, c.round, c.index, c.hour, c.day])).toEqual([
      ["round", 0, 0, null, null],
      ["round", 1, 3, 10, null],
    ]);
    expect(chapterTitle(chapters[1])).toBe("Round 1");
  });
});
