import { describe, expect, it } from "vitest";
import { initialState, replayReducer, type WsState } from "../hooks/useWebSocket";
import type { SimulationEvent } from "../types/messages";
import { CHECKPOINT_EVERY, noteCheckpoint, seekState } from "./seek";

function feed(n: number): SimulationEvent[] {
  const events: SimulationEvent[] = [{
    type: "simulation_started",
    agents: [{ id: "tom", name: "Tom", town: "dover", occupation: "x", opinion: { candidate: "undecided", confidence: 30, reasoning: "", top_issues: [] }, location: "Town Hall", current_activity: "idle", initials: "T", color: "#888888" }],
    towns: ["dover"],
  } as SimulationEvent];
  for (let i = 1; i < n; i++) {
    events.push(i % 7 === 0
      ? { type: "opinion_changed", agent_id: "tom", agent_name: "Tom", town: "dover", old_opinion: { candidate: "undecided", confidence: 30, reasoning: "", top_issues: [] }, new_opinion: { candidate: i % 14 === 0 ? "mejia" : "hathaway", confidence: 40 + (i % 50), reasoning: `step ${i}`, top_issues: [] } }
      : { type: "world_clock_tick", hour: i % 24, minute: 0 });
  }
  return events;
}

function full(events: SimulationEvent[], target: number): WsState {
  let s = initialState;
  for (let i = 0; i < target; i++) s = replayReducer(s, { type: "EVENT", payload: events[i] });
  return s;
}

describe("checkpointed seeks", () => {
  const events = feed(1_800);

  it("equals the full prefix reduction from any checkpoint", () => {
    const cps = new Map<number, WsState>();
    for (const target of [0, 1, 499, 500, 501, 1_234, 1_800]) {
      expect(seekState(events, target, cps)).toEqual(full(events, target));
    }
    expect([...cps.keys()].sort((a, b) => a - b)).toEqual([500, 1000, 1500]);
  });

  it("reuses the snapshots it filled and playback fills them too", () => {
    const cps = new Map<number, WsState>();
    seekState(events, 1_800, cps);
    const before = cps.get(1500)!;
    const state = seekState(events, 1_600, cps);
    expect(cps.get(1500)).toBe(before);
    expect(state).toEqual(full(events, 1_600));
    const fresh = new Map<number, WsState>();
    let s = initialState;
    for (let i = 0; i < CHECKPOINT_EVERY * 2 + 3; i++) {
      s = replayReducer(s, { type: "EVENT", payload: events[i] });
      noteCheckpoint(fresh, i + 1, s);
    }
    expect([...fresh.keys()]).toEqual([500, 1000]);
    expect(seekState(events, 1_003, fresh)).toEqual(full(events, 1_003));
  });
});
