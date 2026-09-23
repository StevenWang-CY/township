import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { initialState, LIVE_INFLUENCE_EDGE_LIMIT, reducer, replayReducer, type WsState } from "./useWebSocket";
import type { AgentState, ConversationStartedEvent, SimulationEvent } from "../types/messages";

function agent(id: string, town: string, candidate = "undecided"): AgentState {
  return {
    id, name: id[0].toUpperCase() + id.slice(1), town, occupation: "Resident",
    opinion: { candidate, confidence: 30, reasoning: "", top_issues: [] },
    location: "Town Hall", current_activity: "idle", initials: id.slice(0, 2).toUpperCase(), color: "#888888",
  };
}

function reduceAll(events: SimulationEvent[], live = false): WsState {
  let s = initialState;
  for (const e of events) s = (live ? reducer : replayReducer)(s, { type: "EVENT", payload: e });
  return s;
}

const started: SimulationEvent = {
  type: "simulation_started",
  agents: [agent("tom", "dover"), agent("carlos", "dover", "mejia"), agent("priya", "montclair", "hathaway")],
  towns: ["dover", "montclair"],
} as SimulationEvent;

const talk: SimulationEvent = {
  type: "conversation_started",
  conversation: { id: "c1", participants: ["tom", "carlos"], participant_names: ["Tom", "Carlos"], town: "dover", location: "Bodega Row", topic: "rent", summary: "", round: 1, timestamp: "" },
};
const news: SimulationEvent = { type: "news_injected", headline: "ACA subsidies set to expire", description: "", round: 1, news_id: "aca", towns: [] };
const gossip: SimulationEvent = { type: "cross_town_gossip", from_town: "montclair", to_town: "dover", from_agent: "priya", to_agent: "tom", message: "Priya says taxes" };
const tomFlips: SimulationEvent = {
  type: "opinion_changed", agent_id: "tom", agent_name: "Tom", town: "dover",
  old_opinion: { candidate: "undecided", confidence: 30, reasoning: "", top_issues: [] },
  new_opinion: { candidate: "mejia", confidence: 60, reasoning: "Carlos made the case on rent. The subsidies expire too.", top_issues: [] },
};

describe("reducer: opinion history and attribution", () => {
  it("records a point per opinion change with derived causes, and flushes what was heard", () => {
    const s = reduceAll([started, talk, news, gossip, tomFlips]);
    expect(s.pendingCauses.tom).toBeUndefined();
    expect(s.pendingCauses.carlos?.conversations).toHaveLength(1);
    expect(s.pendingCauses.priya?.news).toHaveLength(1);
    const pts = s.opinionHistory.tom;
    expect(pts).toHaveLength(1);
    expect(pts[0].candidate).toBe("mejia");
    expect(pts[0].derived).toBe(true);
    expect(pts[0].trigger?.kind).toBe("conversation");
    expect(pts[0].influences.map((i) => i.kind).sort()).toEqual(["conversation", "gossip", "news"]);
    expect(pts[0].reason).toBe("Carlos made the case on rent.");
    expect(s.influenceEdges.map((e) => [e.from, e.to])).toEqual(expect.arrayContaining([["carlos", "tom"], ["priya", "tom"], [null, "tom"]]));
    expect(s.agents.tom.opinion.candidate).toBe("mejia");
  });

  it("keeps engine citations as they came", () => {
    const cited: SimulationEvent = {
      ...tomFlips,
      trigger: { kind: "news", news_id: "aca", headline: "ACA subsidies set to expire" },
      influences: [{ kind: "news", ref: "news:aca", direction: "toward", weight: 0.9, note: "ACA" }],
      reason: "That headline.",
    } as SimulationEvent;
    const s = reduceAll([started, talk, cited]);
    expect(s.opinionHistory.tom[0].derived).toBe(false);
    expect(s.opinionHistory.tom[0].trigger?.kind).toBe("news");
    expect(s.opinionHistory.tom[0].reason).toBe("That headline.");
  });

  it("scopes a local headline to the towns that heard it and resets on a new run", () => {
    const local: SimulationEvent = { ...news, towns: ["montclair"] } as SimulationEvent;
    const s = reduceAll([started, local]);
    expect(s.pendingCauses.tom).toBeUndefined();
    expect(s.pendingCauses.priya?.news).toHaveLength(1);
    const again = reduceAll([started, talk, news, tomFlips, started]);
    expect(again.opinionHistory).toEqual({});
    expect(again.influenceEdges).toEqual([]);
    expect(again.pendingCauses).toEqual({});
  });

  it("caps influence edges on the live socket but not in a replay", () => {
    const many: SimulationEvent[] = [started];
    for (let i = 0; i < LIVE_INFLUENCE_EDGE_LIMIT + 50; i++) {
      const conv = (talk as ConversationStartedEvent).conversation;
      many.push({ ...talk, conversation: { ...conv, id: `c${i}` } } as SimulationEvent);
      many.push({ ...tomFlips, new_opinion: { ...tomFlips.new_opinion, candidate: i % 2 ? "mejia" : "hathaway" } } as SimulationEvent);
    }
    expect(reduceAll(many, true).influenceEdges).toHaveLength(LIVE_INFLUENCE_EDGE_LIMIT);
    expect(reduceAll(many, false).influenceEdges.length).toBeGreaterThan(LIVE_INFLUENCE_EDGE_LIMIT);
  });
});

describe("the flagship recording", () => {
  const raw = JSON.parse(readFileSync(new URL("../../../scenarios/nj11-2026/demo/simulation_cache.json", import.meta.url), "utf8"));
  const events = (raw.events as SimulationEvent[]).filter((e) => typeof e.type === "string");

  it("attributes every change of mind in the one-day Sonnet replay", () => {
    const s = reduceAll(events);
    const changes = events.filter((e) => e.type === "opinion_changed");
    const points = Object.values(s.opinionHistory).flat();
    expect(points.length).toBe(changes.length);
    for (const p of points) {
      expect(p.trigger).not.toBeNull();
      expect(p.derived).toBe(true);
    }
    const flips = Object.values(s.opinionHistory).flatMap((pts) => pts.filter((p, i) => i > 0 && pts[i - 1].candidate !== p.candidate));
    expect(flips.length).toBeGreaterThanOrEqual(10);
    expect(flips.every((p) => p.influences.length > 0 || p.trigger?.kind === "reflection")).toBe(true);
    expect(flips.filter((p) => p.influences.length > 0).length / flips.length).toBeGreaterThan(0.8);
  });
});
