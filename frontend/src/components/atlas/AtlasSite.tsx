import type { TownId } from "../../types/messages";
import type { OverworldAtlas } from "./overworld";
import { residentsLine, siteAriaLabel } from "./types";
import type { SiteView } from "./types";

interface AtlasSiteProps {
  site: SiteView;
  atlas: Pick<OverworldAtlas, "width" | "height" | "tile">;
  lit: boolean;
  /** id of the hover card describing this site, while it is shown. */
  describedBy?: string;
  onHover: (id: TownId | null) => void;
  onActivate: (id: TownId) => void;
}

/**
 * The town's hanging nameplate: two rope pixels drop from the pad's south
 * edge into a parchment plaque (2px ink 9-slice — the speech-bubble
 * language) carrying the Cinzel name, a ribbon in the town accent, and the
 * "N residents · county" line. Hover or focus lifts it; activating it
 * enters the town.
 */
export default function AtlasSite({ site, atlas, lit, describedBy, onHover, onActivate }: AtlasSiteProps) {
  const { pad } = site.record;
  const left = (((pad.x + pad.w / 2) * atlas.tile) / atlas.width) * 100;
  const top = (((pad.y + pad.h) * atlas.tile) / atlas.height) * 100;
  const metaLine = [residentsLine(site), site.meta.county].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      className={`atlas-site${lit ? " atlas-site--lit" : ""}`}
      style={{ left: `${left}%`, top: `${top}%`, ["--town-accent" as string]: site.meta.color }}
      aria-label={siteAriaLabel(site)}
      aria-describedby={describedBy}
      onClick={() => onActivate(site.id)}
      onMouseEnter={() => onHover(site.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(site.id)}
      onBlur={() => onHover(null)}
    >
      <span className="atlas-site-ropes" aria-hidden="true">
        <i />
        <i />
      </span>
      <span className="atlas-site-plate">
        <span className="atlas-site-name">{site.meta.name}</span>
        <span className="atlas-site-ribbon" aria-hidden="true" />
        <span className="atlas-site-meta">{metaLine}</span>
      </span>
    </button>
  );
}
