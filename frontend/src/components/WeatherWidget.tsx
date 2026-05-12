import type { WeatherKind } from "../types/messages";

interface WeatherWidgetProps {
  weather: WeatherKind;
  compact?: boolean;
}

const WEATHER_META: Record<WeatherKind, { label: string; icon: string; color: string }> = {
  clear:  { label: "Clear",  icon: "☀", color: "#E0A040" },
  cloudy: { label: "Cloudy", icon: "☁", color: "#90A0B8" },
  rain:   { label: "Rain",   icon: "☂", color: "#5080C0" },
  snow:   { label: "Snow",   icon: "❄", color: "#A0C0E8" },
  fog:    { label: "Fog",    icon: "≋", color: "#B0B0B0" },
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
      <span style={{ fontSize: 14, lineHeight: 1 }}>{meta.icon}</span>
      {!compact && <span>{meta.label}</span>}
    </span>
  );
}
