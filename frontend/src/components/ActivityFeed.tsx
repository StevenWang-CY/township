/* ── ActivityFeed ────────────────────────────────────────────
 * The town's recent life as short causal lines. Rows about a resident tap
 * through to them. Stance shifts carry the new option's colour; causes
 * appear when attribution supplies them.
 * ─────────────────────────────────────────────────────────── */

import type { ActivityEntry, ActivityKind } from "../lib/activity";
import { useScenario } from "../hooks/useScenario";
import { readableInk } from "../lib/color";
import Icon, { type IconName } from "./Icon";

const KIND_ICON: Record<ActivityKind, IconName> = {
  move: "walk", talk: "talk", shift: "arrow-right", news: "news", vote: "ballot", gossip: "gossip",
};

interface ActivityFeedProps {
  entries: ActivityEntry[];
  accent: string;
  onSelect?: (agentId: string) => void;
  emptyText?: string;
}

export default function ActivityFeed({ entries, accent, onSelect, emptyText }: ActivityFeedProps) {
  const scen = useScenario();
  if (entries.length === 0) {
    return (
      <div className="activity-feed activity-feed--empty">
        <span className="activity-dot" style={{ background: accent }} aria-hidden="true" />
        <p>{emptyText ?? "Waiting for the town to stir…"}</p>
      </div>
    );
  }
  return (
    <ol className="activity-feed">
      {entries.map((e) => {
        const clickable = Boolean(e.actorId && onSelect);
        const stance = e.kind === "shift" ? scen.optionColor(e.stanceId) : null;
        const rowProps = clickable
          ? {
              role: "button" as const,
              tabIndex: 0,
              title: `Talk to ${e.actor}`,
              onClick: () => onSelect!(e.actorId!),
              onKeyDown: (ev: React.KeyboardEvent) => {
                if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onSelect!(e.actorId!); }
              },
            }
          : {};
        return (
          <li
            key={e.id}
            className={`activity-row activity-row--${e.kind}${clickable ? " activity-row--link" : ""}`}
            {...rowProps}
          >
            <span className="activity-glyph" style={stance ? { color: readableInk(stance, 5) } : undefined}>
              <Icon name={KIND_ICON[e.kind]} size={13} />
            </span>
            <span className="activity-text">
              {e.kind === "shift" && (
                <>
                  <strong>{e.actor}</strong>
                  <span className="activity-arrow" aria-hidden="true"> → </span>
                  <span className="sr-only"> now leans </span>
                  <strong style={{ color: readableInk(stance!, 5) }}>{scen.optionLabel(e.stanceId)}</strong>
                </>
              )}
              {e.kind === "move" && (<><strong>{e.actor}</strong> went to {e.target}</>)}
              {e.kind === "talk" && (<><strong>{e.actor}</strong>{e.target ? <> &amp; {e.target}</> : null} started talking</>)}
              {e.kind === "news" && (<><span className="activity-kicker">News</span> {e.target}</>)}
              {e.kind === "vote" && (<><strong>{e.actor}</strong> cast a ballot</>)}
              {e.kind === "gossip" && (<><strong>{e.actor}</strong> told <strong>{e.target}</strong> what they heard</>)}
              {e.cause && <span className="activity-cause"> · {e.cause}</span>}
            </span>
            {e.round != null && <span className="activity-round" title={`Round ${e.round}`}>r{e.round}</span>}
          </li>
        );
      })}
    </ol>
  );
}
