import type { TownId } from "../../types/messages";

/** Parchment placeholder while the overworld PNG is still arriving. */
export function AtlasSkeleton() {
  return (
    <div className="atlas-skeleton" role="status" aria-busy="true">
      <span className="route-loading-mark" aria-hidden="true" />
      <span className="atlas-skeleton-label">Drawing the district…</span>
    </div>
  );
}

export interface TownButton {
  id: TownId;
  name: string;
  color: string;
}

interface AtlasUnavailableProps {
  towns: TownButton[];
  onActivate: (id: TownId) => void;
}

/** The map failed to load: a parchment card that still gets people into town. */
export function AtlasUnavailable({ towns, onActivate }: AtlasUnavailableProps) {
  return (
    <div className="atlas-unavailable" role="group" aria-label="Towns">
      <p className="atlas-unavailable-title">The district map is unavailable</p>
      <p className="atlas-unavailable-sub">Pick a community to visit it directly.</p>
      <div className="atlas-unavailable-towns">
        {towns.map((town) => (
          <button
            key={town.id}
            type="button"
            className="atlas-unavailable-town atlas-site"
            style={{ ["--town-accent" as string]: town.color }}
            onClick={() => onActivate(town.id)}
          >
            {town.name}
          </button>
        ))}
      </div>
    </div>
  );
}
