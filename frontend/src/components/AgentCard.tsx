import { useNavigate } from "react-router-dom";
import type { AgentState, LeanId } from "../types/messages";
import { TOWN_META, CANDIDATE_COLORS, CANDIDATE_NAMES } from "../types/messages";

interface AgentCardProps {
  agent: AgentState;
  compact?: boolean;
  onClick?: () => void;
}

export default function AgentCard({ agent, compact = false, onClick }: AgentCardProps) {
  const navigate = useNavigate();
  const meta = TOWN_META[agent.town];
  const opinionColor = CANDIDATE_COLORS[agent.opinion?.candidate as LeanId] || CANDIDATE_COLORS.undecided;
  const opinionLabel = CANDIDATE_NAMES[(agent.opinion?.candidate as LeanId) || "undecided"];
  const confidence = agent.opinion?.confidence ?? 0;

  const initials =
    agent.initials ||
    agent.name
      .split(" ")
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      navigate(`/town/${agent.town}`);
    }
  };

  if (compact) {
    return (
      <button
        onClick={handleClick}
        className="flex items-center gap-2 px-2 py-1.5 rounded-lg w-full text-left transition-colors hover:bg-white/60"
        style={{ border: "1px solid transparent" }}
      >
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
          style={{
            background: agent.color || meta.color,
            boxShadow: `0 0 0 2px ${opinionColor}`,
          }}
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium truncate" style={{ color: "var(--township-ink)" }}>
            {agent.name}
          </p>
          <p className="text-[10px] truncate" style={{ color: "var(--township-ink-muted)" }}>
            {agent.occupation}
          </p>
        </div>
        <span
          className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0"
          style={{ background: `${opinionColor}20`, color: opinionColor }}
        >
          {opinionLabel}
        </span>
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      className="rounded-xl p-4 text-left transition-all hover:scale-[1.02] active:scale-[0.99] w-full"
      style={{
        background: "var(--card-bg)",
        border: "1px solid var(--card-border)",
        boxShadow: "var(--card-shadow)",
      }}
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
          style={{
            background: agent.color || meta.color,
            boxShadow: `0 0 0 3px ${opinionColor}`,
          }}
        >
          {initials}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-semibold text-sm" style={{ color: "var(--township-ink)" }}>
              {agent.name}
            </span>
            <span className={`town-badge town-badge--${agent.town}`}>{meta.name}</span>
          </div>
          <p className="text-xs" style={{ color: "var(--township-ink-muted)" }}>
            {agent.occupation}
          </p>
        </div>
      </div>

      {/* Opinion + Confidence */}
      <div className="mt-3 flex items-center gap-2">
        <span className={`opinion-badge opinion-badge--${agent.opinion?.candidate || "undecided"}`}>
          {opinionLabel}
        </span>
        {confidence > 0 && (
          <div className="flex-1 flex items-center gap-1.5">
            <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${confidence}%`, background: opinionColor }}
              />
            </div>
            <span className="text-[10px] font-medium" style={{ color: "var(--township-ink-muted)" }}>
              {confidence}%
            </span>
          </div>
        )}
      </div>

      {/* Last activity */}
      {agent.current_activity && (
        <p
          className="mt-2 text-xs truncate"
          style={{ color: "var(--township-ink-muted)", fontStyle: "italic" }}
        >
          {agent.current_activity}
        </p>
      )}
    </button>
  );
}
