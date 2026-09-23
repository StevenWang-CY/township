/**
 * Read models over the reducer state: the causal feed ("Tom → Mejia · after
 * talking with Carlos about rent"), a resident's trajectory, the swing
 * residents, the top influencers and a day's summary. Pure functions; the
 * components only format. Everything here degrades to the flagship replay
 * (no calendar, derived causes) and to a live run mid-flight.
 */
import type { WsState } from "../hooks/useWebSocket";
import { causeText, type InfluenceEdge, type OpinionPoint } from "./attribution";

export interface CausalEntry {
  /** Stable key: the event cursor the change applied at. */
  id: number;
  kind: "shift" | "vote";
  agentId: string;
  agentName: string;
  town: string;
  from: string | null;
  to: string | null;
  round: number | null;
  day: number | null;
  /** "after talking with Carlos about rent" — empty for a vote. */
  cause: string;
  /** Citations were derived from exposure rather than carried by the event. */
  derived: boolean;
  /** A real change of mind (decided → a different decided stance). */
  crossover: boolean;
}

function nameOf(state: WsState): (id: string) => string | undefined {
  return (id) => state.agents[id]?.name ?? state.agentRoster[id]?.name;
}

function townOf(state: WsState, id: string): string {
  return state.agents[id]?.home_town ?? state.agents[id]?.town ?? state.agentRoster[id]?.town ?? "";
}

/** Newest-first changes of mind (and ballots) for a town, or the district. */
export function causalFeed(
  state: WsState,
  town: string | null,
  opts: { limit?: number; undecidedId?: string; includeSeeds?: boolean; includeVotes?: boolean } = {},
): CausalEntry[] {
  const limit = opts.limit ?? 40;
  const undecided = opts.undecidedId ?? "undecided";
  const names = nameOf(state);
  const out: CausalEntry[] = [];
  for (const [agentId, points] of Object.entries(state.opinionHistory)) {
    const home = townOf(state, agentId);
    if (town && home !== town) continue;
    const agentName = names(agentId) ?? agentId;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const prev = i > 0 ? points[i - 1] : null;
      const isSeed = prev === null;
      if (isSeed && !opts.includeSeeds) continue;
      if (prev && prev.candidate === p.candidate) continue; // a confidence tick, not a change
      const from = prev?.candidate ?? null;
      out.push({
        id: p.eventCursor,
        kind: "shift",
        agentId,
        agentName,
        town: home,
        from,
        to: p.candidate,
        round: p.round,
        day: p.day,
        cause: causeText(p.trigger, p.influences, names),
        derived: p.derived,
        crossover: !!from && from !== undecided && p.candidate !== undecided && from !== p.candidate,
      });
    }
  }
  if (opts.includeVotes ?? true) {
    for (const [agentId, b] of Object.entries(state.ballots)) {
      const home = townOf(state, agentId);
      if (town && home !== town) continue;
      out.push({
        id: Number.MAX_SAFE_INTEGER - 1_000_000 + b.round, // ballots read after the day's shifts
        kind: "vote",
        agentId,
        agentName: names(agentId) ?? agentId,
        town: home,
        from: null,
        to: b.option,
        round: b.round,
        day: state.calendar?.day ?? null,
        cause: "",
        derived: false,
        crossover: false,
      });
    }
  }
  out.sort((a, b) => b.id - a.id);
  return out.slice(0, limit);
}

/** A resident's opinion trajectory, oldest first. */
export function trajectory(state: WsState, agentId: string): OpinionPoint[] {
  return state.opinionHistory[agentId] ?? [];
}

export interface SwingResident {
  agentId: string;
  name: string;
  town: string;
  /** Decided stances held, in order (duplicates collapsed). */
  path: string[];
  flips: number;
  lastCause: string;
}

/** Residents who held more than one decided stance, most restless first. */
export function swingResidents(state: WsState, town: string | null, undecidedId = "undecided", limit = 8): SwingResident[] {
  const names = nameOf(state);
  const out: SwingResident[] = [];
  for (const [agentId, points] of Object.entries(state.opinionHistory)) {
    const home = townOf(state, agentId);
    if (town && home !== town) continue;
    const path: string[] = [];
    let flips = 0;
    let lastCause = "";
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (p.candidate === undecidedId) continue;
      if (path.length === 0 || path[path.length - 1] !== p.candidate) {
        if (path.length > 0) {
          flips++;
          lastCause = causeText(p.trigger, p.influences, names);
        }
        path.push(p.candidate);
      }
    }
    if (flips > 0) out.push({ agentId, name: names(agentId) ?? agentId, town: home, path, flips, lastCause });
  }
  out.sort((a, b) => b.flips - a.flips || a.name.localeCompare(b.name));
  return out.slice(0, limit);
}

export interface Influencer {
  agentId: string;
  name: string;
  town: string;
  /** Sum of cited weights on pushes toward the stance the listener took. */
  weight: number;
  count: number;
}

/** Who moved the most minds (cited conversation and gossip edges). */
export function topInfluencers(state: WsState, town: string | null, limit = 5): Influencer[] {
  const names = nameOf(state);
  const acc = new Map<string, Influencer>();
  for (const e of state.influenceEdges) {
    if (!e.from || e.direction !== "toward") continue;
    const home = townOf(state, e.from);
    if (town && home !== town) continue;
    const cur = acc.get(e.from) ?? { agentId: e.from, name: names(e.from) ?? e.from, town: home, weight: 0, count: 0 };
    cur.weight += e.weight;
    cur.count += 1;
    acc.set(e.from, cur);
  }
  return [...acc.values()].sort((a, b) => b.weight - a.weight || b.count - a.count).slice(0, limit);
}

/** Edges into one resident: what moved them, strongest first. */
export function influencesOn(state: WsState, agentId: string, limit = 6): InfluenceEdge[] {
  return state.influenceEdges
    .filter((e) => e.to === agentId)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit);
}

export interface DaySummary {
  day: number;
  date: string | null;
  weekday: string | null;
  /** Changes of mind that day (newest last). */
  flips: CausalEntry[];
  /** The resident with the most movement that day, if any. */
  topMover: string | null;
  headlines: string[];
  /** Ballots cast that day (election day). */
  votes: number;
}

/** What happened on one campaign day — for the card at the day's end. */
export function daySummary(state: WsState, day: number, undecidedId = "undecided"): DaySummary | null {
  const entries = state.runPlan.filter((r) => r.day === day);
  if (entries.length === 0 && state.calendar?.day !== day) return null;
  const rounds = new Set(entries.map((r) => r.round));
  const feed = causalFeed(state, null, { limit: 10_000, undecidedId, includeVotes: false });
  const flips = feed.filter((e) => e.day === day || (e.round !== null && rounds.has(e.round))).reverse();
  const counts = new Map<string, number>();
  for (const f of flips) counts.set(f.agentName, (counts.get(f.agentName) ?? 0) + 1);
  const topMover = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const headlines = state.headlines.filter((h) => rounds.has(h.round)).map((h) => h.headline);
  const votes = Object.values(state.ballots).filter((b) => rounds.has(b.round)).length;
  const first = entries[0];
  return {
    day,
    date: first?.date ?? (state.calendar?.day === day ? state.calendar.date : null),
    weekday: first?.weekday ?? null,
    flips,
    topMover,
    headlines,
    votes,
  };
}
