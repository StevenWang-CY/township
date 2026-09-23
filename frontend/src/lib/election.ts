/**
 * Pure election helpers: turn the reducer's raw round signals and the
 * scenario's round plan into the phase the town is in and the civic
 * environment the scene dresses itself with. Scenario-agnostic — phase
 * names come from the plan, option ids from the roster.
 */
import type { AgentState, DistrictSummary, ScenarioRoundPlanEntry, SimulationEvent } from "../types/messages";
import type { RoundSignals } from "../hooks/useWebSocket";
import type { CivicEnv, ElectionPhase } from "../game/CivicLayer";

export const PHASE_LABEL: Record<ElectionPhase, string> = {
  seed: "Morning",
  converse: "Talk",
  news: "News",
  opinion: "Opinion",
  decide: "Vote",
  results: "Results",
};

const PHASES: ReadonlySet<string> = new Set(["seed", "converse", "news", "opinion", "decide"]);

function isPhase(value: string): value is ElectionPhase {
  return PHASES.has(value);
}

/**
 * The last phase of the round's plan whose trigger has fired: talk once a
 * resident speaks, news once the headline lands, opinion once an opinion
 * event arrives, decide once the round ends; results once the run ended.
 */
export function resolvePhase(
  plan: ScenarioRoundPlanEntry[],
  round: number,
  signals: RoundSignals | undefined,
  ended: boolean,
): ElectionPhase {
  if (ended) return "results";
  const entry = plan.find((r) => r.round === round);
  const phases = (entry?.phases ?? ["converse"]).filter(isPhase);
  let current: ElectionPhase = phases[0] ?? "converse";
  if (!signals || signals.round !== round) return current;
  for (const ph of phases) {
    const fired =
      ph === "seed" ||
      (ph === "converse" && signals.converse) ||
      (ph === "news" && signals.news) ||
      (ph === "opinion" && signals.opinion) ||
      (ph === "decide" && signals.ended);
    if (fired) current = ph;
  }
  return current;
}

/** First plan round that includes `phase`, or null when the plan never does. */
export function firstRoundWith(plan: ScenarioRoundPlanEntry[], phase: string): number | null {
  const rounds = plan.filter((r) => r.phases.includes(phase)).map((r) => r.round);
  return rounds.length ? Math.min(...rounds) : null;
}

/** Whether the plan puts a decide phase in `round`. */
export function roundDecides(plan: ScenarioRoundPlanEntry[], round: number): boolean {
  return plan.some((r) => r.round === round && r.phases.includes("decide"));
}

export function townTally(agents: AgentState[], undecidedId: string): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const a of agents) {
    const id = a.opinion?.candidate;
    if (!id || id === undecidedId) continue;
    tally[id] = (tally[id] ?? 0) + 1;
  }
  return tally;
}

/** Leading option id, or null on a tie or with nothing counted. */
export function leaderOf(tally: Record<string, number>): string | null {
  let best: string | null = null;
  let bestN = 0;
  let tie = false;
  for (const [id, n] of Object.entries(tally)) {
    if (n > bestN) { best = id; bestN = n; tie = false; }
    else if (n === bestN && n > 0) tie = true;
  }
  return tie ? null : best;
}

export interface CivicEnvInput {
  plan: ScenarioRoundPlanEntry[];
  townId: string;
  currentRound: number;
  totalRounds: number;
  signals: RoundSignals | undefined;
  headlines: string[];
  agents: AgentState[];
  undecidedId: string;
  finalSummary: DistrictSummary | null;
  labels: Record<string, string>;
}

export function buildCivicEnv(input: CivicEnvInput): CivicEnv {
  const round = input.signals?.round ?? input.currentRound;
  const ended = input.finalSummary !== null;
  const phase = resolvePhase(input.plan, round, input.signals, ended);
  const firstOpinion = firstRoundWith(input.plan, "opinion");
  const opinionRevealed = ended || (firstOpinion === null ? round >= 1 : round >= firstOpinion);
  const tally = townTally(input.agents, input.undecidedId);
  let result: CivicEnv["result"] = null;
  if (ended) {
    const town = input.finalSummary?.town_summaries?.find((t) => t.town === input.townId);
    const finalTally: Record<string, number> = {};
    for (const [id, n] of Object.entries(town?.opinions ?? {})) {
      if (id !== input.undecidedId && n > 0) finalTally[id] = n;
    }
    const useTally = Object.keys(finalTally).length ? finalTally : tally;
    result = { winner: leaderOf(useTally), tally: useTally };
  }
  return {
    phase,
    round,
    totalRounds: input.totalRounds,
    opinionRevealed,
    headlines: input.headlines,
    tally,
    leader: leaderOf(tally),
    result,
    labels: input.labels,
  };
}

/* ── Results of a finished run ─────────────────────────────── */

export interface TownResult {
  town: string;
  counts: Record<string, number>;
  /** Residents counted, undecided included. */
  total: number;
  undecided: number;
  winner: string | null;
  /** Lead of the first option over the second, in residents and as a share of decided. */
  margin: number;
  marginPct: number;
}

export interface SwingResident {
  agentId: string;
  name: string;
  town: string;
  from: string;
  to: string;
  round: number;
  kind: "switched" | "decided";
}

export interface RunResults {
  winner: string | null;
  district: Omit<TownResult, "town">;
  towns: TownResult[];
  swing: SwingResident[];
}

function tallyResult(counts: Record<string, number>, undecidedId: string): Omit<TownResult, "town"> {
  const decided: Record<string, number> = {};
  let total = 0;
  for (const [id, n] of Object.entries(counts)) {
    total += n;
    if (id !== undecidedId && n > 0) decided[id] = n;
  }
  const ranked = Object.values(decided).sort((a, b) => b - a);
  const decidedTotal = ranked.reduce((a, b) => a + b, 0);
  const margin = (ranked[0] ?? 0) - (ranked[1] ?? 0);
  return {
    counts,
    total,
    undecided: counts[undecidedId] ?? 0,
    winner: leaderOf(decided),
    margin,
    marginPct: decidedTotal > 0 ? margin / decidedTotal : 0,
  };
}

/**
 * Everything the results moment needs, from the final district summary
 * and the run's events: the winner, district and per-town tallies, and
 * the residents who moved — switched between options, or came off the
 * fence — with the round it happened in. Pure and scenario-agnostic.
 */
export function resultsFromRun(
  summary: DistrictSummary,
  events: SimulationEvent[],
  undecidedId: string,
): RunResults {
  const towns = summary.town_summaries.map((t) => ({ town: t.town, ...tallyResult(t.opinions ?? {}, undecidedId) }));
  const districtCounts: Record<string, number> = { ...(summary.overall_opinions ?? {}) };
  if (Object.keys(districtCounts).length === 0) {
    for (const t of towns) for (const [id, n] of Object.entries(t.counts)) districtCounts[id] = (districtCounts[id] ?? 0) + n;
  }
  const district = tallyResult(districtCounts, undecidedId);

  // First stance per resident (the seed) and the last change that moved them.
  const first = new Map<string, string>();
  const last = new Map<string, SwingResident>();
  for (const evt of events) {
    if (evt.type === "simulation_started") {
      for (const a of evt.agents) first.set(a.id, a.opinion?.candidate ?? undecidedId);
      continue;
    }
    if (evt.type !== "opinion_changed") continue;
    const to = evt.new_opinion?.candidate ?? undecidedId;
    if (!first.has(evt.agent_id)) { first.set(evt.agent_id, evt.old_opinion?.candidate ?? to); }
    const from = last.get(evt.agent_id)?.to ?? first.get(evt.agent_id) ?? undecidedId;
    if (from === to) continue;
    const round = evt.new_opinion?.round_number ?? 0;
    if (round === 0) { first.set(evt.agent_id, to); continue; }
    last.set(evt.agent_id, {
      agentId: evt.agent_id,
      name: evt.agent_name,
      town: evt.town,
      from,
      to,
      round,
      kind: from === undecidedId ? "decided" : "switched",
    });
  }
  const swing = [...last.values()]
    .filter((s) => s.to !== undecidedId)
    .sort((a, b) => (a.kind === b.kind ? b.round - a.round : a.kind === "switched" ? -1 : 1));
  return { winner: district.winner, district, towns, swing };
}

/** Per-round district (or one town's) tallies from the run's round_ended events. */
export function trajectoryFromEvents(
  events: SimulationEvent[],
  town?: string | null,
): Array<{ round: number; counts: Record<string, number> }> {
  const byRound = new Map<number, Record<string, number>>();
  for (const evt of events) {
    if (evt.type !== "round_ended") continue;
    const counts = byRound.get(evt.round) ?? {};
    for (const t of evt.summary ?? []) {
      if (town && t.town !== town) continue;
      for (const [id, n] of Object.entries(t.opinions ?? {}) as Array<[string, number]>) counts[id] = (counts[id] ?? 0) + n;
    }
    byRound.set(evt.round, counts);
  }
  return [...byRound.entries()].sort((a, b) => a[0] - b[0]).map(([round, counts]) => ({ round, counts }));
}
