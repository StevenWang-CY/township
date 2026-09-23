import { useState } from "react";
import type { CSSProperties } from "react";
import type { ScenarioContextValue } from "../../hooks/useScenario";
import { appUrl } from "../../lib/assetUrl";
import { readableInk, withAlpha } from "../../lib/color";
import SpritePortrait from "../SpritePortrait";
import { residentsLine } from "./types";
import type { SiteView } from "./types";

interface AtlasHoverCardProps {
  site: SiteView;
  scenario: ScenarioContextValue;
  /** `float`: the desktop hover card inside the panel. `sheet`: the tap
   *  sheet below the panel on touch / compact screens, with its actions. */
  variant: "float" | "sheet";
  id?: string;
  style?: CSSProperties;
  onEnter?: () => void;
  onClose?: () => void;
}

/**
 * The town at a glance: its postcard (the set-piece crop, 224x144, pixel
 * crisp), the first resident's portrait, name, tagline, the leading option
 * and the census line — one parchment plaque in the nameplates' language.
 */
export default function AtlasHoverCard({ site, scenario, variant, id, style, onEnter, onClose }: AtlasHoverCardProps) {
  const [postcardFailed, setPostcardFailed] = useState(false);
  const { meta } = site;
  const postcard = meta.postcardPath && !postcardFailed ? appUrl(meta.postcardPath) : null;
  const resident = site.agents[0] ?? null;
  const leaderInk = site.leaderColor ? readableInk(site.leaderColor) : "var(--text-muted)";
  const chipTone = site.leaderColor ?? "var(--color-neutral)";
  const census = [meta.population ? `Pop. ${meta.population}` : "", meta.county ?? ""]
    .filter(Boolean)
    .join(" · ");
  const sheet = variant === "sheet";
  return (
    <div
      id={id}
      className={`atlas-hover-card atlas-hover-card--${variant}`}
      style={style}
      role={sheet ? undefined : "tooltip"}
    >
      <div className="atlas-postcard-frame">
        {postcard ? (
          <img
            className="atlas-postcard"
            src={postcard}
            width={224}
            height={144}
            alt=""
            onError={() => setPostcardFailed(true)}
          />
        ) : (
          <span className="atlas-postcard-fallback">Postcard unavailable</span>
        )}
      </div>
      <div className="atlas-hover-card-row">
        {resident && (
          <SpritePortrait
            agentId={resident.id}
            spriteKey={resident.sprite_key}
            accessoryKey={resident.accessory_key}
            fallbackInitials={resident.initials}
            color={resident.color || meta.color}
            size={22}
          />
        )}
        <span className="atlas-hover-card-name">{meta.name}</span>
      </div>
      {meta.tagline && <span className="atlas-hover-card-tagline">{meta.tagline}</span>}
      <span
        className="atlas-hover-card-chip"
        style={{
          background: withAlpha(chipTone, 0.12),
          borderColor: withAlpha(chipTone, 0.35),
          color: leaderInk,
        }}
      >
        <span className="atlas-hover-card-chip-dot" style={{ background: chipTone }} aria-hidden="true" />
        {site.leaderLabel ? `Leading: ${site.leaderLabel}` : `No ${scenario.optionNoun()} leading yet`}
      </span>
      <span className="atlas-hover-card-detail">{census || residentsLine(site)}</span>
      {sheet && (
        <div className="atlas-sheet-actions">
          <button type="button" className="atlas-sheet-enter" onClick={onEnter}>
            Enter {meta.name}
          </button>
          <button type="button" className="atlas-sheet-close" onClick={onClose}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}
