/* ── ScenarioContext ─────────────────────────────────────────
 *
 * Bootstraps the frontend from GET /api/scenario: the question being
 * deliberated, the options (ids/labels/colors), the towns, and the round
 * count. Every component resolves scenario vocabulary through the helpers
 * here instead of importing the NJ-11 constant tables.
 *
 * The static demo loads the same payload shape from its staged manifest. If
 * either source is unavailable, the provider renders an explicit neutral
 * error state; it never substitutes facts from another scenario.
 * ─────────────────────────────────────────────────────────── */

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { ScenarioData, ScenarioOption, ScenarioTownInfo, TownMapInfo } from "../types/messages";
import { DEMO_MODE, demoUrl, resolveDemoScenarioId } from "../demo/demoMode";
import type { DemoManifest } from "../demo/demoMode";

/* ── Context shape ─────────────────────────────────────────── */

export interface ResolvedTownMeta {
  id: string;
  name: string;
  tagline: string;
  color: string;
  county?: string;
  /** Pre-formatted for display (e.g. "18,435"). */
  population?: string;
  map?: TownMapInfo;
}

export interface ScenarioContextValue {
  scenario: ScenarioData;
  /** Retained for consumers that coordinate secondary staged payloads. */
  loading: boolean;
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
const CANONICAL_CORE_NOTICE =
  "Township is a simulation, not a poll. Its outputs do not measure real public opinion and must never be presented as if they do.";

export function buildScenarioValue(
  scenario: ScenarioData,
  loading = false,
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
      map: t.map ?? undefined,
    };
  };

  const optionNoun = (plural = false): string => {
    const base = decisionKind === "election" ? "candidate" : "option";
    return plural ? `${base}s` : base;
  };

  return {
    scenario,
    loading,
    decisionKind,
    title: scenario.title,
    question: scenario.question,
    totalRounds: scenario.total_rounds,
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

export const ScenarioContext = createContext<ScenarioContextValue | null>(null);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Runtime boundary for API and hand-staged demo payloads. */
function looksLikeScenario(d: unknown): d is ScenarioData {
  if (!isRecord(d)) return false;
  const s = d;
  const options = Array.isArray(s.options) ? s.options : [];
  const towns = Array.isArray(s.towns) ? s.towns : [];
  const undecided = isRecord(s.undecided) ? s.undecided : null;
  const dates = isRecord(s.dates) ? s.dates : null;
  const responsible = isRecord(s.responsible_use) ? s.responsible_use : null;

  const optionIds = options.map((value) => isRecord(value) ? value.id : undefined);
  const townIds = towns.map((value) => isRecord(value) ? value.id : undefined);
  const optionsValid = options.length > 0 && options.every((value) => (
    isRecord(value) &&
    hasText(value.id) &&
    hasText(value.name) &&
    hasText(value.label) &&
    hasText(value.color)
  )) && new Set(optionIds).size === optionIds.length;
  const townsValid = towns.length > 0 && towns.every((value) => (
    isRecord(value) &&
    hasText(value.id) &&
    hasText(value.name) &&
    typeof value.tagline === "string" &&
    hasText(value.color) &&
    (
      value.map == null ||
      (
        isRecord(value.map) &&
        value.map.kind === "tiled" &&
        hasText(value.map.path) &&
        value.map.path.startsWith("assets/maps/") &&
        hasText(value.map.preview_path) &&
        value.map.preview_path.startsWith("assets/maps/")
      )
    )
  )) && new Set(townIds).size === townIds.length;

  return (
    hasText(s.id) &&
    hasText(s.title) &&
    hasText(s.question) &&
    (s.decision_kind === "election" || s.decision_kind === "vote") &&
    optionsValid &&
    townsValid &&
    Boolean(undecided) &&
    hasText(undecided?.id) &&
    hasText(undecided?.label) &&
    hasText(undecided?.color) &&
    typeof s.total_rounds === "number" &&
    Number.isInteger(s.total_rounds) &&
    s.total_rounds > 0 &&
    Boolean(dates) &&
    hasText(dates?.decision_day) &&
    hasText(dates?.prose) &&
    Boolean(responsible) &&
    hasText(responsible?.core_notice) &&
    responsible.core_notice.trim() === CANONICAL_CORE_NOTICE &&
    hasText(responsible?.residents_notice) &&
    hasText(responsible?.subjects_notice) &&
    hasText(responsible?.outputs_notice)
  );
}

export function ScenarioProvider({ children }: { children: ReactNode }) {
  const [scenario, setScenario] = useState<ScenarioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    const timeout = window.setTimeout(() => ctrl.abort(), 5000);

    // Demo mode (GitHub Pages, zero backend): bootstrap from the STAGED
    // scenario files instead of /api/scenario. stage-demo.mjs writes a
    // manifest listing every staged scenario plus one <id>-scenario.json per
    // scenario in the exact /api/scenario shape.
    const source: Promise<unknown> = DEMO_MODE
      ? fetch(demoUrl("manifest.json"), { signal: ctrl.signal })
          .then((r) => (r.ok ? (r.json() as Promise<DemoManifest>) : Promise.reject(new Error(`HTTP ${r.status}`))))
          .then((m) => fetch(demoUrl(`${resolveDemoScenarioId(m)}-scenario.json`), { signal: ctrl.signal }))
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      : fetch("/api/scenario", { signal: ctrl.signal })
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))));

    source
      .then((d) => {
        if (cancelled) return;
        if (looksLikeScenario(d)) {
          setScenario(d);
        } else {
          throw new Error("Scenario payload is incomplete");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setScenario(null);
          setError(
            DEMO_MODE
              ? "The recorded scenario could not be loaded."
              : "The server did not provide a valid scenario package.",
          );
        }
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
    () => (scenario ? buildScenarioValue(scenario, false) : null),
    [scenario],
  );

  if (loading) {
    return (
      <main className="scenario-bootstrap-state" aria-busy="true">
        <div role="status" aria-live="polite">
          <span className="route-loading-mark" aria-hidden="true" />
          <h1>Opening Township</h1>
          <p>Loading the active civic scenario…</p>
        </div>
      </main>
    );
  }

  if (error || !value) {
    return (
      <main className="scenario-bootstrap-state">
        <div role="alert">
          <p className="scenario-bootstrap-eyebrow">Scenario unavailable</p>
          <h1>Township could not open this civic world.</h1>
          <p>{error ?? "The scenario package is incomplete."}</p>
          <p>No candidate, town, or policy data has been substituted.</p>
          <button type="button" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      </main>
    );
  }

  return <ScenarioContext.Provider value={value}>{children}</ScenarioContext.Provider>;
}

export function useScenarioContext(): ScenarioContextValue {
  const value = useContext(ScenarioContext);
  if (!value) throw new Error("useScenarioContext must be used within ScenarioProvider");
  return value;
}
