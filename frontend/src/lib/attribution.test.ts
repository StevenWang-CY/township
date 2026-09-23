import { describe, expect, it } from "vitest";
import { attributeOpinion, causeText, firstSentence, newsRef, overlapCount, tokens, type PendingCauses } from "./attribution";
import type { OpinionChangedEvent } from "../types/messages";

function shift(over: Partial<OpinionChangedEvent> = {}): OpinionChangedEvent {
  return {
    type: "opinion_changed",
    agent_id: "tom",
    agent_name: "Tom",
    town: "dover",
    old_opinion: { candidate: "undecided", confidence: 30, reasoning: "", top_issues: [] },
    new_opinion: {
      candidate: "mejia",
      confidence: 62,
      reasoning: "Rent keeps climbing and Carlos made the case on housing. I also read about the ACA subsidies expiring.",
      top_issues: ["housing"],
    },
    ...over,
  };
}

const pending: PendingCauses = {
  conversations: [
    { id: "c1", partnerId: "carlos", partnerName: "Carlos", topic: "rent", round: 2 },
    { id: "c2", partnerId: "esperanza", partnerName: "Esperanza", topic: "schools", round: 2 },
  ],
  news: [
    { id: "aca", headline: "ACA subsidies set to expire, premiums to climb", round: 2 },
    { id: "weather", headline: "Sunny skies over Morris County", round: 2 },
  ],
  gossip: [{ id: "g1", fromId: "priya", fromName: "Priya", fromTown: "montclair", message: "…" }],
};

describe("attributeOpinion", () => {
  it("passes engine citations through untouched", () => {
    const evt = shift({
      trigger: { kind: "news", news_id: "aca", headline: "ACA subsidies" },
      influences: [{ kind: "news", ref: "news:aca", direction: "toward", weight: 0.7, note: "ACA" }],
      reason: "The subsidies story did it.",
    });
    const a = attributeOpinion(evt, pending, () => "hathaway");
    expect(a.derived).toBe(false);
    expect(a.trigger?.kind).toBe("news");
    expect(a.influences).toHaveLength(1);
    expect(a.reason).toBe("The subsidies story did it.");
  });

  it("scores a partner who holds the new stance above one who does not", () => {
    const a = attributeOpinion(shift(), pending, (id) => (id === "carlos" ? "mejia" : "hathaway"));
    expect(a.derived).toBe(true);
    const carlos = a.influences.find((i) => i.agent_id === "carlos");
    const esperanza = a.influences.find((i) => i.agent_id === "esperanza");
    expect(carlos?.weight).toBe(0.6);
    expect(carlos?.direction).toBe("toward");
    expect(esperanza?.weight).toBe(0.3);
    expect(a.trigger).toMatchObject({ kind: "conversation", conversation_id: "c1", partner_ids: ["carlos"] });
  });

  it("scores a headline whose words appear in the reasoning higher than one that does not", () => {
    const a = attributeOpinion(shift(), pending, () => undefined);
    const aca = a.influences.find((i) => i.ref === "news:aca");
    const weather = a.influences.find((i) => i.ref === "news:weather");
    expect(aca?.weight).toBe(0.4);
    expect(weather?.weight).toBe(0.2);
    expect(a.influences.find((i) => i.kind === "gossip")?.weight).toBe(0.3);
  });

  it("caps citations at six, strongest first, and takes the trigger from the top", () => {
    const busy: PendingCauses = {
      conversations: Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, partnerId: `p${i}`, partnerName: `P${i}`, topic: "taxes", round: 1 })),
      news: Array.from({ length: 4 }, (_, i) => ({ id: `n${i}`, headline: `Headline ${i}`, round: 1 })),
      gossip: [],
    };
    const a = attributeOpinion(shift(), busy, () => "mejia");
    expect(a.influences).toHaveLength(6);
    expect(a.influences.every((i, k, arr) => k === 0 || arr[k - 1].weight >= i.weight)).toBe(true);
    expect(a.trigger?.kind).toBe("conversation");
  });

  it("marks a first opinion as a seed and an unexplained change as reflection", () => {
    const seed = attributeOpinion(shift({ old_opinion: null }), undefined, () => undefined);
    expect(seed.trigger?.kind).toBe("seed");
    expect(seed.influences[0]?.kind).toBe("seed");
    const quiet = attributeOpinion(shift(), { conversations: [], news: [], gossip: [] }, () => undefined);
    expect(quiet.trigger?.kind).toBe("reflection");
    expect(quiet.influences).toHaveLength(0);
  });

  it("uses the first sentence of the reasoning as the reason, clipped", () => {
    const a = attributeOpinion(shift(), pending, () => undefined);
    expect(a.reason).toBe("Rent keeps climbing and Carlos made the case on housing.");
    const long = "a".repeat(200) + ". More.";
    expect(firstSentence(long)!.length).toBeLessThanOrEqual(160);
    expect(firstSentence("")).toBeNull();
  });
});

describe("causeText", () => {
  const names = (id: string) => ({ carlos: "Carlos", priya: "Priya" })[id];
  it("reads like a clause", () => {
    expect(causeText({ kind: "conversation", partner_ids: ["carlos"] }, [{ kind: "conversation", ref: "conv:c1", agent_id: "carlos", direction: "toward", weight: 0.6, note: "talked with Carlos about rent" }], names)).toBe("after talking with Carlos about rent");
    expect(causeText({ kind: "news", headline: "ACA subsidies set to expire" }, [], names)).toBe("after “ACA subsidies set to expire”");
    expect(causeText({ kind: "gossip", partner_ids: ["priya"] }, [], names)).toBe("after word from Priya");
    expect(causeText({ kind: "seed" }, [], names)).toBe("where they started");
    expect(causeText(null, [], names)).toBe("on reflection");
  });
});

describe("helpers", () => {
  it("tokenizes content words and slugs headlines", () => {
    expect([...tokens("ACA subsidies set to expire, premiums to climb")]).toEqual(["subsidies", "expire", "premiums", "climb"]);
    expect(overlapCount(tokens("premiums climbing as subsidies expire"), tokens("the subsidies expiring made premiums climb"))).toBe(4);
    expect(newsRef("aca", "x")).toBe("news:aca");
    expect(newsRef(null, "Property taxes: the county weighs in")).toBe("news:property-taxes-the-county-weighs-in");
  });
});
