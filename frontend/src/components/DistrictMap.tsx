import { useNavigate } from "react-router-dom";
import { useState, useEffect, useMemo, useRef } from "react";
import { useUserProfile } from "../context/UserProfileContext";
import { useWebSocketContext } from "../context/WebSocketContext";
import { useScenario } from "../hooks/useScenario";
import type { ResolvedTownMeta, ScenarioContextValue } from "../hooks/useScenario";
import type { TownId, LeanId, AgentState } from "../types/messages";
import { appUrl } from "../lib/assetUrl";
import SpritePortrait from "./SpritePortrait";
import { rosterAgentsFromPayload } from "./residentRoster";
import { DEMO_MODE } from "../demo/demoMode";

/** Compute leading (non-undecided) option per town from agent states. */
function leadingOptionPerTown(
  agents: AgentState[],
  townIds: TownId[],
  undecidedId: string,
): Record<TownId, LeanId | null> {
  const counts: Record<TownId, Record<LeanId, number>> = {};
  for (const t of townIds) counts[t] = {};
  for (const a of agents) {
    const lean = (a.opinion?.candidate as LeanId) || undecidedId;
    if (counts[a.town]) counts[a.town][lean] = (counts[a.town][lean] || 0) + 1;
  }
  const out: Record<TownId, LeanId | null> = {};
  for (const t of townIds) {
    let best: LeanId | null = null;
    let bestN = 0;
    for (const k of Object.keys(counts[t])) {
      if (k === undecidedId) continue;
      if (counts[t][k] > bestN) {
        best = k;
        bestN = counts[t][k];
      }
    }
    out[t] = best;
  }
  return out;
}

function motionIsReduced(): boolean {
  if (typeof window === "undefined") return false;
  return (
    document.documentElement.hasAttribute("data-reduced-motion") ||
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

function withAlpha(color: string, alphaHex: string, fallback: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}${alphaHex}` : fallback;
}

/* ───────────────────────────────────────────────────────────────
   Illustrated District Map — Genshin / Anime style atlas page.

   The flagship NJ-11 scenario keeps its hand-drawn map (pins, rivers,
   county labels) exactly as designed. Any other scenario gets a GENERIC
   atlas page in the same visual language: parchment, watercolor terrain,
   compass, clouds — with a seeded, pleasing waypoint layout derived from
   the scenario's town roster.
   ─────────────────────────────────────────────────────────────── */

interface Pin {
  id: TownId;
  cx: number;
  cy: number;
  description: string;
}

// Coordinate-only presentation adapter for the illustrated flagship atlas.
// Names, descriptions, colors, dates, and resident counts still come from
// the active scenario package and transport roster.
const NJ11_PIN_LAYOUT: Record<string, { cx: number; cy: number }> = {
  dover: { cx: 250, cy: 240 },
  parsippany: { cx: 490, cy: 300 },
  randolph: { cx: 340, cy: 410 },
  montclair: { cx: 730, cy: 230 },
};

/* ── Seeded layout helpers (generic scenarios) ───────────────── */

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a: number): () => number {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Seeded waypoint layout for a scenario's towns:
 * - 1 town  → centered hero waypoint;
 * - 2 towns → facing each other across a river;
 * - N towns → a gentle arc across the parchment, organic jitter.
 */
function genericPins(
  towns: Array<{ id: string; tagline?: string }>,
  seedKey: string,
): Pin[] {
  const rng = mulberry32(hashString(seedKey));
  const n = towns.length;
  if (n === 0) return [];
  if (n === 1) {
    return [{ id: towns[0].id, cx: 500, cy: 290, description: towns[0].tagline ?? "" }];
  }
  if (n === 2) {
    // Two communities across the river — the bridge between them is the story.
    const j = () => (rng() - 0.5) * 30;
    return [
      { id: towns[0].id, cx: 330 + j(), cy: 265 + j(), description: towns[0].tagline ?? "" },
      { id: towns[1].id, cx: 665 + j(), cy: 295 + j(), description: towns[1].tagline ?? "" },
    ];
  }
  // Gentle arc, west to east, cresting mid-map.
  return towns.map((t, i) => {
    const f = i / (n - 1);
    const cx = 220 + f * 560 + (rng() - 0.5) * 36;
    const cy = 340 - Math.sin(f * Math.PI) * 130 + (rng() - 0.5) * 44;
    return { id: t.id, cx, cy, description: t.tagline ?? "" };
  });
}

type Pt = [number, number];

/** Evaluate a cubic bezier at t. */
function cubicAt(p0: Pt, c1: Pt, c2: Pt, p1: Pt, t: number): Pt {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0],
    u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1],
  ];
}

/** Seeded scatter positions that keep clear of the waypoints. */
function scatterPoints(
  rng: () => number,
  count: number,
  pins: Pin[],
  minDist = 78,
): Array<{ x: number; y: number; r: number }> {
  const out: Array<{ x: number; y: number; r: number }> = [];
  let guard = 0;
  while (out.length < count && guard < count * 30) {
    guard++;
    const x = 170 + rng() * 660;
    const y = 100 + rng() * 370;
    if (pins.some((p) => Math.hypot(p.cx - x, p.cy - y + 40) < minDist)) continue;
    out.push({ x, y, r: rng() });
  }
  return out;
}

/* ── Decorative terrain elements ─────────────────────────────── */

function Tree({ x, y, s = 1, shade = 0 }: { x: number; y: number; s?: number; shade?: number }) {
  const greens = ["#5F9A4E", "#4E8A3F", "#72AD5B", "#408A30"];
  const fill = greens[shade % greens.length];
  return (
    <g transform={`translate(${x},${y}) scale(${s})`}>
      <ellipse cx="0" cy="3" rx="4" ry="2" fill="#2A2A2A" opacity="0.1" />
      <rect x="-1.2" y="-2" width="2.4" height="6" rx="0.8" fill="#7A6245" />
      <ellipse cx="0" cy="-9" rx="6" ry="9" fill={fill} />
      <ellipse cx="-1.5" cy="-12" rx="3.5" ry="4.5" fill="#8FCC70" opacity="0.45" />
    </g>
  );
}

function PineTree({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x},${y}) scale(${s})`}>
      <ellipse cx="0" cy="3" rx="3" ry="1.5" fill="#2A2A2A" opacity="0.08" />
      <rect x="-1" y="-1" width="2" height="5" rx="0.5" fill="#6B5B45" />
      <path d="M0,-20 L-7,-4 L-3.5,-6 L-8,3 L-4.5,0 L-9,9 L9,9 L4.5,0 L8,3 L3.5,-6 L7,-4 Z" fill="#3A7A30" />
      <path d="M0,-20 L-3.5,-11 L0,-13 L3.5,-11 Z" fill="#4FA040" opacity="0.5" />
    </g>
  );
}

function Mountain({ x, y, s = 1, variant = 0 }: { x: number; y: number; s?: number; variant?: number }) {
  const fills = ["#8A7A6A", "#988878", "#7B6B5B"];
  const snowFills = ["#F0ECE6", "#F5F1EB", "#E8E2DA"];
  return (
    <g transform={`translate(${x},${y}) scale(${s})`}>
      {/* Base shadow */}
      <ellipse cx="2" cy="4" rx="34" ry="8" fill="#000000" opacity="0.06" />
      {/* Mountain body */}
      <path d={variant === 0
        ? "M-30,0 L-10,-45 L0,-40 L12,-52 L32,0 Z"
        : variant === 1
          ? "M-26,0 L-4,-44 L24,0 Z"
          : "M-22,0 L0,-38 L6,-32 L14,-42 L28,0 Z"}
        fill={fills[variant % 3]}
      />
      {/* Snow cap */}
      <path d={variant === 0
        ? "M-10,-45 L0,-40 L12,-52 L6,-38 L-4,-40 Z"
        : variant === 1
          ? "M-4,-44 L-10,-24 L5,-28 L14,-20 Z"
          : "M0,-38 L6,-32 L14,-42 L8,-30 L-4,-32 Z"}
        fill={snowFills[variant % 3]}
        opacity="0.8"
      />
      {/* Ridge highlight */}
      <path d={variant === 0
        ? "M-10,-45 L0,-40 L12,-52"
        : variant === 1
          ? "M-4,-44 L8,-28"
          : "M0,-38 L6,-32 L14,-42"}
        fill="none" stroke="white" strokeWidth="0.6" opacity="0.3"
      />
      {/* Misty base */}
      <ellipse cx="0" cy="2" rx="35" ry="7" fill="white" opacity="0.18" />
    </g>
  );
}

function Cloud({ x, y, s = 1, driftDur = "100s" }: { x: number; y: number; s?: number; driftDur?: string }) {
  return (
    <g transform={`translate(${x},${y}) scale(${s})`} opacity="0.35">
      <g>
        {!motionIsReduced() && (
          <animateTransform attributeName="transform" type="translate" values="0,0;80,0;0,0" dur={driftDur} repeatCount="indefinite" />
        )}
        <ellipse cx="0" cy="0" rx="22" ry="9" fill="white" />
        <ellipse cx="-14" cy="2" rx="14" ry="7" fill="white" />
        <ellipse cx="16" cy="1" rx="16" ry="8" fill="white" />
        <ellipse cx="5" cy="-5" rx="12" ry="7" fill="white" />
      </g>
    </g>
  );
}

function House({ x, y, s = 1, roofColor = "#C8706E" }: { x: number; y: number; s?: number; roofColor?: string }) {
  return (
    <g transform={`translate(${x},${y}) scale(${s})`}>
      <ellipse cx="0" cy="4" rx="6" ry="2" fill="#000" opacity="0.06" />
      <rect x="-6" y="-7" width="12" height="10" rx="0.8" fill="#F0E4D0" stroke="#D0C0A8" strokeWidth="0.4" />
      <path d="M-8,-7 L0,-14 L8,-7 Z" fill={roofColor} stroke="#A05A58" strokeWidth="0.4" />
      <rect x="-2.5" y="-4" width="2.2" height="2.2" rx="0.3" fill="#8CC8E0" opacity="0.7" />
      <rect x="0.8" y="-4" width="2.2" height="2.2" rx="0.3" fill="#8CC8E0" opacity="0.7" />
      <rect x="-1.2" y="-1.5" width="2.4" height="4.5" rx="0.3" fill="#8B7355" />
    </g>
  );
}

function Bridge({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x},${y}) scale(${s})`}>
      <path d="M-18,0 C-10,-7 10,-7 18,0" stroke="#A89078" strokeWidth="2.2" fill="none" />
      <line x1="-12" y1="-3.5" x2="-12" y2="3" stroke="#A89078" strokeWidth="1.2" />
      <line x1="0" y1="-6" x2="0" y2="3" stroke="#A89078" strokeWidth="1.2" />
      <line x1="12" y1="-3.5" x2="12" y2="3" stroke="#A89078" strokeWidth="1.2" />
    </g>
  );
}

function CompassRose({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x},${y})`} opacity="0.6">
      <circle cx="0" cy="0" r="30" fill="none" stroke="#A89078" strokeWidth="1" />
      <circle cx="0" cy="0" r="27" fill="none" stroke="#A89078" strokeWidth="0.5" />
      {/* Tick marks */}
      {Array.from({ length: 16 }).map((_, i) => {
        const angle = (i * 22.5 * Math.PI) / 180;
        const r1 = i % 4 === 0 ? 24 : i % 2 === 0 ? 26 : 27;
        return (
          <line key={i}
            x1={Math.sin(angle) * r1} y1={-Math.cos(angle) * r1}
            x2={Math.sin(angle) * 30} y2={-Math.cos(angle) * 30}
            stroke="#A89078" strokeWidth={i % 4 === 0 ? 1 : 0.4}
          />
        );
      })}
      {/* Cardinal points */}
      <path d="M0,-26 L3.5,-8 L0,-12 L-3.5,-8 Z" fill="#7A5E40" />
      <path d="M0,26 L3,-8 L0,12 L-3,8 Z" fill="#B0A088" />
      <path d="M-26,0 L-8,3 L-12,0 L-8,-3 Z" fill="#B0A088" />
      <path d="M26,0 L8,3 L12,0 L8,-3 Z" fill="#B0A088" />
      {/* Intercardinal */}
      <path d="M-18,-18 L-6,-6 L-8,-3 Z" fill="#CCC0AA" />
      <path d="M18,-18 L6,-6 L8,-3 Z" fill="#CCC0AA" />
      <path d="M-18,18 L-6,6 L-3,8 Z" fill="#CCC0AA" />
      <path d="M18,18 L6,6 L3,8 Z" fill="#CCC0AA" />
      {/* Center ornament */}
      <circle cx="0" cy="0" r="4" fill="#A89078" />
      <circle cx="0" cy="0" r="2" fill="#E8D8C4" />
      <text y="-33" textAnchor="middle" fontSize="9" fontWeight="700" fill="#6B5B45"
        fontFamily="var(--font-display)">N</text>
    </g>
  );
}

/* ── Genshin-Style Waypoint Marker ───────────────────────────── */

function TownMarker({
  pin,
  meta,
  isHovered,
  onHover,
  onLeave,
  onClick,
  leader,
  leaderColor,
  leaderLabel,
  metCount,
  totalCount,
}: {
  pin: Pin;
  meta: ResolvedTownMeta;
  isHovered: boolean;
  onHover: () => void;
  onLeave: () => void;
  onClick: () => void;
  leader: LeanId | null;
  leaderColor: string | null;
  leaderLabel: string | null;
  metCount: number;
  totalCount: number;
}) {
  const glowId = `town-glow-${pin.id}`;
  const gradId = `waypoint-grad-${pin.id}`;
  const r = isHovered ? 19 : 16;
  const detailLine = [
    meta.population ? `Pop. ${meta.population}` : "",
    meta.county ?? "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <g
      className="district-map-pin"
      role="button"
      tabIndex={0}
      aria-label={`${meta.name}. ${leaderLabel ? `${leaderLabel} is leading. ` : "No leading option yet. "}${metCount} of ${totalCount} residents met. Enter town.`}
      onClick={onClick}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onFocus={onHover}
      onBlur={onLeave}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      style={{ cursor: "pointer" }}
    >
      {/* Hit area */}
      <circle className="district-map-pin-hit-area" cx={pin.cx} cy={pin.cy} r="50" fill="transparent" />

      <defs>
        <radialGradient id={glowId}>
          <stop offset="0%" stopColor={meta.color} stopOpacity={isHovered ? "0.35" : "0.15"} />
          <stop offset="50%" stopColor={meta.color} stopOpacity={isHovered ? "0.12" : "0.05"} />
          <stop offset="100%" stopColor={meta.color} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={gradId} cx="35%" cy="30%">
          <stop offset="0%" stopColor="white" stopOpacity="0.5" />
          <stop offset="40%" stopColor={meta.color} stopOpacity="1" />
          <stop offset="100%" stopColor={meta.color} stopOpacity="0.75" />
        </radialGradient>
      </defs>

      {/* Ambient glow */}
      <circle
        cx={pin.cx} cy={pin.cy}
        r={isHovered ? 50 : 35}
        fill={`url(#${glowId})`}
        style={{ transition: "r 0.4s ease-out" }}
      />

      {/* Outer pulsing ring */}
      <circle cx={pin.cx} cy={pin.cy} r="24" fill="none" stroke={meta.color} strokeWidth="1" opacity="0.3">
        {!motionIsReduced() && <animate attributeName="r" values="24;34;24" dur="3s" repeatCount="indefinite" />}
        {!motionIsReduced() && <animate attributeName="opacity" values="0.35;0;0.35" dur="3s" repeatCount="indefinite" />}
      </circle>

      {/* Second pulse (offset timing) */}
      <circle cx={pin.cx} cy={pin.cy} r="21" fill="none" stroke={meta.color} strokeWidth="0.6" opacity="0.2">
        {!motionIsReduced() && <animate attributeName="r" values="21;30;21" dur="3s" begin="1.5s" repeatCount="indefinite" />}
        {!motionIsReduced() && <animate attributeName="opacity" values="0.2;0;0.2" dur="3s" begin="1.5s" repeatCount="indefinite" />}
      </circle>

      {/* Waypoint base — outer ring */}
      <circle cx={pin.cx} cy={pin.cy + 1} r={r + 3} fill="rgba(0,0,0,0.1)" />
      <circle
        cx={pin.cx} cy={pin.cy} r={r + 2}
        fill="none"
        stroke="rgba(255,255,255,0.5)"
        strokeWidth="1.5"
        style={{ transition: "r 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)" }}
      />

      {/* Waypoint core — gradient circle */}
      <circle
        cx={pin.cx} cy={pin.cy} r={r}
        fill={`url(#${gradId})`}
        stroke="white" strokeWidth="2.5"
        style={{
          transition: "r 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)",
          filter: isHovered ? "url(#townGlow)" : "none",
        }}
      />

      {/* Inner diamond waypoint symbol */}
      <path
        d={`M${pin.cx},${pin.cy - 6.5} L${pin.cx + 5},${pin.cy} L${pin.cx},${pin.cy + 6.5} L${pin.cx - 5},${pin.cy} Z`}
        fill="white" opacity="0.9"
      />
      {/* Inner dot */}
      <circle cx={pin.cx} cy={pin.cy} r="1.8" fill="white" opacity="0.7" />

      {/* ── Status pill: leader dot + labeled met count between pin and plate ── */}
      {(totalCount > 0 || leader) && (
        <g style={{ pointerEvents: "none" }}>
          <rect
            x={pin.cx - 33} y={pin.cy + 19}
            width="66" height="15" rx="7.5" ry="7.5"
            fill="rgba(255,255,255,0.96)"
            stroke={leaderColor ?? "rgba(196,180,154,0.55)"}
            strokeWidth="0.8"
            filter="url(#labelShadow)"
          />
          {leader && leaderColor && (
            <circle
              cx={pin.cx - 24} cy={pin.cy + 26.5}
              r="2.8"
              fill={leaderColor}
            >
              <title>Leading: {leader}</title>
            </circle>
          )}
          <text
            x={leader ? pin.cx + 3 : pin.cx}
            y={pin.cy + 29.5}
            textAnchor="middle" fontSize="8" fontWeight="700"
            fill="#2C2416"
            fontFamily="Inter, sans-serif"
          >
            {metCount}/{totalCount} met
          </text>
        </g>
      )}

      {/* ── Town label: full-width name plate; expands on hover with tagline + pop ── */}
      <g>
        <rect
          x={pin.cx - 58} y={pin.cy + 40}
          width="116" height={isHovered ? 52 : 26}
          rx="6" ry="6"
          fill="rgba(255,255,255,0.93)"
          stroke={isHovered ? meta.color : "rgba(196,180,154,0.4)"}
          strokeWidth={isHovered ? 1.2 : 0.6}
          filter="url(#labelShadow)"
          style={{ transition: "all 0.3s ease" }}
        />

        {/* Town name — full label width, no inline chips to collide with */}
        <text
          x={pin.cx} y={pin.cy + 57}
          textAnchor="middle" fontSize="13" fontWeight="600"
          fill="#2C2416"
          fontFamily="var(--font-display)"
          letterSpacing="0.3"
        >
          {meta.name}
        </text>

        {/* Tagline + population (on hover) */}
        {isHovered && (
          <>
            {meta.tagline && (
              <text
                x={pin.cx} y={pin.cy + 72}
                textAnchor="middle" fontSize="8" fontWeight="500"
                fill={meta.color}
                fontFamily="Inter, sans-serif"
                letterSpacing="0.2"
              >
                {meta.tagline}
              </text>
            )}
            {detailLine && (
              <text
                x={pin.cx} y={pin.cy + 84}
                textAnchor="middle" fontSize="7" fontWeight="600"
                fill="#8A7E6E"
                fontFamily="Inter, sans-serif"
              >
                {detailLine}
              </text>
            )}
          </>
        )}
      </g>
    </g>
  );
}

/* ── Resident dots ────────────────────────────────────────────
   Each town's roster rendered as tiny wandering villagers around its
   waypoint, tinted by their current stance. The atlas reads as inhabited,
   and the deliberation state is visible from the landing page. ── */

function ResidentDots({
  pin,
  agents,
  stanceColor,
  motionReduced,
}: {
  pin: Pin;
  agents: AgentState[];
  stanceColor: (a: AgentState) => string;
  motionReduced: boolean;
}) {
  const placed = useMemo(() => {
    const rng = mulberry32(hashString(`dots:${pin.id}`));
    const n = agents.length;
    return agents.map((a, i) => {
      // Upper arc around the pin — the pill + name plate own the space below.
      const t = n <= 1 ? 0.5 : i / (n - 1);
      const angle = Math.PI * (1.08 + 0.84 * t) + (rng() - 0.5) * 0.22;
      const radius = 30 + rng() * 20;
      return {
        id: a.id,
        x: pin.cx + Math.cos(angle) * radius,
        y: pin.cy + Math.sin(angle) * radius * 0.8,
        dx: (rng() - 0.5) * 9,
        dy: (rng() - 0.5) * 7,
        dur: 4.5 + rng() * 3.5,
        begin: rng() * 3,
      };
    });
  }, [pin, agents]);

  return (
    <g aria-hidden="true" style={{ pointerEvents: "none" }}>
      {placed.map((p, i) => (
        <g key={p.id}>
          {!motionReduced && (
            <animateTransform
              attributeName="transform"
              type="translate"
              values={`0,0; ${p.dx},${p.dy}; 0,0`}
              dur={`${p.dur}s`}
              begin={`${p.begin}s`}
              repeatCount="indefinite"
            />
          )}
          <ellipse cx={p.x} cy={p.y + 3} rx="2.6" ry="1" fill="#2A2A2A" opacity="0.12" />
          <circle
            cx={p.x} cy={p.y} r="2.8"
            fill={stanceColor(agents[i])}
            stroke="white" strokeWidth="0.9"
            opacity="0.95"
          />
        </g>
      ))}
    </g>
  );
}

/* ── NJ-11 hand-drawn terrain (flagship scenario, unchanged) ─── */

function NJ11Terrain() {
  return (
    <>
      {/* ─── Layer 2: District Terrain Base ────────────── */}
      <path
        d={`
          M 140,160 C 160,130 210,95 280,80 C 340,68 400,65 460,62
          C 530,58 590,60 640,68 C 690,76 730,90 770,110 C 810,130 840,160 860,200
          C 875,235 880,270 870,310 C 862,345 840,375 810,400 C 780,425 740,445 700,458
          C 660,468 620,472 580,475 C 530,478 480,480 440,478 C 390,475 340,468 300,455
          C 260,442 220,420 190,390 C 162,358 145,320 138,280 C 130,240 130,200 140,160 Z
        `}
        fill="url(#terrainBase)"
        filter="url(#watercolor)"
        stroke="#A0906E"
        strokeWidth="1"
        opacity="0.95"
      />

      {/* Highlands tint (western) */}
      <path
        d={`
          M 140,160 C 160,130 210,95 280,80 C 340,68 380,65 420,64
          L 400,200 L 380,320 L 350,400
          C 300,455 260,442 220,420 C 190,390 162,358 145,320
          C 138,280 130,240 130,200 C 130,200 140,160 140,160 Z
        `}
        fill="url(#highlands)" opacity="0.35"
      />

      {/* Piedmont tint (eastern) */}
      <path
        d={`
          M 640,68 C 690,76 730,90 770,110 C 810,130 840,160 860,200
          C 875,235 880,270 870,310 C 862,345 840,375 810,400
          C 780,425 740,445 700,458 C 660,468 640,470 620,472
          L 600,350 L 590,250 L 600,160 Z
        `}
        fill="url(#piedmont)" opacity="0.3"
      />

      {/* Grass texture */}
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
      {/* Mountains — pushed far west, clear of Dover pin at 250,240 */}
      <Mountain x={148} y={195} s={0.9} variant={0} />
      <Mountain x={180} y={150} s={1.1} variant={1} />
      <Mountain x={155} y={260} s={0.7} variant={2} />
      <Mountain x={195} y={130} s={0.55} variant={0} />

      {/* Rolling hills — spread across mid-terrain, away from pins */}
      {[
        [420, 370, 45, 11, "#A4C488"], [580, 400, 38, 9, "#B0CC98"],
        [650, 360, 42, 10, "#9CBC80"], [460, 440, 32, 8, "#B0CC98"],
        [770, 310, 35, 9, "#A4C488"],
      ].map(([cx, cy, rx, ry, fill], i) => (
        <ellipse key={`hill-${i}`} cx={cx as number} cy={cy as number}
          rx={rx as number} ry={ry as number} fill={fill as string} opacity="0.35" />
      ))}

      {/* Forest clusters — deliberately placed AWAY from pin zones */}
      {/* Far-west forest (near mountains) */}
      <Tree x={165} y={320} s={0.85} shade={0} />
      <PineTree x={178} y={310} s={0.75} />
      <Tree x={190} y={328} s={0.9} shade={1} />
      <PineTree x={155} y={335} s={0.65} />

      {/* South-central forest (between Parsippany & Randolph, below both) */}
      <Tree x={400} y={460} s={0.75} shade={0} />
      <PineTree x={418} y={455} s={0.85} />
      <Tree x={435} y={465} s={0.7} shade={1} />
      <PineTree x={385} y={470} s={0.6} />

      {/* Eastern forest (below Montclair) */}
      <Tree x={690} y={340} s={0.7} shade={1} />
      <Tree x={708} y={335} s={0.8} shade={2} />
      <PineTree x={725} y={345} s={0.65} />

      {/* Northeastern trees */}
      <Tree x={780} y={180} s={0.6} shade={0} />
      <PineTree x={800} y={170} s={0.55} />

      {/* Scattered singles — far from pins */}
      <Tree x={560} y={160} s={0.55} shade={0} />
      <PineTree x={620} y={430} s={0.55} />
      <Tree x={530} y={450} s={0.5} shade={1} />
      <Tree x={310} y={180} s={0.5} shade={2} />
      <PineTree x={850} y={280} s={0.45} />

      {/* Houses — scattered away from pins */}
      <House x={370} y={200} s={0.7} roofColor="#C8706E" />
      <House x={580} y={190} s={0.65} roofColor="#B08060" />
      <House x={440} y={350} s={0.6} roofColor="#C8706E" />
      <House x={660} y={280} s={0.6} roofColor="#A07858" />
      <House x={320} y={340} s={0.55} roofColor="#B08060" />

      {/* Mid-district hamlets — the open meadow between the four pins reads
          as inhabited countryside instead of an empty oval. */}
      <House x={560} y={350} s={0.65} roofColor="#B08060" />
      <House x={588} y={332} s={0.55} roofColor="#C8706E" />
      <Tree x={575} y={368} s={0.6} shade={1} />
      <Tree x={540} y={318} s={0.55} shade={0} />
      <House x={640} y={396} s={0.6} roofColor="#A07858" />
      <Tree x={620} y={342} s={0.55} shade={2} />
      <Tree x={390} y={330} s={0.6} shade={0} />
      <House x={412} y={308} s={0.55} roofColor="#C8706E" />
      <Tree x={470} y={158} s={0.55} shade={1} />
      <House x={512} y={136} s={0.5} roofColor="#B08060" />
      <PineTree x={432} y={122} s={0.5} />

      {/* ─── Layer 4: Water Features ───────────────────── */}
      {/* Rockaway River — clear, visible stroke */}
      <path
        d="M 170,145 C 185,175 210,210 225,245 C 240,272 252,295 275,325 C 292,348 315,370 345,390"
        fill="none" stroke="url(#waterGrad)" strokeWidth="4" strokeLinecap="round"
        opacity="0.8"
      />
      {/* River shimmer */}
      {[[192, 185], [220, 230], [248, 278], [280, 330], [325, 378]].map(([cx, cy], i) => (
        <circle key={`shimmer-${i}`} cx={cx} cy={cy} r="1.3" fill="white" opacity="0.5">
          {!motionIsReduced() && (
            <animate attributeName="opacity" values="0.3;0.7;0.3" dur={`${2 + i * 0.3}s`} repeatCount="indefinite" />
          )}
        </circle>
      ))}

      {/* Passaic River */}
      <path
        d="M 640,175 C 655,210 668,250 676,285 C 684,315 686,345 680,380"
        fill="none" stroke="url(#waterGrad)" strokeWidth="3.5" strokeLinecap="round"
        opacity="0.7"
      />

      <Bridge x={230} y={250} s={0.75} />

      {/* ─── Layer 5: Roads ────────────────────────────── */}
      <path
        d="M 155,220 C 250,215 400,230 500,240 C 600,250 700,220 850,215"
        fill="none" stroke="#C4AE8C" strokeWidth="2.5" strokeLinecap="round"
        opacity="0.5" strokeDasharray="8 4"
      />
      <rect x="490" y="222" width="30" height="13" rx="3" fill="rgba(180,160,130,0.65)" />
      <text x="505" y="232" textAnchor="middle" fontSize="7.5" fontWeight="700"
        fill="#6B5B45" fontFamily="Inter, sans-serif">I-80</text>

      <path
        d="M 300,280 C 400,285 500,290 620,275"
        fill="none" stroke="#C4AE8C" strokeWidth="1.5" strokeLinecap="round"
        opacity="0.35" strokeDasharray="5 3"
      />

      {/* ─── Layer 6: County Boundary ──────────────────── */}
      <path
        d="M 590,70 C 585,140 580,220 575,300 C 572,360 570,420 565,475"
        fill="none" stroke="#A89888" strokeWidth="0.8"
        strokeDasharray="3 3" opacity="0.45"
      />
      <text x="380" y={108} textAnchor="middle" fontSize="10" fontWeight="600"
        fill="#A0907A" fontFamily="Inter, sans-serif" letterSpacing="0.2em" opacity="0.65">
        MORRIS COUNTY
      </text>
      <text x="720" y={155} textAnchor="middle" fontSize="10" fontWeight="600"
        fill="#A0907A" fontFamily="Inter, sans-serif" letterSpacing="0.2em" opacity="0.65">
        ESSEX COUNTY
      </text>

      {/* ─── Layer 7: Clouds ───────────────────────────── */}
      <Cloud x={150} y={85} s={0.85} driftDur="80s" />
      <Cloud x={500} y={48} s={1.1} driftDur="100s" />
      <Cloud x={830} y={95} s={0.75} driftDur="120s" />
      <Cloud x={390} y={510} s={0.65} driftDur="90s" />
      <Cloud x={750} y={490} s={0.55} driftDur="110s" />
    </>
  );
}

/* ── Generic seeded terrain (any other scenario) ─────────────── */

function GenericTerrain({ pins, seedKey }: { pins: Pin[]; seedKey: string }) {
  const layout = useMemo(() => {
    const rng = mulberry32(hashString(`${seedKey}::terrain`));
    const twoTowns = pins.length === 2;

    // Mountain range hugs whichever top corner the seed favors.
    const mountainsWest = rng() < 0.5;
    const mx = mountainsWest ? 160 : 830;
    const mSign = mountainsWest ? 1 : -1;

    // River: for two towns it runs BETWEEN them; otherwise it wanders down
    // from the mountains through open terrain. Built from two cubic bezier
    // segments so we can sample exact points for the shimmer sparkles.
    let seg1: [Pt, Pt, Pt, Pt];
    let seg2: [Pt, Pt, Pt, Pt];
    let bridge: { x: number; y: number } | null = null;
    if (twoTowns) {
      const midX = (pins[0].cx + pins[1].cx) / 2 + (rng() - 0.5) * 20;
      const sway = 24 + rng() * 22;
      seg1 = [[midX - sway, 78], [midX + sway, 170], [midX - sway, 250], [midX + sway * 0.6, 330]];
      seg2 = [[midX + sway * 0.6, 330], [midX + sway, 410], [midX - sway * 0.5, 470], [midX + sway * 0.3, 515]];
      bridge = { x: midX + sway * 0.1, y: (pins[0].cy + pins[1].cy) / 2 + 8 };
    } else {
      const startX = mountainsWest ? 210 : 780;
      const d = mountainsWest ? 1 : -1;
      seg1 = [[startX, 140], [startX + 40 * d, 210], [startX + 20 * d, 280], [startX + 70 * d, 340]];
      seg2 = [[startX + 70 * d, 340], [startX + 110 * d, 395], [startX + 90 * d, 450], [startX + 140 * d, 495]];
      bridge = null;
    }
    const river =
      `M ${seg1[0][0]},${seg1[0][1]} C ${seg1[1][0]},${seg1[1][1]} ${seg1[2][0]},${seg1[2][1]} ${seg1[3][0]},${seg1[3][1]}` +
      ` C ${seg2[1][0]},${seg2[1][1]} ${seg2[2][0]},${seg2[2][1]} ${seg2[3][0]},${seg2[3][1]}`;
    const shimmers: Pt[] = [0.15, 0.4, 0.65, 0.85, 0.95].map((t) =>
      t < 0.5
        ? cubicAt(seg1[0], seg1[1], seg1[2], seg1[3], t * 2)
        : cubicAt(seg2[0], seg2[1], seg2[2], seg2[3], (t - 0.5) * 2),
    );

    // Road: a dashed track linking the waypoints in order.
    let road = "";
    if (pins.length >= 2) {
      road = `M ${pins[0].cx},${pins[0].cy + 8}`;
      for (let i = 1; i < pins.length; i++) {
        const a = pins[i - 1];
        const b = pins[i];
        const mx2 = (a.cx + b.cx) / 2 + (rng() - 0.5) * 50;
        const my2 = (a.cy + b.cy) / 2 + 22 + (rng() - 0.5) * 30;
        road += ` Q ${mx2},${my2} ${b.cx},${b.cy + 8}`;
      }
    }

    const trees = scatterPoints(rng, 12, pins);
    const houses = scatterPoints(rng, 5, pins, 90);
    const hills = scatterPoints(rng, 5, pins, 70);

    return { mountainsWest, mx, mSign, river, bridge, road, trees, houses, hills, shimmers };
  }, [pins, seedKey]);

  const roofs = ["#C8706E", "#B08060", "#A07858"];

  return (
    <>
      {/* ─── Terrain base — same watercolor landmass language ── */}
      <path
        d={`
          M 140,160 C 160,130 210,95 280,80 C 340,68 400,65 460,62
          C 530,58 590,60 640,68 C 690,76 730,90 770,110 C 810,130 840,160 860,200
          C 875,235 880,270 870,310 C 862,345 840,375 810,400 C 780,425 740,445 700,458
          C 660,468 620,472 580,475 C 530,478 480,480 440,478 C 390,475 340,468 300,455
          C 260,442 220,420 190,390 C 162,358 145,320 138,280 C 130,240 130,200 140,160 Z
        `}
        fill="url(#terrainBase)"
        filter="url(#watercolor)"
        stroke="#A0906E"
        strokeWidth="1"
        opacity="0.95"
      />
      {/* Highland tint on the mountain side */}
      <path
        d={layout.mountainsWest
          ? `M 140,160 C 160,130 210,95 280,80 C 340,68 380,65 420,64 L 400,200 L 380,320 L 350,400 C 300,455 260,442 220,420 C 190,390 162,358 145,320 C 138,280 130,240 130,200 C 130,200 140,160 140,160 Z`
          : `M 640,68 C 690,76 730,90 770,110 C 810,130 840,160 860,200 C 875,235 880,270 870,310 C 862,345 840,375 810,400 C 780,425 740,445 700,458 C 660,468 640,470 620,472 L 600,350 L 590,250 L 600,160 Z`}
        fill="url(#highlands)" opacity="0.35"
      />
      {/* Soft meadow tint on the far side */}
      <path
        d={layout.mountainsWest
          ? `M 640,68 C 690,76 730,90 770,110 C 810,130 840,160 860,200 C 875,235 880,270 870,310 C 862,345 840,375 810,400 C 780,425 740,445 700,458 C 660,468 640,470 620,472 L 600,350 L 590,250 L 600,160 Z`
          : `M 140,160 C 160,130 210,95 280,80 C 340,68 380,65 420,64 L 400,200 L 380,320 L 350,400 C 300,455 260,442 220,420 C 190,390 162,358 145,320 C 138,280 130,240 130,200 C 130,200 140,160 140,160 Z`}
        fill="url(#piedmont)" opacity="0.3"
      />
      {/* Grass texture */}
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

      {/* Mountain range in the seeded corner */}
      <Mountain x={layout.mx} y={195} s={0.9} variant={0} />
      <Mountain x={layout.mx + 32 * layout.mSign} y={150} s={1.1} variant={1} />
      <Mountain x={layout.mx + 7 * layout.mSign} y={260} s={0.7} variant={2} />
      <Mountain x={layout.mx + 47 * layout.mSign} y={130} s={0.55} variant={0} />

      {/* Rolling hills */}
      {layout.hills.map((h, i) => (
        <ellipse key={`ghill-${i}`} cx={h.x} cy={h.y + 40}
          rx={30 + h.r * 18} ry={8 + h.r * 4}
          fill={["#A4C488", "#B0CC98", "#9CBC80"][i % 3]} opacity="0.35" />
      ))}

      {/* River + shimmer */}
      <path
        d={layout.river}
        fill="none" stroke="url(#waterGrad)" strokeWidth="4" strokeLinecap="round"
        opacity="0.8"
      />
      {layout.shimmers.map(([sx, sy], i) => (
        <circle key={`gshimmer-${i}`} cx={sx} cy={sy} r="1.3" fill="white" opacity="0.5">
          {!motionIsReduced() && (
            <animate attributeName="opacity" values="0.3;0.7;0.3" dur={`${2 + i * 0.3}s`} repeatCount="indefinite" />
          )}
        </circle>
      ))}
      {layout.bridge && <Bridge x={layout.bridge.x} y={layout.bridge.y} s={0.75} />}

      {/* Road linking the waypoints */}
      {layout.road && (
        <path
          d={layout.road}
          fill="none" stroke="#C4AE8C" strokeWidth="2.5" strokeLinecap="round"
          opacity="0.5" strokeDasharray="8 4"
        />
      )}

      {/* Forests + scattered homesteads */}
      {layout.trees.map((t, i) =>
        t.r < 0.45 ? (
          <PineTree key={`gtree-${i}`} x={t.x} y={t.y} s={0.5 + t.r * 0.5} />
        ) : (
          <Tree key={`gtree-${i}`} x={t.x} y={t.y} s={0.5 + t.r * 0.45} shade={i % 4} />
        ),
      )}
      {layout.houses.map((h, i) => (
        <House key={`ghouse-${i}`} x={h.x} y={h.y} s={0.55 + h.r * 0.2} roofColor={roofs[i % roofs.length]} />
      ))}

      {/* Clouds */}
      <Cloud x={150} y={85} s={0.85} driftDur="80s" />
      <Cloud x={500} y={48} s={1.1} driftDur="100s" />
      <Cloud x={830} y={95} s={0.75} driftDur="120s" />
      <Cloud x={390} y={510} s={0.65} driftDur="90s" />
      <Cloud x={750} y={490} s={0.55} driftDur="110s" />
    </>
  );
}

/* ── Banner copy helpers ─────────────────────────────────────── */

function decisionDayLabel(scen: ScenarioContextValue): string {
  const raw = scen.scenario.dates?.decision_day;
  if (!raw) return "";
  const d = new Date(`${raw}T00:00:00`);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

/* ── Main Component ──────────────────────────────────────────── */

export default function DistrictMap() {
  const navigate = useNavigate();
  const { isOnboarded, profile } = useUserProfile();
  const ws = useWebSocketContext();
  const scen = useScenario();
  const [hovered, setHovered] = useState<TownId | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { setLoaded(true); }, []);

  // This identity check selects an optional illustrated skin only; no domain
  // facts are sourced from it.
  const hasNJ11Atlas = scen.scenario.id === "nj11-2026";

  const pins = useMemo<Pin[]>(() => {
    if (hasNJ11Atlas) {
      return scen.scenario.towns.map((town) => {
        const point = NJ11_PIN_LAYOUT[town.id];
        return point
          ? { id: town.id, ...point, description: town.tagline ?? "" }
          : genericPins([{ id: town.id, tagline: town.tagline }], `${scen.scenario.id}:${town.id}`)[0];
      });
    }
    return genericPins(
      scen.scenario.towns.map((t) => ({ id: t.id, tagline: t.tagline })),
      scen.scenario.id,
    );
  }, [hasNJ11Atlas, scen.scenario]);

  const townIds = useMemo(() => pins.map((p) => p.id), [pins]);

  const agents = useMemo(() => Object.values(ws.agents), [ws.agents]);
  const [rosterAgents, setRosterAgents] = useState<AgentState[]>([]);

  // Before a live simulation starts, use the real scenario roster so every
  // atlas gets the same portrait + leading-option treatment. Static demos get
  // an authoritative transport roster primed from their staged feed.
  useEffect(() => {
    setRosterAgents([]);
    if (DEMO_MODE) return;
    const ctrl = new AbortController();
    fetch("/api/simulation/agents", { signal: ctrl.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!payload) return;
        setRosterAgents(rosterAgentsFromPayload(payload, townIds, scen.undecidedId));
      })
      .catch(() => { /* zero-backend demo: the replay supplies residents */ });
    return () => ctrl.abort();
  }, [scen.scenario.id, scen.undecidedId, townIds]);

  const displayAgents = useMemo(() => {
    if (agents.length > 0) return agents;
    const transportRoster = Object.values(ws.agentRoster);
    if (transportRoster.length > 0) return transportRoster;
    return rosterAgents;
  }, [agents, ws.agentRoster, rosterAgents]);

  const leaders = useMemo(
    () => leadingOptionPerTown(displayAgents, townIds, scen.undecidedId),
    [displayAgents, townIds, scen.undecidedId],
  );
  const townTotals: Record<TownId, number> = useMemo(() => {
    const out: Record<TownId, number> = {};
    for (const t of townIds) out[t] = 0;
    for (const a of displayAgents) out[a.town] = (out[a.town] || 0) + 1;
    return out;
  }, [displayAgents, townIds]);
  // Deterministic "face of the town" for the hover card: first roster entry
  // from the live stream, replay metadata, or API roster.
  const firstResident: Record<TownId, AgentState | null> = useMemo(() => {
    const out: Record<TownId, AgentState | null> = {};
    for (const t of townIds) {
      out[t] = displayAgents.find((agent) => agent.town === t) ?? null;
    }
    return out;
  }, [displayAgents, townIds]);

  // Towns whose preview PNG 404'd — hide the image, keep the card.
  const [previewFailed, setPreviewFailed] = useState<Record<string, boolean>>({});

  // Ambient life: rotate a short resident speech/thought bubble across the
  // towns so the atlas shows the deliberation, not just its geography.
  const [ambient, setAmbient] = useState<{
    town: TownId; name: string; text: string; seq: number;
  } | null>(null);
  const ambientSourceRef = useRef<{ agents: AgentState[]; events: typeof ws.events }>({
    agents: [], events: [],
  });
  ambientSourceRef.current = { agents: displayAgents, events: ws.events };
  const hasAmbient = displayAgents.length > 0;
  useEffect(() => {
    if (!hasAmbient) {
      setAmbient(null);
      return;
    }
    let seq = Math.floor(Math.random() * 97);
    const pick = () => {
      const { agents, events } = ambientSourceRef.current;
      if (agents.length === 0) return;
      const agent = agents[seq % agents.length];
      seq += 7; // co-prime stride: cycles all residents without reshuffling
      // Prefer a real spoken line from the stream; otherwise the persona's
      // top concern keeps the bubble honest to the scenario data.
      let text: string | null = null;
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i];
        if (e.type === "agent_speech" && e.agent_id === agent.id) {
          text = e.text;
          break;
        }
      }
      if (!text) {
        const concern = agent.opinion?.top_issues?.[0] ?? agent.top_concerns?.[0];
        text = concern ? `thinking about ${concern}…` : agent.current_activity || agent.occupation;
      }
      if (text.length > 80) text = `${text.slice(0, 77).trimEnd()}…`;
      setAmbient({
        town: agent.town,
        name: agent.name.split(" ")[0],
        text,
        seq,
      });
    };
    pick();
    const id = window.setInterval(pick, 4200);
    return () => window.clearInterval(id);
  }, [hasAmbient]);

  const metPerTown: Record<TownId, number> = useMemo(() => {
    const out: Record<TownId, number> = {};
    for (const t of townIds) out[t] = 0;
    if (!profile?.metAgents) return out;
    // We can't know the town of every met agent without the agent list; intersect
    // with whatever roster is currently visible.
    for (const a of displayAgents) {
      if (profile.metAgents.includes(a.id) && out[a.town] !== undefined) out[a.town]++;
    }
    return out;
  }, [profile?.metAgents, displayAgents, townIds]);

  const goToTown = (id: TownId) => {
    // The hosted replay should reveal its strongest surface immediately;
    // profile creation remains part of the interactive local experience.
    if (DEMO_MODE || isOnboarded) {
      navigate(`/town/${id}`);
    } else {
      navigate(`/onboarding?town=${id}`);
    }
  };

  const totalResidents = displayAgents.length;
  const dday = decisionDayLabel(scen);
  const motionReduced = motionIsReduced();

  return (
    <div
      className="flex flex-col items-center justify-center min-h-[calc(100vh-56px)] px-4 py-4"
      style={{ opacity: loaded ? 1 : 0, transition: "opacity 0.8s ease-out" }}
    >
      {/* ── Header ──────────────────────────────────────────────
          The wordmark already lives in the app header, and the scenario
          title sits on the atlas plaque — so this block leads with the one
          thing nothing else on the page says: the question at stake. */}
      <div className="text-center mb-3 max-w-3xl">
        <h1
          className="leading-snug"
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 600,
            fontSize: "clamp(16px, 1.5vw + 10px, 20px)",
            color: "var(--text-primary)",
            letterSpacing: "0.4px",
            animation: "stagger-in 0.5s var(--ease-genshin) backwards",
            animationDelay: "0ms",
          }}
        >
          {scen.question}
        </h1>
        <p
          className="text-sm mt-1"
          style={{
            fontFamily: "var(--font-body)",
            color: "var(--text-muted)",
            animation: "stagger-in 0.5s var(--ease-genshin) backwards",
            animationDelay: "120ms",
          }}
        >
          Click a community to meet your AI neighbors
          {dday ? ` · Decision day ${dday}` : ""}
        </p>
      </div>

      {/* ── SVG Map ────────────────────────────────────────────── */}
      <div
        className="relative w-full max-w-[960px] mx-auto"
        style={{
          animation: "stagger-in 0.5s var(--ease-genshin) backwards",
          animationDelay: "300ms",
        }}
      >
        <svg viewBox="0 0 1000 620" className="w-full h-auto" style={{ overflow: "visible" }}>
          <defs>
            <filter id="paperTexture" x="-5%" y="-5%" width="110%" height="110%">
              <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="4" seed="3" result="noise" />
              <feColorMatrix type="saturate" values="0" in="noise" result="grayNoise" />
              <feBlend mode="multiply" in="SourceGraphic" in2="grayNoise" result="textured" />
              <feComponentTransfer in="textured">
                <feFuncA type="linear" slope="1" />
              </feComponentTransfer>
            </filter>

            <filter id="watercolor" x="-2%" y="-2%" width="104%" height="104%">
              <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="3" seed="7" result="warp" />
              <feDisplacementMap in="SourceGraphic" in2="warp" scale="3" xChannelSelector="R" yChannelSelector="G" />
            </filter>

            <filter id="townGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            <filter id="labelShadow" x="-10%" y="-10%" width="120%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="4" floodOpacity="0.12" />
            </filter>

            {/* Vibrant terrain gradients — Genshin-style saturation */}
            <linearGradient id="terrainBase" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#CCC6A0" />
              <stop offset="35%" stopColor="#B8D098" />
              <stop offset="100%" stopColor="#A4C488" />
            </linearGradient>

            <linearGradient id="highlands" x1="0%" y1="100%" x2="0%" y2="0%">
              <stop offset="0%" stopColor="#A8B890" />
              <stop offset="100%" stopColor="#90A878" />
            </linearGradient>

            <linearGradient id="piedmont" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#BCD8A0" />
              <stop offset="100%" stopColor="#C8E0A8" />
            </linearGradient>

            <linearGradient id="waterGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#60ACD0" stopOpacity="0.65" />
              <stop offset="50%" stopColor="#4CA0CC" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#60ACD0" stopOpacity="0.55" />
            </linearGradient>

            <radialGradient id="vignetteGrad" cx="50%" cy="50%" r="55%">
              <stop offset="0%" stopColor="transparent" />
              <stop offset="85%" stopColor="transparent" />
              <stop offset="100%" stopColor="rgba(44,36,22,0.08)" />
            </radialGradient>

            <pattern id="grassPattern" patternUnits="userSpaceOnUse" width="12" height="12">
              <line x1="3" y1="10" x2="3" y2="6" stroke="#6EAA50" strokeWidth="0.5" opacity="0.3" />
              <line x1="7" y1="11" x2="8" y2="7" stroke="#5E9A40" strokeWidth="0.5" opacity="0.25" />
              <line x1="10" y1="10" x2="10" y2="7" stroke="#6EAA50" strokeWidth="0.5" opacity="0.2" />
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
          {[[44, 34], [958, 34], [44, 586], [958, 586]].map(([cx, cy], i) => (
            <g key={i} transform={`translate(${cx},${cy})`}>
              <circle r="3.5" fill="#C4B49A" opacity="0.4" />
              <circle r="1.8" fill="#A89078" opacity="0.5" />
            </g>
          ))}

          {/* ─── Layers 2–7: Terrain ───────────────────────── */}
          {hasNJ11Atlas ? (
            <NJ11Terrain />
          ) : (
            <GenericTerrain pins={pins} seedKey={scen.scenario.id} />
          )}

          {/* ─── Layer 8: Resident dots + Town Markers ─────── */}
          {pins.map((pin) => (
            <ResidentDots
              key={`dots-${pin.id}`}
              pin={pin}
              agents={displayAgents.filter((a) => a.town === pin.id)}
              stanceColor={(a) =>
                scen.optionColor((a.opinion?.candidate as LeanId) || scen.undecidedId)
              }
              motionReduced={motionReduced}
            />
          ))}
          {pins.map((pin) => (
            <TownMarker
              key={pin.id}
              pin={pin}
              meta={scen.townMeta(pin.id)}
              isHovered={hovered === pin.id}
              onHover={() => setHovered(pin.id)}
              onLeave={() => setHovered(null)}
              onClick={() => goToTown(pin.id)}
              leader={leaders[pin.id]}
              leaderColor={leaders[pin.id] ? scen.optionColor(leaders[pin.id]) : null}
              leaderLabel={leaders[pin.id] ? scen.optionLabel(leaders[pin.id]) : null}
              metCount={metPerTown[pin.id]}
              totalCount={townTotals[pin.id]}
            />
          ))}

          {/* ─── Layer 9: Compass Rose ─────────────────────── */}
          {/* NOTE: no CSS transform-origin here — SMIL rotate(θ,cx,cy) already
              encodes its pivot, and stacking both makes the rose orbit. */}
          <g>
            {!motionReduced && (
              <animateTransform attributeName="transform" type="rotate" from="0 905 530" to="360 905 530" dur="120s" repeatCount="indefinite" />
            )}
            <CompassRose x={905} y={530} />
          </g>

          {/* ─── Layer 10: Vignette ────────────────────────── */}
          <rect x="30" y="20" width="940" height="580" rx="12" fill="url(#vignetteGrad)" pointerEvents="none" />

          {/* ─── Title cartouche ───────────────────────────── */}
          <g transform="translate(65, 48)">
            <rect x="-10" y="-8" width={Math.max(155, scen.title.length * 6.8 + 24)} height="40" rx="5" fill="rgba(237,231,218,0.92)"
              stroke="#C4B49A" strokeWidth="0.6" filter="url(#labelShadow)" />
            <text x="0" y="7" fontSize="11" fontWeight="700" fill="#5A4A38"
              fontFamily="var(--font-display)" letterSpacing="0.5">
              {scen.title}
            </text>
            <text x="0" y="22" fontSize="7.5" fill="#A89078" fontFamily="Inter, sans-serif" letterSpacing="0.3">
              {[
                totalResidents ? `${totalResidents} AI Residents` : "AI Residents",
                `${pins.length} Town${pins.length === 1 ? "" : "s"}`,
              ].join(" · ")}
            </text>
          </g>

          {/* ─── Decorative birds ───────────────────────────── */}
          <g opacity="0.3">
            <path d="M420,95 Q425,87 430,93 Q435,87 440,95" fill="none" stroke="#6B5B45" strokeWidth="0.9">
              {!motionReduced && <animateMotion dur="18s" repeatCount="indefinite" path="M0,0 C50,-10 100,5 150,-5 C200,-15 250,0 300,-10 L350,0" />}
            </path>
            <path d="M415,100 Q418,94 421,99 Q424,94 427,100" fill="none" stroke="#6B5B45" strokeWidth="0.7">
              {!motionReduced && <animateMotion dur="20s" repeatCount="indefinite" path="M0,0 C40,-8 80,3 120,-3 C160,-10 200,5 280,-8 L320,0" />}
            </path>
            <path d="M410,97 Q413,92 416,96 Q419,92 422,97" fill="none" stroke="#6B5B45" strokeWidth="0.5">
              {!motionReduced && <animateMotion dur="22s" repeatCount="indefinite" path="M0,0 C30,-6 60,4 100,-4 C140,-8 180,2 240,-6 L280,0" />}
            </path>
          </g>
        </svg>

        {/* ── Waypoint hover card (HTML overlay over the SVG) ──── */}
        {pins.map((pin) => {
          if (hovered !== pin.id) return null;
          const meta = scen.townMeta(pin.id);
          const leader = leaders[pin.id];
          const chipColor = leader ? scen.optionColor(leader) : "rgba(154,142,128,0.9)";
          const resident = firstResident[pin.id];
          return (
            <div
              key={`hover-${pin.id}`}
              className="map-hover-card pixel-frame"
              style={{
                left: `${(pin.cx / 1000) * 100}%`,
                top: `${(pin.cy / 620) * 100}%`,
              }}
              role="tooltip"
              aria-hidden="true"
            >
              <div className="map-hover-card-preview-frame pixel-frame pixel-frame--quiet">
                <div className="map-hover-card-preview-fallback" aria-hidden="true">
                  {!meta.map?.preview_path || previewFailed[pin.id]
                    ? "Preview unavailable"
                    : `Opening ${meta.name}`}
                </div>
                {!previewFailed[pin.id] && meta.map?.preview_path && (
                  <img
                    className="map-hover-card-preview"
                    src={appUrl(meta.map.preview_path)}
                    alt=""
                    onError={() =>
                      setPreviewFailed((m) => (m[pin.id] ? m : { ...m, [pin.id]: true }))
                    }
                  />
                )}
              </div>
              <div className="map-hover-card-row">
                {resident && (
                  <SpritePortrait
                    agentId={resident.id}
                    spriteKey={resident.sprite_key}
                    accessoryKey={resident.accessory_key}
                    fallbackInitials={resident.initials}
                    color={resident.color || meta.color}
                    size={22}
                  />
                )}
                <span className="map-hover-card-name">{meta.name}</span>
              </div>
              <span
                className="map-hover-card-chip"
                style={{
                  background: leader
                    ? withAlpha(chipColor, "1F", "color-mix(in srgb, currentColor 12%, transparent)")
                    : "rgba(154,142,128,0.1)",
                  color: leader ? chipColor : "var(--text-muted)",
                  borderColor: leader
                    ? withAlpha(chipColor, "55", "color-mix(in srgb, currentColor 34%, transparent)")
                    : "rgba(154,142,128,0.35)",
                }}
              >
                <span className="map-hover-card-chip-dot" style={{ background: chipColor }} />
                {leader ? `Leading: ${scen.optionLabel(leader)}` : "No leader yet"}
              </span>
            </div>
          );
        })}

        {/* ── Ambient resident speech bubble ──────────────────── */}
        {ambient && hovered !== ambient.town && (() => {
          const pin = pins.find((p) => p.id === ambient.town);
          if (!pin) return null;
          return (
            <div
              key={ambient.seq}
              className="map-ambient-bubble"
              aria-hidden="true"
              style={{
                left: `${(pin.cx / 1000) * 100}%`,
                top: `${((pin.cy - 40) / 620) * 100}%`,
              }}
            >
              <span className="map-ambient-bubble-name">{ambient.name}</span>
              <span className="map-ambient-bubble-text">{ambient.text}</span>
            </div>
          );
        })()}

        {/* ── Ambient Floating Particles ──────────────────────── */}
        <div className="ambient-particles">
          <span className="ambient-particle" style={{ left: "12%", bottom: "8%", animation: "particle-float-0 14s 0s infinite", opacity: 0.2 }} />
          <span className="ambient-particle" style={{ left: "28%", bottom: "15%", animation: "particle-float-1 12s 1s infinite", opacity: 0.18 }} />
          <span className="ambient-particle" style={{ left: "45%", bottom: "22%", animation: "particle-float-2 16s 2.5s infinite", opacity: 0.22 }} />
          <span className="ambient-particle" style={{ left: "62%", bottom: "10%", animation: "particle-float-3 11s 0.5s infinite", opacity: 0.15 }} />
          <span className="ambient-particle" style={{ left: "78%", bottom: "30%", animation: "particle-float-0 18s 4s infinite", opacity: 0.2 }} />
          <span className="ambient-particle" style={{ left: "15%", bottom: "40%", animation: "particle-float-1 13s 3s infinite", opacity: 0.17 }} />
          <span className="ambient-particle" style={{ left: "35%", bottom: "5%", animation: "particle-float-2 15s 6s infinite", opacity: 0.25 }} />
          <span className="ambient-particle" style={{ left: "55%", bottom: "35%", animation: "particle-float-3 10s 2s infinite", opacity: 0.19 }} />
          <span className="ambient-particle" style={{ left: "85%", bottom: "18%", animation: "particle-float-0 17s 8s infinite", opacity: 0.16 }} />
          <span className="ambient-particle" style={{ left: "22%", bottom: "48%", animation: "particle-float-1 14s 5s infinite", opacity: 0.21 }} />
          <span className="ambient-particle" style={{ left: "70%", bottom: "42%", animation: "particle-float-2 12s 7s infinite", opacity: 0.18 }} />
          <span className="ambient-particle" style={{ left: "40%", bottom: "12%", animation: "particle-float-3 16s 9s infinite", opacity: 0.23 }} />
          <span className="ambient-particle" style={{ left: "90%", bottom: "25%", animation: "particle-float-0 11s 10s infinite", opacity: 0.15 }} />
          <span className="ambient-particle" style={{ left: "50%", bottom: "50%", animation: "particle-float-1 18s 12s infinite", opacity: 0.2 }} />
        </div>
      </div>

      {/* ── Decision Info Banner ──────────────────────────────── */}
      <div
        className="mt-6 max-w-2xl w-full rounded-xl px-6 py-4 text-center relative overflow-hidden"
        style={{
          background: "var(--warm-glass)",
          backdropFilter: "blur(var(--warm-glass-blur))",
          WebkitBackdropFilter: "blur(var(--warm-glass-blur))",
          borderWidth: "1px",
          borderStyle: "solid",
          borderColor: "rgba(196, 163, 90, 0.3) var(--warm-glass-border) var(--warm-glass-border)",
          animation: "stagger-in 0.5s var(--ease-genshin) backwards",
          animationDelay: "500ms",
        }}
      >
        {/* Top-left corner ornament */}
        <svg className="absolute top-2 left-2" width="20" height="20" viewBox="0 0 20 20" opacity="0.25">
          <path d="M0,15 L0,3 C0,1.5 1.5,0 3,0 L15,0" fill="none" stroke="var(--gold-accent)" strokeWidth="1.5" />
          <circle cx="0" cy="15" r="1.5" fill="var(--gold-accent)" />
        </svg>
        {/* Bottom-right corner ornament */}
        <svg className="absolute bottom-2 right-2" width="20" height="20" viewBox="0 0 20 20" opacity="0.25">
          <path d="M20,5 L20,17 C20,18.5 18.5,20 17,20 L5,20" fill="none" stroke="var(--gold-accent)" strokeWidth="1.5" />
          <circle cx="20" cy="5" r="1.5" fill="var(--gold-accent)" />
        </svg>
        <p style={{
          fontFamily: "var(--font-display)",
          color: "var(--gold-ink)",
          fontSize: "14px",
          fontWeight: 600,
        }}>
          {dday ? `Decision day — ${dday}` : scen.title}
        </p>
        <p className="mt-1" style={{
          fontFamily: "var(--font-body)",
          color: "var(--text-secondary)",
          fontSize: "12px",
        }}>
          {scen.scenario.dates?.prose || scen.question}
        </p>
      </div>

      {/* ── Town Cards ───────────────────────────────────────── */}
      <div className="mt-6 district-town-cards max-w-3xl w-full">
        {townIds.map((id, idx) => {
          const meta = scen.townMeta(id);
          const isActive = hovered === id;
          return (
            <button
              key={id}
              onClick={() => goToTown(id)}
              className="rounded-xl px-4 py-3 text-left hover:scale-[1.03] active:scale-[0.98]"
              style={{
                background: isActive
                  ? `linear-gradient(135deg, rgba(${hexToRgb(meta.color)},0.08), var(--card-bg))`
                  : "var(--card-bg)",
                borderWidth: "1.5px 1.5px 1.5px 3px",
                borderStyle: "solid",
                borderColor: `${isActive ? meta.color : "var(--card-border)"} ${isActive ? meta.color : "var(--card-border)"} ${isActive ? meta.color : "var(--card-border)"} ${meta.color}`,
                boxShadow: isActive
                  ? `0 4px 16px rgba(${hexToRgb(meta.color)},0.15)`
                  : "var(--card-shadow)",
                transition: "all 250ms cubic-bezier(0.22, 1, 0.36, 1)",
                animation: "stagger-in 0.5s var(--ease-genshin) backwards",
                animationDelay: `${600 + idx * 100}ms`,
              }}
              onMouseEnter={() => setHovered(id)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(id)}
              onBlur={() => setHovered(null)}
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
                <span style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "14px",
                  fontWeight: 600,
                  color: "var(--text-primary)",
                }}>
                  {meta.name}
                </span>
              </div>
              {meta.tagline && (
                <p style={{
                  fontFamily: "var(--font-body)",
                  fontSize: "12px",
                  fontStyle: "italic",
                  color: "var(--text-secondary)",
                }}>
                  {meta.tagline}
                </p>
              )}
              {meta.population && (
                <p className="mt-1" style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "var(--text-secondary)",
                }}>
                  {meta.population}
                </p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  return `${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)}`;
}
