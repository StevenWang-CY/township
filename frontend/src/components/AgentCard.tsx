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
  const candidateId = (agent.opinion?.candidate as LeanId) || "undecided";
  const opinionColor = CANDIDATE_COLORS[candidateId] || CANDIDATE_COLORS.undecided;
  const opinionLabel = CANDIDATE_NAMES[candidateId];
  const confidence = agent.opinion?.confidence ?? 0;

  // Mondstadt-style opinion colors
  const mondstadtOpinionColors: Record<string, { border: string; badgeBg: string; badgeText: string }> = {
    mejia: { border: "#4A8FBF", badgeBg: "rgba(74,143,191,0.12)", badgeText: "#4A8FBF" },
    hathaway: { border: "#C0792A", badgeBg: "rgba(192,121,42,0.12)", badgeText: "#C0792A" },
    bond: { border: "#9A8E80", badgeBg: "rgba(154,142,128,0.1)", badgeText: "#9A8E80" },
    undecided: { border: "rgba(154,142,128,0.4)", badgeBg: "rgba(154,142,128,0.1)", badgeText: "var(--text-muted)" },
  };
  const opinionStyle = mondstadtOpinionColors[candidateId] || mondstadtOpinionColors.undecided;

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
        className="flex items-center gap-2 px-2 py-1.5 w-full text-left"
        style={{
          border: "none",
          borderBottom: "1px solid rgba(180,160,120,0.08)",
          borderRadius: 0,
          transition: "background 200ms ease",
          background: "transparent",
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(196,163,90,0.04)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
      >
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
          style={{
            background: agent.color || meta.color,
            border: "2px solid",
            borderColor: opinionStyle.border,
            transition: "border-color 600ms ease",
          }}
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate" style={{
            fontFamily: "var(--font-body)",
            fontWeight: 600,
            color: "var(--text-primary)",
            fontSize: "13px",
          }}>
            {agent.name}
          </p>
          <p className="truncate" style={{
            fontFamily: "var(--font-body)",
            fontSize: "11px",
            color: "var(--text-muted)",
          }}>
            {agent.occupation}
          </p>
        </div>
        <span
          className="px-1.5 py-0.5 rounded-full shrink-0"
          style={{
            background: opinionStyle.badgeBg,
            color: opinionStyle.badgeText,
            fontSize: "10px",
            fontWeight: 500,
          }}
        >
          {opinionLabel}
        </span>
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      className="rounded-xl p-4 text-left hover:scale-[1.02] active:scale-[0.99] w-full"
      style={{
        background: "var(--card-bg)",
        border: "1px solid var(--card-border)",
        boxShadow: "var(--card-shadow)",
        transition: "all 250ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
          style={{
            background: agent.color || meta.color,
            border: "2px solid",
            borderColor: opinionStyle.border,
            transition: "border-color 600ms ease",
          }}
        >
          {initials}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-semibold text-sm" style={{ fontFamily: "var(--font-body)", color: "var(--text-primary)" }}>
              {agent.name}
            </span>
            <span className={`town-badge town-badge--${agent.town}`} style={{ fontFamily: "var(--font-display)" }}>{meta.name}</span>
          </div>
          <p style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--text-muted)" }}>
            {agent.occupation}
          </p>
        </div>
      </div>

      {/* Opinion + Confidence */}
      <div className="mt-3 flex items-center gap-2">
        <span
          className="px-2 py-0.5 rounded-full text-xs font-medium"
          style={{
            background: opinionStyle.badgeBg,
            color: opinionStyle.badgeText,
          }}
        >
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
