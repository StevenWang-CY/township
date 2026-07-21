/* ── DemoTimeline ────────────────────────────────────────────
 *
 * The media bar for the zero-backend demo replay: a bottom-center parchment
 * card (gold accents, pixel-frame border) with play/pause, speed toggle, a
 * scrubber with round-chapter ticks + tooltips, elapsed label, and a
 * "LIVE REPLAY" badge.
 *
 * Keyboard: Space play/pause, ←/→ seek (ignored while typing in inputs).
 * Renders nothing outside demo mode (DemoPlayerContext is null there).
 * ─────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState } from "react";
import { useDemoPlayer } from "../demo/DemoPlayerContext";
import { useWebSocketContext } from "../context/WebSocketContext";
import { useScenario } from "../hooks/useScenario";
import { DEMO_SPEEDS } from "../demo/pacing";
import type { DemoChapter } from "../hooks/useDemoFeed";
import { REPO_URL } from "../demo/demoMode";

/** Events to jump per arrow-key press — a couple of beats of content. */
const ARROW_SEEK_EVENTS = 15;

function fmtClock(hour: number | null, minute: number | null): string | null {
  if (hour == null) return null;
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const mm = String(minute ?? 0).padStart(2, "0");
  return `${h12}:${mm} ${hour < 12 ? "AM" : "PM"}`;
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/* Chunky, slightly pixel play/pause/replay glyphs. */
function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M3 2h2v10H3zM5 3h2v8H5zM7 4h2v6H7zM9 5h2v4H9zM11 6h1v2h-1z" fill="currentColor" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <rect x="3" y="2" width="3" height="10" fill="currentColor" />
      <rect x="8" y="2" width="3" height="10" fill="currentColor" />
    </svg>
  );
}
function ReplayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M12 7a5 5 0 1 1-1.5-3.55" strokeLinecap="square" />
      <path d="M12 1.5V4h-2.5" strokeLinecap="square" strokeLinejoin="miter" />
    </svg>
  );
}

export default function DemoTimeline() {
  const player = useDemoPlayer();
  const ws = useWebSocketContext();
  const scen = useScenario();
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [hoverChapter, setHoverChapter] = useState<DemoChapter | null>(null);

  /* Keyboard transport — registered whenever the timeline is mounted. */
  useEffect(() => {
    if (!player || !player.ready) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.code === "Space") {
        e.preventDefault();
        player.toggle();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        player.seekBy(ARROW_SEEK_EVENTS);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        player.seekBy(-ARROW_SEEK_EVENTS);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player]);

  const seekFromPointer = useCallback(
    (clientX: number) => {
      if (!player || !trackRef.current || player.duration === 0) return;
      const rect = trackRef.current.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      player.seekTo(Math.round(frac * player.duration));
    },
    [player],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      draggingRef.current = true;
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      seekFromPointer(e.clientX);
    },
    [seekFromPointer],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (draggingRef.current) seekFromPointer(e.clientX);
    },
    [seekFromPointer],
  );
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    } catch { /* ignore */ }
  }, []);

  if (!player) return null;

  /* Feed failed to load — a quiet, honest card instead of a dead bar. */
  if (player.error) {
    return (
      <div className="demo-timeline demo-timeline--error" role="status">
        <span>
          Replay unavailable —{" "}
          <a href={REPO_URL} target="_blank" rel="noreferrer">run Township locally</a> in 60 seconds, zero keys.
        </span>
      </div>
    );
  }
  if (!player.ready) return null;

  const pct = player.duration > 0 ? (player.position / player.duration) * 100 : 0;
  const round = ws.currentRound;
  const totalRounds = ws.totalRounds || scen.totalRounds;
  // Round numbering starts at 0 (the seed round) — 0 is a real round, only
  // "no round yet" (before the first round_started) shows the dash.
  const roundLabel = ws.totalRounds > 0 ? String(round) : "–";
  const clock = fmtClock(ws.worldClock.hour, ws.worldClock.minute);
  const atStart = player.position === 0 && !player.playing;

  return (
    <div className="demo-timeline" role="group" aria-label="Replay timeline">
      {/* LIVE REPLAY badge */}
      <div className="demo-timeline-badge" title={scen.title}>
        <span className="demo-timeline-badge-dot" aria-hidden="true" />
        <span className="demo-timeline-badge-text">
          Live replay · <em>{scen.title}</em>
        </span>
      </div>

      {/* Play / pause / replay-again */}
      <button
        className={`demo-timeline-play ${player.ended ? "demo-timeline-play--replay" : ""}`}
        onClick={player.toggle}
        aria-label={player.ended ? "Replay again" : player.playing ? "Pause replay" : "Play replay"}
        title={player.ended ? "Replay again" : player.playing ? "Pause (Space)" : "Play (Space)"}
      >
        {player.ended ? <ReplayIcon /> : player.playing ? <PauseIcon /> : <PlayIcon />}
      </button>

      {/* Scrubber */}
      <div
        ref={trackRef}
        className="demo-timeline-track"
        role="slider"
        aria-label="Replay position"
        aria-valuemin={0}
        aria-valuemax={player.duration}
        aria-valuenow={player.position}
        aria-valuetext={`Event ${player.position} of ${player.duration}${round ? `, round ${round}` : ""}`}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") { e.preventDefault(); player.seekBy(ARROW_SEEK_EVENTS); }
          if (e.key === "ArrowLeft") { e.preventDefault(); player.seekBy(-ARROW_SEEK_EVENTS); }
        }}
      >
        <div className="demo-timeline-rail" />
        <div className="demo-timeline-fill" style={{ width: `${pct}%` }} />
        {/* Round-chapter ticks */}
        {player.chapters.map((ch) => {
          const left = player.duration > 0 ? (ch.index / player.duration) * 100 : 0;
          const chClock = fmtClock(ch.hour, ch.minute);
          return (
            <button
              key={ch.round}
              className="demo-timeline-tick"
              style={{ left: `${left}%` }}
              aria-label={`Skip to round ${ch.round}${chClock ? ` (${chClock})` : ""}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                player.skipToRound(ch.round);
              }}
              onMouseEnter={() => setHoverChapter(ch)}
              onMouseLeave={() => setHoverChapter((c) => (c === ch ? null : c))}
              onFocus={() => setHoverChapter(ch)}
              onBlur={() => setHoverChapter((c) => (c === ch ? null : c))}
            />
          );
        })}
        {/* Chapter tooltip */}
        {hoverChapter && player.duration > 0 && (
          <div
            className="demo-timeline-tooltip"
            style={{ left: `${(hoverChapter.index / player.duration) * 100}%` }}
            role="tooltip"
          >
            Round {hoverChapter.round}
            {fmtClock(hoverChapter.hour, hoverChapter.minute)
              ? ` — ${fmtClock(hoverChapter.hour, hoverChapter.minute)}`
              : ""}
          </div>
        )}
        {/* Playhead */}
        <div className="demo-timeline-playhead" style={{ left: `${pct}%` }} aria-hidden="true" />
      </div>

      {/* Elapsed label */}
      <div className="demo-timeline-elapsed" aria-live="off">
        {player.ended
          ? "The town has decided"
          : atStart
            ? "Ready"
            : `Round ${roundLabel}/${totalRounds || "–"}${clock ? ` · ${clock}` : ""}`}
      </div>

      {/* Speed toggle */}
      <button
        className="demo-timeline-speed"
        onClick={() => {
          const i = DEMO_SPEEDS.indexOf(player.speed);
          player.setSpeed(DEMO_SPEEDS[(i + 1) % DEMO_SPEEDS.length]);
        }}
        aria-label={`Playback speed ${player.speed}x — click to change`}
        title="Playback speed"
      >
        {player.speed}×
      </button>
    </div>
  );
}
