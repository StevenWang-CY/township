import { useNavigate } from "react-router-dom";
import { useState } from "react";
import type { TownId } from "../types/messages";
import { TOWN_META } from "../types/messages";

/* ── Pin Positions (relative SVG coords on the district outline) ── */

const PINS: Array<{
  id: TownId;
  cx: number;
  cy: number;
  description: string;
}> = [
  {
    id: "montclair",
    cx: 680,
    cy: 200,
    description: "Progressive arts hub, racially diverse. Essex County.",
  },
  {
    id: "parsippany",
    cx: 440,
    cy: 280,
    description: "Largest town, dramatically Asian-American. Corporate hub.",
  },
  {
    id: "dover",
    cx: 280,
    cy: 380,
    description: "Majority-Hispanic working-class heart. 51% foreign-born.",
  },
  {
    id: "randolph",
    cx: 460,
    cy: 440,
    description: "Affluent GOP suburb. Hathaway's home base.",
  },
];

export default function DistrictMap() {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState<TownId | null>(null);

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-56px)] px-4 py-8">
      {/* Header */}
      <div className="text-center mb-8 max-w-2xl" style={{ animation: "fade-in-up 0.6s ease-out" }}>
        <h1
          className="text-4xl md:text-5xl font-bold mb-3 leading-tight"
          style={{ fontFamily: "Playfair Display, Georgia, serif", color: "var(--township-ink)" }}
        >
          Where are you from?
        </h1>
        <p className="text-lg" style={{ color: "var(--township-ink-muted)" }}>
          Click the community closest to yours and meet your AI neighbors.
        </p>
      </div>

      {/* SVG District Map */}
      <div
        className="relative w-full max-w-[900px] mx-auto"
        style={{ animation: "fade-in-up 0.8s ease-out" }}
      >
        <svg viewBox="0 0 900 600" className="w-full h-auto">
          {/* District outline — stylized NJ-11 shape (Essex + Morris + bit of Passaic) */}
          <defs>
            <linearGradient id="districtGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#F5F0E8" />
              <stop offset="100%" stopColor="#E8E0D4" />
            </linearGradient>
            <filter id="districtShadow">
              <feDropShadow dx="0" dy="4" stdDeviation="8" floodOpacity="0.1" />
            </filter>
            <filter id="glow">
              <feGaussianBlur stdDeviation="6" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* District shape */}
          <path
            d="M 150,100 C 200,60 350,40 500,50 C 600,55 720,80 780,140 C 830,190 840,260 810,320 C 790,360 760,400 700,440 C 640,480 580,510 500,530 C 420,540 340,530 270,500 C 200,470 150,420 130,360 C 110,300 100,220 120,160 Z"
            fill="url(#districtGrad)"
            stroke="#C4B5A0"
            strokeWidth="2"
            filter="url(#districtShadow)"
          />

          {/* County labels */}
          <text x="620" y="130" fontSize="12" fill="#A09080" fontFamily="Inter, sans-serif" fontWeight="500" letterSpacing="0.1em">
            ESSEX COUNTY
          </text>
          <text x="280" y="180" fontSize="12" fill="#A09080" fontFamily="Inter, sans-serif" fontWeight="500" letterSpacing="0.1em">
            MORRIS COUNTY
          </text>

          {/* County dividing line */}
          <line x1="580" y1="100" x2="560" y2="500" stroke="#C4B5A0" strokeWidth="1" strokeDasharray="4 4" opacity="0.5" />

          {/* Town pins */}
          {PINS.map((pin) => {
            const meta = TOWN_META[pin.id];
            const isHovered = hovered === pin.id;

            return (
              <g
                key={pin.id}
                className="district-map-pin"
                onClick={() => navigate(`/town/${pin.id}`)}
                onMouseEnter={() => setHovered(pin.id)}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: "pointer" }}
              >
                {/* Invisible hit area for touch devices */}
                <circle cx={pin.cx} cy={pin.cy} r="32" fill="transparent" className="district-map-pin-hit-area" />

                {/* Ripple ring */}
                <circle cx={pin.cx} cy={pin.cy} r="18" fill="none" stroke={meta.color} strokeWidth="1.5" opacity="0.3" className="pin-ripple" />

                {/* Pin shadow */}
                <circle cx={pin.cx + 1} cy={pin.cy + 2} r="14" fill="rgba(0,0,0,0.1)" />

                {/* Pin circle */}
                <circle cx={pin.cx} cy={pin.cy} r="14" fill={meta.color} stroke="#fff" strokeWidth="2.5">
                  {isHovered && (
                    <animate attributeName="r" values="14;17;14" dur="0.6s" repeatCount="indefinite" />
                  )}
                </circle>

                {/* Pin inner dot */}
                <circle cx={pin.cx} cy={pin.cy} r="4" fill="#fff" opacity="0.8" />

                {/* Always-visible label */}
                <text
                  x={pin.cx}
                  y={pin.cy + 30}
                  textAnchor="middle"
                  fontSize="13"
                  fontWeight="600"
                  fill="var(--township-ink)"
                  fontFamily="Inter, sans-serif"
                >
                  {meta.name}
                </text>
                <text
                  x={pin.cx}
                  y={pin.cy + 44}
                  textAnchor="middle"
                  fontSize="10"
                  fill={meta.color}
                  fontFamily="Inter, sans-serif"
                  fontWeight="500"
                >
                  {meta.tagline}
                </text>

                {/* Hover details */}
                {isHovered && (
                  <g style={{ animation: "fade-in-up 0.2s ease-out" }}>
                    <rect
                      x={pin.cx - 120}
                      y={pin.cy - 90}
                      width="240"
                      height="55"
                      rx="8"
                      fill="white"
                      stroke={meta.color}
                      strokeWidth="1.5"
                      opacity="0.97"
                    />
                    <text
                      x={pin.cx}
                      y={pin.cy - 68}
                      textAnchor="middle"
                      fontSize="11"
                      fill="var(--township-ink-muted)"
                      fontFamily="Inter, sans-serif"
                    >
                      {pin.description}
                    </text>
                    <text
                      x={pin.cx}
                      y={pin.cy - 50}
                      textAnchor="middle"
                      fontSize="11"
                      fontWeight="600"
                      fill={meta.color}
                      fontFamily="Inter, sans-serif"
                    >
                      Pop. {meta.population} | {meta.county} County
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Election info banner */}
      <div
        className="mt-8 max-w-2xl w-full rounded-xl px-6 py-4 text-center"
        style={{
          background: "linear-gradient(135deg, rgba(59,89,152,0.06), rgba(59,89,152,0.02))",
          border: "1px solid rgba(59,89,152,0.12)",
          animation: "fade-in-up 1s ease-out",
        }}
      >
        <p className="text-sm font-semibold" style={{ color: "var(--civic-blue)" }}>
          NJ-11 Special Election — April 16, 2026
        </p>
        <p className="text-xs mt-1" style={{ color: "var(--township-ink-muted)" }}>
          Early voting happening now (April 6 - 14). 26 AI residents across 4 towns are deliberating.
        </p>
      </div>

      {/* Town cards below map for quick access */}
      <div
        className="mt-8 district-town-cards max-w-3xl w-full"
        style={{ animation: "fade-in-up 1.1s ease-out" }}
      >
        {(["montclair", "parsippany", "dover", "randolph"] as TownId[]).map((id) => {
          const meta = TOWN_META[id];
          return (
            <button
              key={id}
              onClick={() => navigate(`/town/${id}`)}
              className="rounded-xl px-4 py-3 text-left transition-all hover:scale-[1.03] active:scale-[0.98]"
              style={{
                background: "var(--card-bg)",
                border: `1.5px solid ${hovered === id ? meta.color : "var(--card-border)"}`,
                boxShadow: "var(--card-shadow)",
              }}
              onMouseEnter={() => setHovered(id)}
              onMouseLeave={() => setHovered(null)}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ background: meta.color }}
                />
                <span className="font-semibold text-sm" style={{ color: "var(--township-ink)" }}>
                  {meta.name}
                </span>
              </div>
              <p className="text-xs" style={{ color: "var(--township-ink-muted)" }}>
                {meta.tagline}
              </p>
              <p className="text-xs mt-1 font-medium" style={{ color: meta.color }}>
                {meta.population}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
