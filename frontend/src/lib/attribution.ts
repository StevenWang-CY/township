/**
 * Why a resident changed their mind.
 *
 * New recordings and live runs carry the engine's own citations on every
 * opinion_changed (Model II: `trigger`, `influences`, `reason`). The flagship
 * one-day Sonnet replay predates them, so the reducer keeps a small ledger of
 * what each resident was exposed to since their last opinion — conversations,
 * headlines, gossip — and this module turns that ledger into the same shape:
 * a trigger, a ranked list of influences, and a one-line reason. Pure; the
 * reducer feeds it, selectors and components read it.
 */
import type { InfluenceRef, OpinionChangedEvent, OpinionTrigger } from "../types/messages";

export interface PendingConversation {
  id: string;
  partnerId: string;
  partnerName: string;
  topic: string;
  round: number | null;
}
export interface PendingNews {
  id: string;
  headline: string;
  round: number;
}
export interface PendingGossip {
  id: string;
  fromId: string;
  fromName?: string;
  fromTown: string;
  message: string;
}
/** What a resident heard since their last opinion — flushed on the next one. */
export interface PendingCauses {
  conversations: PendingConversation[];
  news: PendingNews[];
  gossip: PendingGossip[];
}

export const EMPTY_PENDING: PendingCauses = { conversations: [], news: [], gossip: [] };
/** Per list, per resident: a live run can talk for hours between opinions. */
export const PENDING_LIMIT = 12;
/** At most this many citations survive on one change of mind. */
export const MAX_INFLUENCES = 6;

/** One point on a resident's trajectory (reducer-owned playback state). */
export interface OpinionPoint {
  round: number | null;
  day: number | null;
  /** The stance the event said they held before (null on a first opinion). */
  from: string | null;
  candidate: string;
  confidence: number;
  trigger: OpinionTrigger | null;
  influences: InfluenceRef[];
  reason: string | null;
  /** Absolute event cursor right after the change applied. */
  eventCursor: number;
  /** True when the citations were derived here rather than carried by the event. */
  derived: boolean;
}

/** Who moved whom: one edge per cited influence with a source. */
export interface InfluenceEdge {
  ref: string;
  kind: InfluenceRef["kind"];
  /** The resident (or null for a headline / an event) the push came from. */
  from: string | null;
  to: string;
  direction: InfluenceRef["direction"];
  weight: number;
  round: number | null;
  day: number | null;
  note?: string;
}

export interface Attribution {
  trigger: OpinionTrigger | null;
  influences: InfluenceRef[];
  reason: string | null;
  derived: boolean;
}

const STOPWORDS = new Set([
  "that", "this", "with", "from", "have", "about", "their", "there", "would", "could",
  "should", "which", "while", "where", "when", "what", "were", "been", "they", "them",
  "than", "then", "into", "over", "under", "after", "before", "because", "still", "just",
  "more", "most", "very", "much", "also", "only", "some", "such", "even", "ever",
]);

/** Content words (4+ letters, lowercased) — the overlap test for headlines. */
export function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of (text || "").toLowerCase().split(/[^a-z0-9']+/)) {
    const w = raw.replace(/'s$/, "");
    if (w.length >= 4 && !STOPWORDS.has(w)) out.add(w);
  }
  return out;
}

/** Shared content words, where "climbing" meets "climb" and "expiring"
 *  meets "expire": equal, or one a prefix of the other with 5+ letters in common. */
export function overlapCount(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) {
    for (const y of b) {
      let cp = 0;
      while (cp < x.length && cp < y.length && x[cp] === y[cp]) cp++;
      const shorter = Math.min(x.length, y.length);
      if (x === y || cp >= 5 || (cp >= 4 && cp >= shorter - 1)) {
        n++;
        break;
      }
    }
  }
  return n;
}

/** The first sentence of a reasoning string, clipped at a word boundary. */
export function firstSentence(text: string | null | undefined, max = 160): string | null {
  const t = (text || "").trim();
  if (!t) return null;
  const m = t.match(/^(.+?[.!?])(\s|$)/);
  let s = (m ? m[1] : t).trim();
  if (s.length > max) {
    const cut = s.slice(0, max - 1);
    const space = cut.lastIndexOf(" ");
    s = (space > max / 2 ? cut.slice(0, space) : cut).replace(/[,:;\s]+$/, "") + "…";
  }
  return s;
}

/** "news:<id>" from the event's id, else a slug of the headline. */
export function newsRef(id: string | null | undefined, headline: string): string {
  if (id) return `news:${id}`;
  const slug = headline.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `news:${slug || "headline"}`;
}

function triggerFor(top: InfluenceRef | undefined, pending: PendingCauses | undefined): OpinionTrigger {
  if (!top) return { kind: "reflection" };
  switch (top.kind) {
    case "conversation": {
      const conv = pending?.conversations.find((c) => `conv:${c.id}` === top.ref);
      return {
        kind: "conversation",
        conversation_id: conv?.id ?? top.ref.replace(/^conv:/, ""),
        partner_ids: top.agent_id ? [top.agent_id] : [],
      };
    }
    case "news": {
      const item = pending?.news.find((n) => newsRef(n.id, n.headline) === top.ref);
      return { kind: "news", news_id: item?.id ?? top.ref.replace(/^news:/, ""), headline: item?.headline ?? top.note ?? null };
    }
    case "gossip":
      return { kind: "gossip", partner_ids: top.agent_id ? [top.agent_id] : [] };
    default:
      return { kind: "reflection" };
  }
}

/**
 * Attribute one change of mind. Engine citations pass through untouched;
 * otherwise the ledger of what the resident heard is scored: a partner who
 * holds the new stance 0.6 (else 0.3), a headline whose words show up in the
 * reasoning 0.4 (else 0.2), gossip 0.3. The trigger is the top scorer; the
 * reason is the first sentence of the resident's own reasoning.
 */
export function attributeOpinion(
  evt: OpinionChangedEvent,
  pending: PendingCauses | undefined,
  stanceOf: (agentId: string) => string | undefined,
): Attribution {
  const reason = evt.reason?.trim() || firstSentence(evt.new_opinion?.reasoning);
  if (evt.influences && evt.influences.length > 0) {
    return {
      trigger: evt.trigger ?? triggerFor(evt.influences[0], pending),
      influences: evt.influences.slice(0, MAX_INFLUENCES),
      reason,
      derived: false,
    };
  }
  if (evt.trigger && evt.trigger.kind !== "reflection") {
    return { trigger: evt.trigger, influences: [], reason, derived: false };
  }
  const isSeed = evt.old_opinion == null;
  const newStance = evt.new_opinion?.candidate;
  const reasoningTokens = tokens(evt.new_opinion?.reasoning ?? "");
  const scored: InfluenceRef[] = [];
  for (const c of pending?.conversations ?? []) {
    const partnerStance = stanceOf(c.partnerId);
    const agrees = !!newStance && partnerStance === newStance;
    scored.push({
      kind: "conversation",
      ref: `conv:${c.id}`,
      agent_id: c.partnerId,
      direction: agrees ? "toward" : "away",
      weight: agrees ? 0.6 : 0.3,
      note: c.topic ? `talked with ${c.partnerName} about ${c.topic}` : `talked with ${c.partnerName}`,
    });
  }
  for (const n of pending?.news ?? []) {
    const overlap = overlapCount(tokens(n.headline), reasoningTokens);
    scored.push({
      kind: "news",
      ref: newsRef(n.id, n.headline),
      direction: "toward",
      weight: overlap >= 2 ? 0.4 : 0.2,
      note: n.headline,
    });
  }
  for (const g of pending?.gossip ?? []) {
    scored.push({
      kind: "gossip",
      ref: `gossip:${g.id}`,
      agent_id: g.fromId,
      direction: "toward",
      weight: 0.3,
      note: g.fromName ? `heard from ${g.fromName} in ${g.fromTown}` : `word from ${g.fromTown}`,
    });
  }
  scored.sort((a, b) => b.weight - a.weight);
  const influences = scored.slice(0, MAX_INFLUENCES);
  if (influences.length === 0) {
    if (isSeed) {
      return {
        trigger: { kind: "seed" },
        influences: [{ kind: "seed", ref: "seed", direction: "toward", weight: 1 }],
        reason,
        derived: true,
      };
    }
    return { trigger: evt.trigger ?? { kind: "reflection" }, influences: [], reason, derived: true };
  }
  return { trigger: triggerFor(influences[0], pending), influences, reason, derived: true };
}

/** One readable clause: "after talking with Carlos about rent". */
export function causeText(
  trigger: OpinionTrigger | null,
  influences: InfluenceRef[],
  nameOf: (agentId: string) => string | undefined,
): string {
  const top = influences[0];
  const kind = trigger?.kind ?? top?.kind ?? "reflection";
  switch (kind) {
    case "seed":
      return "where they started";
    case "conversation": {
      const pid = trigger?.partner_ids?.[0] ?? top?.agent_id ?? null;
      const who = pid ? nameOf(pid) : undefined;
      const topic = top?.note?.match(/about (.+)$/)?.[1];
      if (who && topic) return `after talking with ${who} about ${topic}`;
      if (who) return `after talking with ${who}`;
      return "after a conversation";
    }
    case "news": {
      const headline = trigger?.headline ?? top?.note;
      return headline ? `after “${clip(headline, 64)}”` : "after the news";
    }
    case "gossip": {
      const pid = trigger?.partner_ids?.[0] ?? top?.agent_id ?? null;
      const who = pid ? nameOf(pid) : undefined;
      return who ? `after word from ${who}` : "after word from across the district";
    }
    case "decision":
      return "at the ballot box";
    case "god_view":
      return "after what happened in town";
    case "event":
      return top?.note ? `after ${top.note}` : "after the event";
    default:
      return "on reflection";
  }
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return (space > max / 2 ? cut.slice(0, space) : cut) + "…";
}
