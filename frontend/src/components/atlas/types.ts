import type { ResolvedTownMeta } from "../../hooks/useScenario";
import type { AgentState, TownId } from "../../types/messages";
import type { AtlasSiteRecord } from "./overworld";

/** Everything one town's atlas layers need, assembled once by DistrictMap. */
export interface SiteView {
  id: TownId;
  meta: ResolvedTownMeta;
  record: AtlasSiteRecord;
  /** This town's residents (live stream, replay roster, or API roster). */
  agents: AgentState[];
  total: number;
  met: number;
  /** Player-quest chrome ("x/y met") renders only when a real player exists. */
  showMet: boolean;
  leaderLabel: string | null;
  leaderColor: string | null;
}

export function residentsLine(site: SiteView): string {
  if (site.total <= 0) return "Residents";
  if (site.showMet) return `${site.met}/${site.total} met`;
  return `${site.total} resident${site.total === 1 ? "" : "s"}`;
}

export function siteAriaLabel(site: SiteView): string {
  const lead = site.leaderLabel ? `${site.leaderLabel} is leading. ` : "No leading option yet. ";
  const folk = site.showMet
    ? `${site.met} of ${site.total} residents met. `
    : `${site.total} residents. `;
  return `${site.meta.name}. ${lead}${folk}Enter town.`;
}
