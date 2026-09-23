import { fnv1a } from "../../lib/hash";
import type { AgentState } from "../../types/messages";
import { pointAlong, walkLength, walkPath } from "./overworld";
import type { SiteView } from "./types";

/** px per second along the sidewalk loop — a stroll, not a commute. */
const STROLL_SPEED = 14;
/** Movement is quantised to whole pixel steps so the figures shuffle. */
const STEP_PX = 2;

let offsetPathSupport: boolean | null = null;
/** `offset-path: path()` is what carries the figures; without it they stand. */
export function supportsOffsetPath(): boolean {
  if (offsetPathSupport === null) {
    offsetPathSupport =
      typeof CSS !== "undefined" &&
      typeof CSS.supports === "function" &&
      CSS.supports("offset-path", "path('M0 0 L1 1')");
  }
  return offsetPathSupport;
}

interface AtlasFolkProps {
  site: SiteView;
  stanceColor: (agent: AgentState) => string;
  /** False under reduced motion or without offset-path: figures stand still. */
  animate: boolean;
}

/**
 * One 4x6 px pixel figure per resident of the town, tinted by their current
 * stance, walking the pad's sidewalk loop (`offset-path` + a stepped
 * two-frame leg cycle), staggered around the loop so the street reads as
 * lived-in rather than as a parade.
 */
export default function AtlasFolk({ site, stanceColor, animate }: AtlasFolkProps) {
  const { walk } = site.record;
  if (walk.length < 2 || site.agents.length === 0) return null;
  const path = walkPath(walk);
  const length = walkLength(walk);
  const count = site.agents.length;
  return (
    <>
      {site.agents.map((agent, i) => {
        const seed = fnv1a(agent.id);
        const phase = (i + 0.5) / count;
        const color = stanceColor(agent);
        if (!animate) {
          const [x, y] = pointAlong(walk, phase);
          return (
            <span
              key={agent.id}
              className="atlas-folk atlas-folk--still"
              style={{ left: `${x}px`, top: `${y}px`, color }}
            />
          );
        }
        const pace = 0.85 + (seed % 1000) / 1000 * 0.3; // 0.85 … 1.15
        const duration = (length / STROLL_SPEED) * pace;
        const steps = Math.max(8, Math.round(length / STEP_PX));
        const reverse = ((seed >>> 3) & 1) === 1;
        return (
          <span
            key={agent.id}
            className="atlas-folk"
            style={{
              color,
              offsetPath: `path("${path}")`,
              animationDuration: `${duration.toFixed(2)}s`,
              animationDelay: `${(-phase * duration).toFixed(2)}s`,
              animationTimingFunction: `steps(${steps})`,
              animationDirection: reverse ? "reverse" : "normal",
              ["--leg-delay" as string]: `${(-(seed % 600) / 1000).toFixed(2)}s`,
            }}
          />
        );
      })}
    </>
  );
}
