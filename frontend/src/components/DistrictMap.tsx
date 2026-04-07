import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { useUserProfile } from "../context/UserProfileContext";
import type { TownId } from "../types/messages";
import { TOWN_META } from "../types/messages";

/* ───────────────────────────────────────────────────────────────
   NJ-11 Illustrated District Map — Genshin / Anime style
   ─────────────────────────────────────────────────────────────── */

/* ── Pin data with real geographic relative positions ────────── */

const PINS: Array<{
  id: TownId;
  cx: number;
  cy: number;
  emoji: string;
  description: string;
}> = [
  { id: "dover", cx: 260, cy: 250, emoji: "🏠", description: "Majority-Hispanic working-class heart" },
  { id: "parsippany", cx: 480, cy: 280, emoji: "🏢", description: "Largest town, Asian-American hub" },
  { id: "randolph", cx: 300, cy: 380, emoji: "🌳", description: "Affluent suburban community" },
  { id: "montclair", cx: 720, cy: 240, emoji: "🎨", description: "Progressive arts & culture center" },
];

/* ── Decorative terrain elements ─────────────────────────────── */

function Tree({ x, y, s = 1, shade = 0 }: { x: number; y: number; s?: number; shade?: number }) {
  const greens = ["#5B8C51", "#4A7A42", "#6B9E5A", "#3D6E36"];
  const fill = greens[shade % greens.length];
  return (
    <g transform={`translate(${x},${y}) scale(${s})`}>
      <ellipse cx="0" cy="2" rx="4" ry="2" fill="#2A2A2A" opacity="0.08" />
      <rect x="-1" y="-2" width="2" height="6" rx="0.5" fill="#8B7355" />
      <ellipse cx="0" cy="-8" rx="5.5" ry="8" fill={fill} />
      <ellipse cx="-1" cy="-10" rx="3" ry="4" fill="#7BB56B" opacity="0.4" />
    </g>
  );
}

function PineTree({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x},${y}) scale(${s})`}>
      <ellipse cx="0" cy="2" rx="3" ry="1.5" fill="#2A2A2A" opacity="0.06" />
      <rect x="-1" y="-1" width="2" height="5" rx="0.5" fill="#6B5B45" />
      <path d="M0,-18 L-6,-4 L-3,-5 L-7,2 L-4,0 L-8,8 L8,8 L4,0 L7,2 L3,-5 L6,-4 Z" fill="#3D6E36" />
      <path d="M0,-18 L-3,-10 L0,-11 L3,-10 Z" fill="#4A8244" opacity="0.6" />
    </g>
  );
}

function Mountain({ x, y, s = 1, variant = 0 }: { x: number; y: number; s?: number; variant?: number }) {
  const fills = ["#9B8B7A", "#A89888", "#8B7B6B"];
  const snowFills = ["#E8E4DE", "#F0ECE6", "#DDD8D0"];
  return (
    <g transform={`translate(${x},${y}) scale(${s})`}>
      <path d={variant === 0
        ? "M-28,0 L-8,-42 L0,-38 L10,-48 L30,0 Z"
        : "M-24,0 L-2,-40 L22,0 Z"}
        fill={fills[variant % 3]}
      />
      <path d={variant === 0
        ? "M-8,-42 L0,-38 L10,-48 L5,-36 L-2,-38 Z"
        : "M-2,-40 L-8,-22 L4,-26 L12,-18 Z"}
        fill={snowFills[variant % 3]}
        opacity="0.7"
      />
      {/* Misty base */}
      <ellipse cx="0" cy="0" rx="32" ry="6" fill="white" opacity="0.15" />
    </g>
  );
}

function Cloud({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x},${y}) scale(${s})`} opacity="0.25">
      <ellipse cx="0" cy="0" rx="20" ry="8" fill="white" />
      <ellipse cx="-12" cy="2" rx="12" ry="6" fill="white" />
      <ellipse cx="14" cy="1" rx="14" ry="7" fill="white" />
      <ellipse cx="4" cy="-4" rx="10" ry="6" fill="white" />
    </g>
  );
}

function House({ x, y, s = 1, roofColor = "#C8706E" }: { x: number; y: number; s?: number; roofColor?: string }) {
  return (
    <g transform={`translate(${x},${y}) scale(${s})`}>
      <rect x="-5" y="-6" width="10" height="8" rx="0.5" fill="#E8D8C4" stroke="#C4B49A" strokeWidth="0.3" />
      <path d="M-7,-6 L0,-12 L7,-6 Z" fill={roofColor} stroke="#A05A58" strokeWidth="0.3" />
      <rect x="-2" y="-3" width="2" height="2" rx="0.3" fill="#7CB5C8" opacity="0.6" />
      <rect x="1" y="-3" width="2" height="2" rx="0.3" fill="#7CB5C8" opacity="0.6" />
      <rect x="-1" y="-1" width="2" height="3" rx="0.3" fill="#8B7355" />
    </g>
  );
}

function Bridge({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x},${y}) scale(${s})`}>
      <path d="M-15,0 C-8,-6 8,-6 15,0" stroke="#A89078" strokeWidth="2" fill="none" />
      <line x1="-10" y1="-3" x2="-10" y2="2" stroke="#A89078" strokeWidth="1" />
      <line x1="0" y1="-5" x2="0" y2="2" stroke="#A89078" strokeWidth="1" />
      <line x1="10" y1="-3" x2="10" y2="2" stroke="#A89078" strokeWidth="1" />
    </g>
  );
}

/* ── Compass Rose ─────────────────────────────────────────────── */

function CompassRose({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x},${y})`} opacity="0.5">
      {/* Outer ring */}
      <circle cx="0" cy="0" r="28" fill="none" stroke="#A89078" strokeWidth="0.8" />
      <circle cx="0" cy="0" r="25" fill="none" stroke="#A89078" strokeWidth="0.4" />
      {/* Cardinal points */}
      <path d="M0,-24 L3,-8 L0,-12 L-3,-8 Z" fill="#8B7355" />
      <path d="M0,24 L3,8 L0,12 L-3,8 Z" fill="#A89078" />
      <path d="M-24,0 L-8,3 L-12,0 L-8,-3 Z" fill="#A89078" />
      <path d="M24,0 L8,3 L12,0 L8,-3 Z" fill="#A89078" />
      {/* Intercardinal */}
      <path d="M-17,-17 L-5,-5 L-7,-3 Z" fill="#C4B49A" />
      <path d="M17,-17 L5,-5 L7,-3 Z" fill="#C4B49A" />
      <path d="M-17,17 L-5,5 L-3,7 Z" fill="#C4B49A" />
      <path d="M17,17 L5,5 L3,7 Z" fill="#C4B49A" />
      {/* Center */}
      <circle cx="0" cy="0" r="3" fill="#A89078" />
      <circle cx="0" cy="0" r="1.5" fill="#E8D8C4" />
      {/* N label */}
      <text y="-30" textAnchor="middle" fontSize="8" fontWeight="700" fill="#6B5B45"
        fontFamily="'Playfair Display', Georgia, serif">N</text>
    </g>
  );
}

/* ── Town Marker (interactive) ────────────────────────────────── */

function TownMarker({
  pin,
  isHovered,
  onHover,
  onLeave,
  onClick,
}: {
  pin: typeof PINS[0];
  isHovered: boolean;
  onHover: () => void;
  onLeave: () => void;
  onClick: () => void;
}) {
  const meta = TOWN_META[pin.id];
  const glowId = `town-glow-${pin.id}`;

  return (
    <g
      onClick={onClick}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      style={{ cursor: "pointer" }}
      className="town-marker-group"
    >
      {/* Hit area */}
      <circle cx={pin.cx} cy={pin.cy} r="45" fill="transparent" />

      {/* Ambient warm glow */}
      <defs>
        <radialGradient id={glowId}>
          <stop offset="0%" stopColor={meta.color} stopOpacity={isHovered ? "0.25" : "0.12"} />
          <stop offset="60%" stopColor={meta.color} stopOpacity={isHovered ? "0.08" : "0.04"} />
          <stop offset="100%" stopColor={meta.color} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle
        cx={pin.cx} cy={pin.cy}
        r={isHovered ? 55 : 40}
        fill={`url(#${glowId})`}
        style={{ transition: "r 0.4s ease-out" }}
      />

      {/* Pulsing ring */}
      <circle
        cx={pin.cx} cy={pin.cy} r="18"
        fill="none" stroke={meta.color} strokeWidth="1.2"
        opacity={isHovered ? 0.6 : 0.2}
        style={{ transition: "opacity 0.3s ease" }}
      >
        <animate attributeName="r" values="18;24;18" dur="3s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.3;0;0.3" dur="3s" repeatCount="indefinite" />
      </circle>

      {/* Pin outer glow */}
      <circle cx={pin.cx} cy={pin.cy + 1} r="13" fill="rgba(0,0,0,0.08)" />

      {/* Pin circle — gradient fill */}
      <defs>
        <radialGradient id={`pin-grad-${pin.id}`} cx="35%" cy="35%">
          <stop offset="0%" stopColor={meta.color} stopOpacity="1" />
          <stop offset="100%" stopColor={meta.color} stopOpacity="0.7" />
        </radialGradient>
      </defs>
      <circle
        cx={pin.cx} cy={pin.cy} r={isHovered ? 14 : 12}
        fill={`url(#pin-grad-${pin.id})`}
        stroke="white" strokeWidth="2.5"
        style={{ transition: "r 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)", filter: isHovered ? "url(#townGlow)" : "none" }}
      />

      {/* Inner diamond */}
      <path
        d={`M${pin.cx},${pin.cy - 4} L${pin.cx + 3},${pin.cy} L${pin.cx},${pin.cy + 4} L${pin.cx - 3},${pin.cy} Z`}
        fill="white" opacity="0.85"
      />

      {/* Name plate */}
      <g style={{ transition: "transform 0.3s ease" }}>
        {/* Banner background */}
        <rect
          x={pin.cx - 48} y={pin.cy + 20}
          width="96" height={isHovered ? 48 : 34}
          rx="6" ry="6"
          fill="rgba(255,255,255,0.92)"
          stroke={isHovered ? meta.color : "rgba(196,180,154,0.5)"}
          strokeWidth={isHovered ? 1.2 : 0.6}
          filter="url(#labelShadow)"
          style={{ transition: "all 0.3s ease" }}
        />
        {/* Accent line at top of banner */}
        <rect
          x={pin.cx - 42} y={pin.cy + 22}
          width="84" height="2" rx="1"
          fill={meta.color} opacity={isHovered ? 0.8 : 0.3}
          style={{ transition: "opacity 0.3s ease" }}
        />

        {/* Town name */}
        <text
          x={pin.cx} y={pin.cy + 37}
          textAnchor="middle" fontSize="12" fontWeight="700"
          fill="#2C2416"
          fontFamily="'Playfair Display', Georgia, serif"
          letterSpacing="0.3"
        >
          {meta.name}
        </text>
        {/* Tagline */}
        <text
          x={pin.cx} y={pin.cy + 50}
          textAnchor="middle" fontSize="8" fontWeight="500"
          fill={meta.color}
          fontFamily="Inter, sans-serif"
          opacity={isHovered ? 1 : 0.7}
          letterSpacing="0.2"
          style={{ transition: "opacity 0.3s ease" }}
        >
          {meta.tagline}
        </text>

        {/* Population on hover */}
        {isHovered && (
          <text
            x={pin.cx} y={pin.cy + 62}
            textAnchor="middle" fontSize="7.5" fontWeight="600"
            fill="#6B5E4F"
            fontFamily="Inter, sans-serif"
            opacity="0.7"
          >
            Pop. {meta.population} · {meta.county} County
          </text>
        )}
      </g>
    </g>
  );
}

/* ── Main Component ──────────────────────────────────────────── */

export default function DistrictMap() {
  const navigate = useNavigate();
  const { isOnboarded } = useUserProfile();
  const [hovered, setHovered] = useState<TownId | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { setLoaded(true); }, []);

  const goToTown = (id: TownId) => {
    if (isOnboarded) {
      navigate(`/town/${id}`);
    } else {
      navigate(`/onboarding?town=${id}`);
    }
  };

  return (
    <div
      className="flex flex-col items-center justify-center min-h-[calc(100vh-56px)] px-4 py-6"
      style={{ opacity: loaded ? 1 : 0, transition: "opacity 0.8s ease-out" }}
    >
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="text-center mb-4 max-w-2xl" style={{ animation: "fade-in-up 0.6s ease-out" }}>
        <h1
          className="text-4xl md:text-5xl font-bold mb-2 leading-tight"
          style={{ fontFamily: "'Playfair Display', Georgia, serif", color: "var(--township-ink)" }}
        >
          Township
        </h1>
        <p className="text-sm tracking-widest uppercase mb-3" style={{ color: "var(--township-ink-muted)", letterSpacing: "0.2em" }}>
          New Jersey's 11th Congressional District
        </p>
        <p className="text-base" style={{ color: "var(--township-ink-muted)" }}>
          Click a community to meet your AI neighbors
        </p>
      </div>

      {/* ── SVG Map ────────────────────────────────────────────── */}
      <div
        className="relative w-full max-w-[960px] mx-auto"
        style={{ animation: "fade-in-up 0.8s ease-out" }}
      >
        <svg viewBox="0 0 1000 620" className="w-full h-auto" style={{ overflow: "visible" }}>
          <defs>
            {/* Paper texture filter */}
            <filter id="paperTexture" x="-5%" y="-5%" width="110%" height="110%">
              <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="4" seed="3" result="noise" />
              <feColorMatrix type="saturate" values="0" in="noise" result="grayNoise" />
              <feBlend mode="multiply" in="SourceGraphic" in2="grayNoise" result="textured" />
              <feComponentTransfer in="textured">
                <feFuncA type="linear" slope="1" />
              </feComponentTransfer>
            </filter>

            {/* Watercolor edge softening */}
            <filter id="watercolor" x="-2%" y="-2%" width="104%" height="104%">
              <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="3" seed="7" result="warp" />
              <feDisplacementMap in="SourceGraphic" in2="warp" scale="3" xChannelSelector="R" yChannelSelector="G" />
            </filter>

            {/* Town glow filter */}
            <filter id="townGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            {/* Label shadow */}
            <filter id="labelShadow" x="-10%" y="-10%" width="120%" height="140%">
              <feDropShadow dx="0" dy="1.5" stdDeviation="3" floodOpacity="0.1" />
            </filter>

            {/* Terrain gradients */}
            <linearGradient id="terrainBase" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#D8CFB4" />
              <stop offset="40%" stopColor="#C8D4A8" />
              <stop offset="100%" stopColor="#B8C8A0" />
            </linearGradient>

            <linearGradient id="highlands" x1="0%" y1="100%" x2="0%" y2="0%">
              <stop offset="0%" stopColor="#B8C4A0" />
              <stop offset="100%" stopColor="#A0AC88" />
            </linearGradient>

            <linearGradient id="piedmont" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#C8D8B0" />
              <stop offset="100%" stopColor="#D0DDB8" />
            </linearGradient>

            <linearGradient id="waterGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#7CB5C8" stopOpacity="0.6" />
              <stop offset="50%" stopColor="#6AAFC4" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#7CB5C8" stopOpacity="0.5" />
            </linearGradient>

            <radialGradient id="vignetteGrad" cx="50%" cy="50%" r="55%">
              <stop offset="0%" stopColor="transparent" />
              <stop offset="85%" stopColor="transparent" />
              <stop offset="100%" stopColor="rgba(44,36,22,0.06)" />
            </radialGradient>

            {/* Road pattern */}
            <pattern id="roadDash" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(0)">
              <line x1="0" y1="4" x2="5" y2="4" stroke="#B8A888" strokeWidth="1.5" strokeLinecap="round" />
            </pattern>

            {/* Grass pattern for fields */}
            <pattern id="grassPattern" patternUnits="userSpaceOnUse" width="12" height="12">
              <line x1="3" y1="10" x2="3" y2="6" stroke="#7BA868" strokeWidth="0.5" opacity="0.3" />
              <line x1="7" y1="11" x2="8" y2="7" stroke="#6B9858" strokeWidth="0.5" opacity="0.25" />
              <line x1="10" y1="10" x2="10" y2="7" stroke="#7BA868" strokeWidth="0.5" opacity="0.2" />
            </pattern>
          </defs>

          {/* ─── Layer 0: Parchment Background ─────────────── */}
          <rect x="30" y="20" width="940" height="580" rx="12" ry="12"
            fill="#EDE7DA" filter="url(#paperTexture)" />

          {/* ─── Layer 1: Ornamental Border ────────────────── */}
          <rect x="30" y="20" width="940" height="580" rx="12" ry="12"
            fill="none" stroke="#C4B49A" strokeWidth="1.5" />
          <rect x="36" y="26" width="928" height="568" rx="9" ry="9"
            fill="none" stroke="#C4B49A" strokeWidth="0.5" opacity="0.5" />
          {/* Corner embellishments */}
          {[[44, 34], [958, 34], [44, 586], [958, 586]].map(([cx, cy], i) => (
            <g key={i} transform={`translate(${cx},${cy})`}>
              <circle r="3" fill="#C4B49A" opacity="0.4" />
              <circle r="1.5" fill="#A89078" opacity="0.5" />
            </g>
          ))}

          {/* ─── Layer 2: District Terrain Base ────────────── */}
          {/* Accurate NJ-11 shape — spans Morris (west), Essex (east), bit of Passaic (north) */}
          <path
            d={`
              M 140,160
              C 160,130 210,95 280,80
              C 340,68 400,65 460,62
              C 530,58 590,60 640,68
              C 690,76 730,90 770,110
              C 810,130 840,160 860,200
              C 875,235 880,270 870,310
              C 862,345 840,375 810,400
              C 780,425 740,445 700,458
              C 660,468 620,472 580,475
              C 530,478 480,480 440,478
              C 390,475 340,468 300,455
              C 260,442 220,420 190,390
              C 162,358 145,320 138,280
              C 130,240 130,200 140,160
              Z
            `}
            fill="url(#terrainBase)"
            filter="url(#watercolor)"
            stroke="#A89888"
            strokeWidth="1"
            opacity="0.95"
          />

          {/* Highlands tint (western portion) */}
          <path
            d={`
              M 140,160
              C 160,130 210,95 280,80
              C 340,68 380,65 420,64
              L 400,200 L 380,320 L 350,400
              C 300,455 260,442 220,420
              C 190,390 162,358 145,320
              C 138,280 130,240 130,200
              C 130,200 140,160 140,160 Z
            `}
            fill="url(#highlands)" opacity="0.35"
          />

          {/* Piedmont tint (eastern portion) */}
          <path
            d={`
              M 640,68
              C 690,76 730,90 770,110
              C 810,130 840,160 860,200
              C 875,235 880,270 870,310
              C 862,345 840,375 810,400
              C 780,425 740,445 700,458
              C 660,468 640,470 620,472
              L 600,350 L 590,250 L 600,160
              Z
            `}
            fill="url(#piedmont)" opacity="0.3"
          />

          {/* Subtle grass texture overlay */}
          <path
            d={`
              M 140,160 C 160,130 210,95 280,80 C 340,68 400,65 460,62
              C 530,58 590,60 640,68 C 690,76 730,90 770,110 C 810,130 840,160 860,200
              C 875,235 880,270 870,310 C 862,345 840,375 810,400 C 780,425 740,445 700,458
              C 660,468 620,472 580,475 C 530,478 480,480 440,478 C 390,475 340,468 300,455
              C 260,442 220,420 190,390 C 162,358 145,320 138,280 C 130,240 130,200 140,160 Z
            `}
            fill="url(#grassPattern)" opacity="0.4"
          />

          {/* ─── Layer 3: Terrain Features ─────────────────── */}

          {/* Western Highlands — mountains */}
          <Mountain x={160} y={200} s={0.9} variant={0} />
          <Mountain x={200} y={175} s={1.1} variant={1} />
          <Mountain x={175} y={240} s={0.7} variant={2} />
          <Mountain x={220} y={160} s={0.6} variant={0} />

          {/* Rolling hills (soft ellipses for gentle terrain) */}
          {[
            [350, 350, 50, 12, "#A8B890"], [520, 380, 40, 10, "#B0C098"],
            [650, 350, 45, 11, "#A0B888"], [400, 420, 35, 9, "#B0C098"],
            [750, 320, 38, 10, "#A8B890"],
          ].map(([cx, cy, rx, ry, fill], i) => (
            <ellipse key={`hill-${i}`} cx={cx as number} cy={cy as number}
              rx={rx as number} ry={ry as number} fill={fill as string} opacity="0.3" />
          ))}

          {/* Forest clusters — Western Morris (near Dover & Randolph) */}
          <Tree x={200} y={300} s={0.9} shade={0} />
          <PineTree x={215} y={295} s={0.8} />
          <Tree x={230} y={305} s={1.0} shade={1} />
          <PineTree x={195} y={315} s={0.7} />
          <Tree x={245} y={310} s={0.85} shade={2} />

          {/* Forest cluster — Central Morris */}
          <Tree x={380} y={330} s={0.8} shade={0} />
          <PineTree x={395} y={325} s={0.9} />
          <Tree x={410} y={335} s={0.75} shade={1} />
          <PineTree x={370} y={340} s={0.65} />

          {/* Forest cluster — Near Randolph */}
          <Tree x={270} y={420} s={0.7} shade={2} />
          <PineTree x={285} y={415} s={0.8} />
          <Tree x={255} y={425} s={0.6} shade={0} />

          {/* Forest cluster — Eastern (near Montclair) */}
          <Tree x={680} y={300} s={0.7} shade={1} />
          <Tree x={695} y={295} s={0.8} shade={2} />
          <PineTree x={710} y={305} s={0.7} />

          {/* Scattered individual trees */}
          <Tree x={350} y={200} s={0.6} shade={0} />
          <PineTree x={550} y={330} s={0.6} />
          <Tree x={600} y={280} s={0.55} shade={1} />
          <Tree x={470} y={400} s={0.5} shade={2} />
          <PineTree x={320} y={260} s={0.55} />
          <Tree x={760} y={270} s={0.5} shade={0} />
          <Tree x={530} y={220} s={0.55} shade={1} />

          {/* Small houses scattered across the district */}
          <House x={340} y={240} s={0.7} roofColor="#C8706E" />
          <House x={430} y={350} s={0.6} roofColor="#B08060" />
          <House x={560} y={310} s={0.55} roofColor="#C8706E" />
          <House x={650} y={270} s={0.6} roofColor="#A07858" />
          <House x={500} y={170} s={0.5} roofColor="#B08060" />

          {/* ─── Layer 4: Water Features ───────────────────── */}

          {/* Rockaway River (flows through Dover area) */}
          <path
            d="M 185,145 C 200,170 230,200 250,230 C 265,255 275,275 295,300 C 310,320 330,340 355,355"
            fill="none" stroke="url(#waterGrad)" strokeWidth="3.5" strokeLinecap="round"
            opacity="0.7" filter="url(#watercolor)"
          />
          {/* River shimmer dots */}
          {[
            [210, 180], [240, 220], [270, 265], [300, 310], [335, 345]
          ].map(([cx, cy], i) => (
            <circle key={`shimmer-${i}`} cx={cx} cy={cy} r="1" fill="white" opacity="0.4">
              <animate attributeName="opacity" values="0.2;0.6;0.2" dur={`${2 + i * 0.3}s`} repeatCount="indefinite" />
            </circle>
          ))}

          {/* Passaic River (southeastern area) */}
          <path
            d="M 620,180 C 640,210 660,250 670,280 C 678,305 680,330 675,360"
            fill="none" stroke="url(#waterGrad)" strokeWidth="3" strokeLinecap="round"
            opacity="0.6" filter="url(#watercolor)"
          />

          <Bridge x={255} y={240} s={0.7} />

          {/* ─── Layer 5: Roads ────────────────────────────── */}

          {/* Interstate 80 — major E-W corridor */}
          <path
            d="M 155,220 C 250,215 400,230 500,240 C 600,250 700,220 850,215"
            fill="none" stroke="#C4AE8C" strokeWidth="2.5" strokeLinecap="round"
            opacity="0.45" strokeDasharray="8 4"
          />
          {/* I-80 label */}
          <rect x="490" y="222" width="28" height="12" rx="3" fill="rgba(180,160,130,0.6)" />
          <text x="504" y="231" textAnchor="middle" fontSize="7" fontWeight="700"
            fill="#6B5B45" fontFamily="Inter, sans-serif">I-80</text>

          {/* Route 46 */}
          <path
            d="M 300,270 C 400,275 500,280 620,265"
            fill="none" stroke="#C4AE8C" strokeWidth="1.5" strokeLinecap="round"
            opacity="0.3" strokeDasharray="5 3"
          />

          {/* ─── Layer 6: County Boundary ──────────────────── */}
          <path
            d="M 590,70 C 585,140 580,220 575,300 C 572,360 570,420 565,475"
            fill="none" stroke="#A89888" strokeWidth="0.8"
            strokeDasharray="3 3" opacity="0.4"
          />

          {/* County labels */}
          <text x="370" y={110} textAnchor="middle" fontSize="10" fontWeight="600"
            fill="#A89888" fontFamily="Inter, sans-serif" letterSpacing="0.2em" opacity="0.6">
            MORRIS COUNTY
          </text>
          <text x="720" y={160} textAnchor="middle" fontSize="10" fontWeight="600"
            fill="#A89888" fontFamily="Inter, sans-serif" letterSpacing="0.2em" opacity="0.6">
            ESSEX COUNTY
          </text>

          {/* ─── Layer 7: Clouds (atmospheric) ─────────────── */}
          <Cloud x={160} y={90} s={0.8} />
          <Cloud x={500} y={50} s={1.0} />
          <Cloud x={820} y={100} s={0.7} />
          <Cloud x={380} y={500} s={0.6} />
          <Cloud x={750} y={480} s={0.5} />

          {/* ─── Layer 8: Town Markers (interactive) ───────── */}
          {PINS.map((pin) => (
            <TownMarker
              key={pin.id}
              pin={pin}
              isHovered={hovered === pin.id}
              onHover={() => setHovered(pin.id)}
              onLeave={() => setHovered(null)}
              onClick={() => goToTown(pin.id)}
            />
          ))}

          {/* ─── Layer 9: Compass Rose ─────────────────────── */}
          <CompassRose x={900} y={530} />

          {/* ─── Layer 10: Vignette overlay ─────────────────── */}
          <rect x="30" y="20" width="940" height="580" rx="12" fill="url(#vignetteGrad)" pointerEvents="none" />

          {/* ─── Title cartouche (top-left corner) ─────────── */}
          <g transform="translate(65, 48)">
            <rect x="-10" y="-8" width="150" height="38" rx="5" fill="rgba(237,231,218,0.9)"
              stroke="#C4B49A" strokeWidth="0.5" />
            <text x="0" y="6" fontSize="10" fontWeight="700" fill="#6B5B45"
              fontFamily="'Playfair Display', Georgia, serif" letterSpacing="0.5">
              NJ-11 District
            </text>
            <text x="0" y="20" fontSize="7" fill="#A89078" fontFamily="Inter, sans-serif" letterSpacing="0.3">
              26 AI Residents · 4 Towns
            </text>
          </g>

          {/* ─── Decorative birds ───────────────────────────── */}
          <g opacity="0.2">
            <path d="M420,95 Q425,88 430,93 Q435,88 440,95" fill="none" stroke="#6B5B45" strokeWidth="0.8">
              <animateMotion dur="20s" repeatCount="indefinite" path="M0,0 C50,-10 100,5 150,-5 C200,-15 250,0 300,-10 L350,0" />
            </path>
            <path d="M415,100 Q418,95 421,99 Q424,95 427,100" fill="none" stroke="#6B5B45" strokeWidth="0.6">
              <animateMotion dur="22s" repeatCount="indefinite" path="M0,0 C40,-8 80,3 120,-3 C160,-10 200,5 280,-8 L320,0" />
            </path>
          </g>
        </svg>
      </div>

      {/* ── Election Info Banner ──────────────────────────────── */}
      <div
        className="mt-6 max-w-2xl w-full rounded-xl px-6 py-4 text-center"
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
          Early voting happening now (April 6 – 14). 26 AI residents across 4 towns are deliberating.
        </p>
      </div>

      {/* ── Town Cards ───────────────────────────────────────── */}
      <div
        className="mt-6 district-town-cards max-w-3xl w-full"
        style={{ animation: "fade-in-up 1.1s ease-out" }}
      >
        {(["montclair", "parsippany", "dover", "randolph"] as TownId[]).map((id) => {
          const meta = TOWN_META[id];
          const isActive = hovered === id;
          return (
            <button
              key={id}
              onClick={() => goToTown(id)}
              className="rounded-xl px-4 py-3 text-left transition-all hover:scale-[1.03] active:scale-[0.98]"
              style={{
                background: isActive
                  ? `linear-gradient(135deg, rgba(${hexToRgb(meta.color)},0.08), var(--card-bg))`
                  : "var(--card-bg)",
                border: `1.5px solid ${isActive ? meta.color : "var(--card-border)"}`,
                boxShadow: isActive
                  ? `0 4px 16px rgba(${hexToRgb(meta.color)},0.15)`
                  : "var(--card-shadow)",
                transition: "all 0.3s ease",
              }}
              onMouseEnter={() => setHovered(id)}
              onMouseLeave={() => setHovered(null)}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="w-3 h-3 rounded-full"
                  style={{
                    background: meta.color,
                    boxShadow: isActive ? `0 0 8px ${meta.color}` : "none",
                    transition: "box-shadow 0.3s ease",
                  }}
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

/* ── Helpers ──────────────────────────────────────────────────── */

function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  return `${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)}`;
}
