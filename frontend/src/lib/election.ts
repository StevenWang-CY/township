/**
 * Pure election helpers: turn the reducer's raw round signals and the
 * scenario's round plan into the phase the town is in and the civic
 * environment the scene dresses itself with. Scenario-agnostic — phase
 * names come from the plan, option ids from the roster.
 */
import type { AgentState, DistrictSummary, ScenarioRoundPlanEntry } from "../types/messages";
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
