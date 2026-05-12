import type { AgentState, LeanId } from "../types/messages";
import { TOWN_META, CANDIDATE_COLORS, CANDIDATE_NAMES } from "../types/messages";

interface ProximityCardProps {
  agent: AgentState;
  trust?: number;
  /** Screen-space x,y (top-center of card). */
  x: number;
  y: number;
}

export default function ProximityCard({ agent, trust = 0, x, y }: ProximityCardProps) {
  const meta = TOWN_META[agent.town];
  const candidate = (agent.opinion?.candidate as LeanId) ?? "undecided";
  const candidateColor = CANDIDATE_COLORS[candidate];
  const trustPct = Math.max(0, Math.min(100, (trust + 100) / 2));

  return (
    <div
      className="proximity-card"
      style={{
        position: "absolute",
        left: x,
        top: y,
        transform: "translate(-50%, -100%)",
        pointerEvents: "none",
        zIndex: 20,
      }}
    >
      <div className="proximity-card-inner">
        <div className="proximity-card-row">
          <span
            className="proximity-card-name"
            style={{ color: meta.color }}
            title={agent.name}
          >
            {agent.name}
          </span>
          <span className="proximity-card-town">{meta.name}</span>
        </div>
        <div className="proximity-card-row proximity-card-activity">
          <span style={{ background: meta.color }} className="proximity-card-dot" />
          <span>{agent.current_activity || agent.activity || "Idle"}</span>
        </div>
        <div className="proximity-card-row">
          <span
            className="proximity-card-pill"
            style={{
              background: `${candidateColor}1A`,
              color: candidateColor,
              borderColor: `${candidateColor}40`,
            }}
          >
            {CANDIDATE_NAMES[candidate]}
          </span>
          <div className="proximity-card-trust">
            <div
              className="proximity-card-trust-fill"
              style={{ width: `${trustPct}%` }}
            />
          </div>
        </div>
      </div>
      <div className="proximity-card-tail" />
    </div>
  );
}
