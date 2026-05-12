import type { CSSProperties } from "react";
import { TRUST_BAND } from "../types/messages";

interface TrustBadgeProps {
  trust: number;
  size?: "small" | "medium";
  showLabel?: boolean;
}

const BAND_META: Record<
  ReturnType<typeof TRUST_BAND>,
  { label: string; color: string; icon: string }
> = {
  hostile:  { label: "Hostile",  color: "#B85050", icon: "broken" },
  guarded:  { label: "Guarded",  color: "#9A8E80", icon: "neutral" },
  warming:  { label: "Warming",  color: "#C09060", icon: "handshake" },
  friend:   { label: "Friend",   color: "#4A9B5C", icon: "heart" },
};

function Glyph({ kind, size }: { kind: string; size: number }) {
  const s = { width: size, height: size, display: "block" };
  switch (kind) {
    case "heart":
      return (
        <svg viewBox="0 0 16 16" style={s} fill="currentColor">
          <path d="M8 13.5s-5-3.2-5-7A3 3 0 0 1 8 4.5 3 3 0 0 1 13 6.5c0 3.8-5 7-5 7z" />
        </svg>
      );
    case "handshake":
      return (
        <svg viewBox="0 0 16 16" style={s} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9l3-3 2 2 2-2 3 3" />
          <path d="M4 11l3 1 2-1 3 1" />
        </svg>
      );
    case "broken":
      return (
        <svg viewBox="0 0 16 16" style={s} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M5 4l2 3-2 1 2 3" />
          <path d="M11 4L9 7l2 1-2 3" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 16 16" style={s} fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="8" cy="8" r="6" />
          <line x1="5" y1="10" x2="11" y2="10" />
        </svg>
      );
  }
}

export default function TrustBadge({ trust, size = "medium", showLabel = false }: TrustBadgeProps) {
  const band = TRUST_BAND(trust);
  const meta = BAND_META[band];
  const small = size === "small";
  const dim = small ? 12 : 16;
  const fillWidth = Math.max(0, Math.min(100, (trust + 100) / 2)); // 0..100

  const style: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: small ? 4 : 6,
    padding: small ? "2px 6px" : "3px 8px",
    borderRadius: 999,
    background: `${meta.color}1A`,
    color: meta.color,
    fontSize: small ? 10 : 11,
    fontWeight: 600,
    fontFamily: "var(--font-body)",
    lineHeight: 1,
    border: `1px solid ${meta.color}33`,
  };

  return (
    <span className={`trust-badge trust-badge--${band}`} style={style} title={`Trust: ${trust} (${meta.label})`}>
      <Glyph kind={meta.icon} size={dim} />
      {showLabel && <span>{meta.label}</span>}
      {showLabel && (
        <span
          style={{
            display: "inline-block",
            width: 26,
            height: 4,
            borderRadius: 2,
            background: `${meta.color}33`,
            overflow: "hidden",
          }}
        >
          <span
            style={{
              display: "block",
              height: "100%",
              width: `${fillWidth}%`,
              background: meta.color,
              transition: "width 400ms ease",
            }}
          />
        </span>
      )}
    </span>
  );
}
