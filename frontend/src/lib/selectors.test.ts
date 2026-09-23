import { describe, expect, it } from "vitest";
import { initialState, replayReducer, type WsState } from "../hooks/useWebSocket";
import { causalFeed, daySummary, influencesOn, swingResidents, topInfluencers, trajectory } from "./selectors";
import type { AgentState, SimulationEvent } from "../types/messages";

function agent(id: string, town: string, candidate = "undecided"): AgentState {
  return {
    id, name: id[0].toUpperCase() + id.slice(1), town, occupation: "Resident",
    opinion: { candidate, confidence: 30, reasoning: "", top_issues: [] },
    location: "Town Hall", current_activity: "idle", initials: id.slice(0, 2).toUpperCase(), color: "#888888",
  };
}
function shift(id: string, town: string, from: string | null, to: string, reasoning = "Because."): SimulationEvent {
  return {
    type: "opinion_changed", agent_id: id, agent_name: id[0].toUpperCase() + id.slice(1), town,
    old_opinion: from ? { candidate: from, confidence: 40, reasoning: "", top_issues: [] } : null,
    new_opinion: { candidate: to, confidence: 60, reasoning, top_issues: [] },
  };
}
function build(): WsState {
  const events: SimulationEvent[] = [
    {
      type: "simulation_started",
      agents: [agent("tom", "dover"), agent("carlos", "dover", "mejia"), agent("priya", "montclair", "hathaway")],
      towns: ["dover", "montclair"],
      plan: [
        { round: 0, phases: ["seed"], clock: "07:30", day: 1, date: "2026-03-27", weekday: "friday", beat: "morning" },
        { round: 1, phases: ["converse", "opinion"], clock: "18:30", day: 1, date: "2026-03-27", weekday: "friday", beat: "evening" },
        { round: 2, phases: ["news", "converse", "opinion"], clock: "12:30", day: 2, date: "2026-03-28", weekday: "saturday", beat: "midday" },
      ],
    } as SimulationEvent,
    { type: "round_started", round: 0, town: "dover", total_rounds: 3, day: 1, date: "2026-03-27", weekday: "friday", beat: "morning" } as SimulationEvent,
    shift("tom", "dover", null, "undecided"),
    shift("carlos", "dover", null, "mejia"),
    shift("priya", "montclair", null, "hathaway"),
    { type: "round_started", round: 1, town: "dover", total_rounds: 3, day: 1, date: "2026-03-27", weekday: "friday", beat: "evening" } as SimulationEvent,
    { type: "conversation_started", conversation: { id: "c1", participants: ["tom", "carlos"], participant_names: ["Tom", "Carlos"], town: "dover", location: "Bodega Row", topic: "rent", summary: "", round: 1, timestamp: "" } },
    shift("tom", "dover", "undecided", "mejia", "Carlos made the case on rent."),
    { type: "round_started", round: 2, town: "dover", total_rounds: 3, day: 2, date: "2026-03-28", weekday: "saturday", beat: "midday" } as SimulationEvent,
    { type: "news_injected", headline: "Property tax bills climb again", description: "", round: 2, news_id: "property-tax", towns: [] },
    shift("tom", "dover", "mejia", "hathaway", "The property tax bills climb again and I cannot afford it."),
    { type: "ballot_cast", agent_id: "carlos", agent_name: "Carlos", town: "dover", option: "mejia", confidence: 80, reason: "", round: 2 } as SimulationEvent,
  ];
  let s = initialState;
  for (const e of events) s = replayReducer(s, { type: "EVENT", payload: e });
  return s;
}

describe("selectors", () => {
  const s = build();

  it("causalFeed reads newest first with a cause on every change of mind", () => {
    const feed = causalFeed(s, "dover", { includeVotes: false });
    expect(feed.map((e) => [e.agentName, e.from, e.to])).toEqual([
      ["Tom", "mejia", "hathaway"],
      ["Tom", "undecided", "mejia"],
    ]);
    expect(feed[1].cause).toBe("after talking with Carlos about rent");
    expect(feed[0].cause).toBe("after “Property tax bills climb again”");
    expect(feed[0].crossover).toBe(true);
    expect(feed[1].crossover).toBe(false);
    expect(feed[0].day).toBe(2);
    expect(causalFeed(s, "montclair", { includeVotes: false })).toEqual([]);
    const withVotes = causalFeed(s, "dover");
    expect(withVotes[0]).toMatchObject({ kind: "vote", agentName: "Carlos", to: "mejia" });
  });

  it("trajectory, swing residents, influencers and influences on a resident", () => {
    expect(trajectory(s, "tom").map((p) => p.candidate)).toEqual(["undecided", "mejia", "hathaway"]);
    const swing = swingResidents(s, null);
    expect(swing).toHaveLength(1);
    expect(swing[0]).toMatchObject({ name: "Tom", path: ["mejia", "hathaway"], flips: 1 });
    expect(topInfluencers(s, null)[0]).toMatchObject({ name: "Carlos", count: 1 });
    expect(influencesOn(s, "tom").map((e) => e.kind)).toEqual(expect.arrayContaining(["conversation", "news"]));
  });

  it("daySummary gathers a day's flips, headlines and votes", () => {
    const d1 = daySummary(s, 1)!;
    expect(d1.date).toBe("2026-03-27");
    expect(d1.flips.map((f) => f.to)).toEqual(["mejia"]);
    expect(d1.topMover).toBe("Tom");
    const d2 = daySummary(s, 2)!;
    expect(d2.headlines).toEqual(["Property tax bills climb again"]);
    expect(d2.flips.map((f) => f.to)).toEqual(["hathaway"]);
    expect(d2.votes).toBe(1);
    expect(daySummary(s, 9)).toBeNull();
  });
});
