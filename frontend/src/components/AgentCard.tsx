import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AgentState, LeanId } from "../types/messages";
import { useScenario } from "../hooks/useScenario";
import TrustBadge from "./TrustBadge";
import SpritePortrait from "./SpritePortrait";
import { readableInk } from "../lib/color";

/** 8-digit hex alpha suffix helper: "#RRGGBB" + pct → rgba-ish hex. */
function withAlpha(hex: string, alphaHex: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? `${hex}${alphaHex}` : hex;
}

interface AgentCardProps {
  agent: AgentState;
  compact?: boolean;
  onClick?: () => void;
  /** Show the "✓ met" check icon. */
  met?: boolean;
  /** Show the gold star for persuaded agents. */
  persuaded?: boolean;
  /** When defined, render a small TrustBadge. */
  trust?: number;
}

export default function AgentCard({ agent, compact = false, onClick, met, persuaded, trust }: AgentCardProps) {
  const navigate = useNavigate();
  const { townMeta, optionColor, optionLabel, undecidedId } = useScenario();
  const meta = townMeta(agent.town);
  const candidateId = (agent.opinion?.candidate as LeanId) || undecidedId;
  const opinionLabel = optionLabel(candidateId);
  const confidence = agent.opinion?.confidence ?? 0;

  // Opinion shifts are the payoff of the deliberation — give the row a pulse
  // and a floating stance chip when this resident's candidate changes.
  const prevCandidateRef = useRef(candidateId);
  const [shiftFlash, setShiftFlash] = useState(false);
  useEffect(() => {
    if (prevCandidateRef.current === candidateId) return;
    prevCandidateRef.current = candidateId;
    setShiftFlash(true);
    const timer = window.setTimeout(() => setShiftFlash(false), 1600);
    return () => window.clearTimeout(timer);
  }, [candidateId]);
  const shiftClass = shiftFlash ? " resident-card--shift" : "";
  const shiftBurst = shiftFlash ? (
    <span
      className="stance-burst"
      aria-hidden="true"
      style={{
        color: candidateId === undecidedId
          ? "var(--text-secondary)"
          : readableInk(optionColor(candidateId), 5.5),
        background: candidateId === undecidedId
          ? "rgba(154,142,128,0.14)"
          : withAlpha(optionColor(candidateId), "22"),
      }}
    >
      → {opinionLabel}
    </span>
  ) : null;

  // Mondstadt-style opinion chrome derived from the scenario option color:
  // undecided stays a quiet warm-grey; decided options tint border + badge.
  const isUndecided = candidateId === undecidedId;
  const baseColor = optionColor(candidateId);
  const opinionStyle = isUndecided
    ? { border: "rgba(154,142,128,0.4)", badgeBg: "rgba(154,142,128,0.1)", badgeText: "var(--text-secondary)" }
    // The badge tint is darker than a white card, so leave extra contrast
    // headroom instead of targeting the bare 4.5:1 threshold against white.
    : { border: baseColor, badgeBg: withAlpha(baseColor, "1F"), badgeText: readableInk(baseColor, 5.5) };

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
        className={`resident-card resident-card--compact${shiftClass} flex items-center gap-2 px-2 py-1.5 w-full text-left`}
        style={{
          position: "relative",
          borderWidth: "0 0 1px",
          borderStyle: "solid",
          borderColor: "rgba(180,160,120,0.08)",
          borderRadius: 0,
          transition: "background 200ms ease",
          background: "transparent",
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(196,163,90,0.04)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
      >
        <SpritePortrait
          agentId={agent.id}
          spriteKey={agent.sprite_key}
          accessoryKey={agent.accessory_key}
          fallbackInitials={initials}
          color={agent.color || meta.color}
          size={28}
          ringColor={opinionStyle.border}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate flex items-center gap-1" style={{
            fontFamily: "var(--font-body)",
            fontWeight: 600,
            color: "var(--text-primary)",
            fontSize: "13px",
          }}>
            {agent.name}
            {met && <span title="You've met" style={{ color: "var(--color-success)", fontSize: 11 }}>✓</span>}
            {persuaded && <span title="Persuaded" style={{ color: "var(--gold-ink)", fontSize: 11 }}>★</span>}
          </p>
          <p className="truncate" style={{
            fontFamily: "var(--font-body)",
            fontSize: "11px",
            color: "var(--text-muted)",
          }}>
            {agent.occupation}
          </p>
        </div>
        {trust !== undefined && (
          <TrustBadge trust={trust} size="small" />
        )}
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
        {shiftBurst}
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      className={`resident-card${shiftClass} rounded-xl p-4 text-left hover:scale-[1.02] active:scale-[0.99] w-full`}
      style={{
        position: "relative",
        background: "var(--card-bg)",
        border: "1px solid var(--card-border)",
        boxShadow: "var(--card-shadow)",
        transition: "all 250ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      {shiftBurst}
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <SpritePortrait
          agentId={agent.id}
          spriteKey={agent.sprite_key}
          accessoryKey={agent.accessory_key}
          fallbackInitials={initials}
          color={agent.color || meta.color}
          size={40}
          ringColor={opinionStyle.border}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-semibold text-sm" style={{ fontFamily: "var(--font-body)", color: "var(--text-primary)" }}>
              {agent.name}
            </span>
            <span
              className={`town-badge town-badge--${agent.town}`}
              style={{
                fontFamily: "var(--font-display)",
                color: readableInk(meta.color),
                background: withAlpha(meta.color, "26"),
              }}
            >
              {meta.name}
            </span>
            {met && <span title="You've met" style={{ color: "var(--color-success)", fontSize: 12 }}>✓</span>}
            {persuaded && <span title="Persuaded" style={{ color: "var(--gold-ink)", fontSize: 12 }}>★</span>}
          </div>
          <p style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--text-muted)" }}>
            {agent.occupation}
          </p>
        </div>
        {trust !== undefined && (
          <TrustBadge trust={trust} size="small" />
        )}
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
                style={{ width: `${confidence}%`, background: opinionStyle.badgeText }}
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
          className="mt-2 truncate"
          style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--text-muted)", fontStyle: "italic" }}
        >
          {agent.current_activity}
        </p>
      )}
    </button>
  );
}
