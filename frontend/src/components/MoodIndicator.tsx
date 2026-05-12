interface MoodIndicatorProps {
  mood?: "positive" | "negative" | "neutral";
  size?: number;
}

const MOOD_META = {
  positive: { color: "#4A9B5C", label: "Positive" },
  negative: { color: "#B85050", label: "Negative" },
  neutral:  { color: "#9A8E80", label: "Neutral"  },
} as const;

export default function MoodIndicator({ mood = "neutral", size = 18 }: MoodIndicatorProps) {
  const meta = MOOD_META[mood];

  // Eye + mouth based on mood
  const mouth =
    mood === "positive"
      ? "M6 11 Q9 14 12 11"
      : mood === "negative"
        ? "M6 12 Q9 9 12 12"
        : "M6 12 L12 12";

  return (
    <span
      className={`mood-indicator mood-indicator--${mood}`}
      title={`Mood: ${meta.label}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: `${meta.color}1A`,
        border: `1px solid ${meta.color}33`,
        color: meta.color,
        width: size + 6,
        height: size + 6,
        borderRadius: "50%",
        transition: "background 400ms ease",
      }}
    >
      <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="9" r="7.5" />
        <circle cx="6.5" cy="7.5" r="0.6" fill="currentColor" />
        <circle cx="11.5" cy="7.5" r="0.6" fill="currentColor" />
        <path d={mouth} />
      </svg>
    </span>
  );
}
