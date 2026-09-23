/* ── TownSwitcher ────────────────────────────────────────────
 * Segmented control for hopping between towns, living inside the canvas
 * chrome instead of a bar above it. One item per town: accent dot, name,
 * resident count. Scroll-snaps on narrow screens.
 * ─────────────────────────────────────────────────────────── */

import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { useScenario } from "../hooks/useScenario";

interface TownSwitcherProps {
  current: string;
  counts: Record<string, number>;
  className?: string;
}

/** "Parsippany-Troy Hills" → "Parsippany" once a name stops fitting a chip. */
export function shortTownName(name: string): string {
  if (name.length <= 14) return name;
  const head = name.split(/[-–—]/)[0].trim();
  return head.length >= 4 ? head : name;
}

export default function TownSwitcher({ current, counts, className }: TownSwitcherProps) {
  const scen = useScenario();
  return (
    <nav className={`town-switcher${className ? ` ${className}` : ""}`} aria-label="Towns">
      {scen.scenario.towns.map((t) => {
        const m = scen.townMeta(t.id);
        const active = t.id === current;
        const count = counts[t.id] ?? 0;
        return (
          <Link
            key={t.id}
            to={`/town/${t.id}`}
            className={`town-switcher-item${active ? " town-switcher-item--active" : ""}`}
            aria-current={active ? "page" : undefined}
            title={[m.name, m.tagline, m.county].filter(Boolean).join(" — ")}
            style={{ "--town-accent": m.color } as CSSProperties}
          >
            <span className="town-switcher-dot" aria-hidden="true" />
            <span className="town-switcher-name">{shortTownName(m.name)}</span>
            {count > 0 && (
              <span className="town-switcher-count" aria-label={`${count} residents`}>{count}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
