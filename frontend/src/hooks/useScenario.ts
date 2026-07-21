/* ── useScenario ─────────────────────────────────────────────
 * Convenience hook over ScenarioContext. Components call this to resolve
 * the active scenario's vocabulary (options, towns, labels, colors) with
 * automatic NJ-11 fallbacks when the backend is unreachable.
 * ─────────────────────────────────────────────────────────── */

import { useScenarioContext } from "../context/ScenarioContext";
import type { ScenarioContextValue, ResolvedTownMeta } from "../context/ScenarioContext";

export type { ScenarioContextValue, ResolvedTownMeta };

export function useScenario(): ScenarioContextValue {
  return useScenarioContext();
}
