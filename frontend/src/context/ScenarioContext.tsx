/* ── ScenarioContext ─────────────────────────────────────────
 *
 * Bootstraps the frontend from GET /api/scenario: the question being
 * deliberated, the options (ids/labels/colors), the towns, and the round
 * count. Every component resolves scenario vocabulary through the helpers
 * here instead of importing the NJ-11 constant tables.
 *
 * Offline story: when the backend is unreachable (GitHub Pages demo, dev
 * with no server, 5s timeout) we synthesize the flagship NJ-11 scenario
 * from the fallback tables in types/messages.ts, so every consumer works
 * identically with zero configuration.
 * ─────────────────────────────────────────────────────────── */

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { ScenarioData, ScenarioOption, ScenarioTownInfo } from "../types/messages";
import { TOWN_META, CANDIDATE_COLORS, CANDIDATE_NAMES } from "../types/messages";

/* ── NJ-11 synthetic fallback (mirrors backend scenarios/nj11-2026) ── */

const NJ11_ID = "nj11-2026";

export const NJ11_FALLBACK_SCENARIO: ScenarioData = {
  id: NJ11_ID,
  title: "The NJ-11 Special Election",
  question:
    "Who should represent New Jersey's 11th Congressional District — Analilia Mejia (D), Joe Hathaway (R), or Alan B. Bond (I)?",
  decision_kind: "election",
  options: [
    { id: "mejia", name: "Analilia Mejia", label: CANDIDATE_NAMES.mejia, color: CANDIDATE_COLORS.mejia, group: "Democrat" },
    { id: "hathaway", name: "Joe Hathaway", label: CANDIDATE_NAMES.hathaway, color: CANDIDATE_COLORS.hathaway, group: "Republican" },
    { id: "bond", name: "Alan B. Bond", label: CANDIDATE_NAMES.bond, color: CANDIDATE_COLORS.bond, group: "Independent" },
  ],
  undecided: { id: "undecided", label: CANDIDATE_NAMES.undecided, color: CANDIDATE_COLORS.undecided },
  towns: Object.entries(TOWN_META).map(([id, m]) => ({
    id,
    name: m.name,
    tagline: m.tagline,
    color: m.color,
    county: `${m.county} County`,
    population: m.population,
  })),
  total_rounds: 5,
  dates: {
    decision_day: "2026-04-16",
    prose: "Early voting happening now (April 6 – 14). 26 AI residents across 4 towns are deliberating.",
  },
};

/* ── Context shape ─────────────────────────────────────────── */

export interface ResolvedTownMeta {
  id: string;
  name: string;
  tagline: string;
  color: string;
  county?: string;
  /** Pre-formatted for display (e.g. "18,435"). */
  population?: string;
}

export interface ScenarioContextValue {
  scenario: ScenarioData;
  /** True while the initial /api/scenario fetch is in flight. */
  loading: boolean;
  /** True when the fetch failed and we synthesized the NJ-11 fallback. */
  offline: boolean;
  /** True when the ACTIVE scenario is flagship NJ-11 (live or fallback). */
  isNJ11: boolean;
  decisionKind: "election" | "vote";
  title: string;
  question: string;
  totalRounds: number;
  /** All stance ids in canonical chart order: options first, undecided last. */
  stanceIds: string[];
  /** Option ids only (no undecided). */
  optionIds: string[];
  undecidedId: string;
  optionColor: (id?: string | null) => string;
  optionLabel: (id?: string | null) => string;
  optionName: (id?: string | null) => string;
  townMeta: (id?: string | null) => ResolvedTownMeta;
  /** "candidate(s)" for elections, "option(s)" for votes. */
  optionNoun: (plural?: boolean) => string;
}

function deslug(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatPopulation(p: number | string | undefined): string | undefined {
  if (p == null || p === "") return undefined;
  return typeof p === "number" ? p.toLocaleString("en-US") : String(p);
}

/** Neutral warm-ink color for unknown ids — sits quietly in the parchment UI. */
const UNKNOWN_INK = "#8A7E6E";

export function buildScenarioValue(
  scenario: ScenarioData,
  loading: boolean,
  offline: boolean,
): ScenarioContextValue {
  const optionById = new Map<string, ScenarioOption>();
  for (const o of scenario.options) optionById.set(o.id, o);
  const townById = new Map<string, ScenarioTownInfo>();
  for (const t of scenario.towns) townById.set(t.id, t);

  const undecidedId = scenario.undecided?.id ?? "undecided";
  const optionIds = scenario.options.map((o) => o.id);
  const stanceIds = [...optionIds, undecidedId];
  const decisionKind = scenario.decision_kind === "vote" ? "vote" : "election";

  const optionColor = (id?: string | null): string => {
    if (!id || id === undecidedId) return scenario.undecided?.color ?? "#D1D5DB";
    return optionById.get(id)?.color ?? UNKNOWN_INK;
  };

  const optionLabel = (id?: string | null): string => {
    if (!id) return scenario.undecided?.label ?? "Undecided";
    if (id === undecidedId) return scenario.undecided?.label ?? "Undecided";
    return optionById.get(id)?.label ?? deslug(id);
  };

  const optionName = (id?: string | null): string => {
    if (!id || id === undecidedId) return scenario.undecided?.label ?? "Undecided";
    const o = optionById.get(id);
    return o?.name ?? o?.label ?? deslug(id);
  };

  const townMeta = (id?: string | null): ResolvedTownMeta => {
    const t = id ? townById.get(id) : undefined;
    if (!t) {
      return {
        id: id ?? "",
        name: id ? deslug(id) : "Unknown Town",
        tagline: "",
        color: UNKNOWN_INK,
      };
    }
    return {
      id: t.id,
      name: t.name,
      tagline: t.tagline ?? "",
      color: t.color || UNKNOWN_INK,
      county: t.county || undefined,
      population: formatPopulation(t.population),
    };
  };

  const optionNoun = (plural = false): string => {
    const base = decisionKind === "election" ? "candidate" : "option";
    return plural ? `${base}s` : base;
  };

  return {
    scenario,
    loading,
    offline,
    isNJ11: scenario.id === NJ11_ID,
    decisionKind,
    title: scenario.title,
    question: scenario.question,
    totalRounds: scenario.total_rounds || 5,
    stanceIds,
    optionIds,
    undecidedId,
    optionColor,
    optionLabel,
    optionName,
    townMeta,
    optionNoun,
  };
}

/* ── Context + Provider ────────────────────────────────────── */

// Default value = offline NJ-11 so any consumer outside the provider (tests,
// storybook-style isolation) still renders sensibly.
export const ScenarioContext = createContext<ScenarioContextValue>(
  buildScenarioValue(NJ11_FALLBACK_SCENARIO, false, true),
);

/** Minimal shape check — reject payloads that would crash consumers. */
function looksLikeScenario(d: unknown): d is ScenarioData {
  if (!d || typeof d !== "object") return false;
  const s = d as Record<string, unknown>;
  return (
    typeof s.id === "string" &&
    Array.isArray(s.options) &&
    Array.isArray(s.towns) &&
    s.options.length > 0 &&
    s.towns.length > 0
  );
}

export function ScenarioProvider({ children }: { children: ReactNode }) {
  const [scenario, setScenario] = useState<ScenarioData>(NJ11_FALLBACK_SCENARIO);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    const timeout = window.setTimeout(() => ctrl.abort(), 5000);

    fetch("/api/scenario", { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        if (cancelled) return;
        if (looksLikeScenario(d)) {
          setScenario(d);
          setOffline(false);
        } else {
          setOffline(true);
        }
      })
      .catch(() => {
        if (!cancelled) setOffline(true);
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      ctrl.abort();
    };
  }, []);

  const value = useMemo(
    () => buildScenarioValue(scenario, loading, offline),
    [scenario, loading, offline],
  );

  return <ScenarioContext.Provider value={value}>{children}</ScenarioContext.Provider>;
}

export function useScenarioContext(): ScenarioContextValue {
  return useContext(ScenarioContext);
}
