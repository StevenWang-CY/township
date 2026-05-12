import type { ReactNode } from "react";
import type { WeatherKind } from "../types/messages";

interface WeatherWidgetProps {
  weather: WeatherKind;
  compact?: boolean;
}

/* ── Inline SVG weather icons (replaces emoji glyphs for visual consistency) ── */

function SunGlyph({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
      <circle cx="8" cy="8" r="3" fill={color} fillOpacity="0.25" />
      <line x1="8" y1="1.5" x2="8" y2="3" />
      <line x1="8" y1="13" x2="8" y2="14.5" />
      <line x1="1.5" y1="8" x2="3" y2="8" />
      <line x1="13" y1="8" x2="14.5" y2="8" />
      <line x1="3.3" y1="3.3" x2="4.4" y2="4.4" />
      <line x1="11.6" y1="11.6" x2="12.7" y2="12.7" />
      <line x1="3.3" y1="12.7" x2="4.4" y2="11.6" />
      <line x1="11.6" y1="4.4" x2="12.7" y2="3.3" />
    </svg>
  );
}

function CloudGlyph({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.5 12a3 3 0 0 1 0-6 4 4 0 0 1 7.7-1A3 3 0 0 1 11.5 12H4.5z" fill={color} fillOpacity="0.15" />
    </svg>
  );
}

function RainGlyph({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
      <path d="M4.5 9a3 3 0 0 1 0-6 4 4 0 0 1 7.7-1A3 3 0 0 1 11.5 9H4.5z" fill={color} fillOpacity="0.15" />
      <line x1="5.5" y1="11" x2="4.5" y2="13.5" />
      <line x1="8" y1="11" x2="7" y2="13.5" />
      <line x1="10.5" y1="11" x2="9.5" y2="13.5" />
    </svg>
  );
}

function SnowGlyph({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
      <line x1="8" y1="2" x2="8" y2="14" />
      <line x1="2" y1="8" x2="14" y2="8" />
      <line x1="3.5" y1="3.5" x2="12.5" y2="12.5" />
      <line x1="12.5" y1="3.5" x2="3.5" y2="12.5" />
    </svg>
  );
}

function FogGlyph({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
      <line x1="2" y1="5" x2="14" y2="5" />
      <line x1="2" y1="8" x2="14" y2="8" />
      <line x1="2" y1="11" x2="14" y2="11" />
    </svg>
  );
}

const WEATHER_META: Record<WeatherKind, { label: string; color: string; icon: (color: string) => ReactNode }> = {
  clear:  { label: "Clear",  color: "#E0A040", icon: (c) => <SunGlyph color={c} /> },
  cloudy: { label: "Cloudy", color: "#90A0B8", icon: (c) => <CloudGlyph color={c} /> },
  rain:   { label: "Rain",   color: "#5080C0", icon: (c) => <RainGlyph color={c} /> },
  snow:   { label: "Snow",   color: "#A0C0E8", icon: (c) => <SnowGlyph color={c} /> },
  fog:    { label: "Fog",    color: "#B0B0B0", icon: (c) => <FogGlyph color={c} /> },
};

export default function WeatherWidget({ weather, compact = false }: WeatherWidgetProps) {
  const meta = WEATHER_META[weather] ?? WEATHER_META.clear;
  return (
    <span
      className={`weather-widget weather-widget--${weather}`}
      title={`Weather: ${meta.label}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: compact ? "3px 8px" : "4px 10px",
        background: `${meta.color}1A`,
        border: `1px solid ${meta.color}33`,
        borderRadius: 999,
        color: meta.color,
        fontSize: 11,
        fontWeight: 600,
        fontFamily: "var(--font-body)",
      }}
    >
      <span style={{ display: "inline-flex", lineHeight: 1 }}>{meta.icon(meta.color)}</span>
      {!compact && <span>{meta.label}</span>}
    </span>
  );
}
