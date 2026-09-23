/* ── DemoTimeline ────────────────────────────────────────────
 *
 * The media bar for the zero-backend demo replay: a bottom-center parchment
 * card (gold accents, pixel-frame border) with play/pause, speed toggle, a
 * scrubber with round-chapter ticks + tooltips, elapsed label, and a
 * "LIVE REPLAY" badge.
 *
 * Keyboard: Space play/pause, ←/→ seek (without stealing focused controls).
 * Renders nothing outside demo mode (DemoPlayerContext is null there).
 * ─────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState } from "react";
import { useDemoPlayer } from "../demo/DemoPlayerContext";
import { useWebSocketContext } from "../context/WebSocketContext";
import { useScenario } from "../hooks/useScenario";
import { DEMO_SPEEDS } from "../demo/pacing";
import type { DemoChapter } from "../hooks/useDemoFeed";
import { REPO_URL } from "../demo/demoMode";
import { chapterTitle, formatDate, formatDay, isWeekend, weekdayInitial } from "../lib/calendar";

/** Events to jump per arrow-key press — a couple of beats of content. */
const ARROW_SEEK_EVENTS = 15;

function fmtClock(hour: number | null, minute: number | null): string | null {
  if (hour == null) return null;
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const mm = String(minute ?? 0).padStart(2, "0");
  return `${h12}:${mm} ${hour < 12 ? "AM" : "PM"}`;
}

function isInteractiveTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    tag === "BUTTON" ||
    tag === "A" ||
    el.isContentEditable ||
    el.closest('[role="slider"]') !== null
  );
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
      // Let focused controls keep their native keyboard behavior. The track
      // has its own slider handler below; this global transport is for the
      // rest of the page only.
      if (isInteractiveTarget(e.target)) return;
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
      <div className="demo-timeline demo-timeline--error pixel-frame" role="alert">
        <span>
          Replay unavailable —{" "}
          <a href={REPO_URL} target="_blank" rel="noreferrer">run Township locally</a> with zero keys required.
        </span>
      </div>
    );
  }
  if (!player.ready) {
    return (
      <div className="demo-timeline demo-timeline--loading pixel-frame" role="status" aria-live="polite">
        <span className="demo-timeline-loading-mark" aria-hidden="true" />
        <span>Preparing the town replay…</span>
      </div>
    );
  }

  const pct = player.duration > 0 ? (player.position / player.duration) * 100 : 0;
  const round = ws.currentRound;
  const totalRounds = ws.totalRounds || scen.totalRounds;
  // Round numbering starts at 0 (the seed round) — 0 is a real round, only
  // "no round yet" (before the first round_started) shows the dash.
  const roundLabel = ws.totalRounds > 0 ? String(round) : "–";
  const clock = fmtClock(ws.worldClock.hour, ws.worldClock.minute);
  const atStart = player.position === 0 && !player.playing;
  // A recorded campaign counts in days; the fixed replay keeps its rounds.
  const dayLabel = ws.calendar ? formatDay(ws.calendar) : null;
  const electionDate = scen.scenario.campaign?.election_date ?? scen.scenario.dates?.decision_day ?? null;

  return (
    <div className={`demo-timeline pixel-frame${scen.demoFeeds.length > 1 ? " demo-timeline--feeds" : ""}`} role="group" aria-label="Replay timeline">
      {/* Play / pause / replay-again */}
      <button
        className={`demo-timeline-play ${player.ended ? "demo-timeline-play--replay" : ""}`}
        onClick={player.toggle}
        aria-label={player.ended ? "Replay again" : player.playing ? "Pause replay" : "Play replay"}
        title={player.ended ? "Replay again" : player.playing ? "Pause (Space)" : "Play (Space)"}
      >
        {player.ended ? <ReplayIcon /> : player.playing ? <PauseIcon /> : <PlayIcon />}
      </button>

      {/* "Skip to the talk" — visible while paused before the first line of
          dialogue, so nobody has to sit through round-0 walking. */}
      {!player.playing && !player.ended && player.talkIndex >= 0 &&
        player.position <= player.talkIndex && (
        <button
          className="demo-timeline-skip"
          onClick={player.skipToTalk}
          title="Jump to the first conversation"
        >
          Skip to the talk ▸
        </button>
      )}

      {/* The slider and chapter buttons are siblings: interactive elements
          must never be nested inside another interactive ARIA widget. */}
      <div className={`demo-timeline-scrubber${player.chapters.length > 12 ? " demo-timeline-scrubber--dense" : ""}`}>
        <div
          ref={trackRef}
          className="demo-timeline-track"
          role="slider"
          aria-label="Replay position"
          aria-valuemin={0}
          aria-valuemax={player.duration}
          aria-valuenow={player.position}
          aria-valuetext={`Event ${player.position} of ${player.duration}${dayLabel ? `, ${dayLabel.toLowerCase()}` : ws.totalRounds > 0 ? `, round ${round}` : ""}`}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "ArrowRight") { e.preventDefault(); player.seekBy(ARROW_SEEK_EVENTS); }
            if (e.key === "ArrowLeft") { e.preventDefault(); player.seekBy(-ARROW_SEEK_EVENTS); }
            if (e.key === "Home") { e.preventDefault(); player.seekTo(0); }
            if (e.key === "End") { e.preventDefault(); player.seekTo(player.duration); }
            // Page keys jump a chapter (a day of the campaign, a round of the
            // one-day replay) — the keyboard's way through a dense tick row.
            if (e.key === "PageUp") {
              e.preventDefault();
              const next = player.chapters.find((c) => c.index >= player.position);
              if (next) player.seekTo(next.index + 1);
            }
            if (e.key === "PageDown") {
              e.preventDefault();
              const prev = [...player.chapters].reverse().find((c) => c.index + 1 < player.position);
              player.seekTo(prev ? prev.index + 1 : 0);
            }
          }}
        >
          <div className="demo-timeline-rail" />
          <div className="demo-timeline-fill" style={{ width: `${pct}%` }} />
          <div className="demo-timeline-playhead" style={{ left: `${pct}%` }} aria-hidden="true" />
        </div>
        {/* Chapter ticks: a day of the campaign (weekday initial) or a round */}
        {player.chapters.map((ch, chapterIndex) => {
          const left = player.duration > 0 ? (ch.index / player.duration) * 100 : 0;
          // Preserve a full 24 px hit target even when early/late chapter
          // positions bunch near an edge. Each neighbor gets its own lane.
          // Each tick keeps a lane of its own so neighbours never stack: a
          // full 24 px hit target for a handful of rounds, tighter lanes for
          // a three-week campaign (the letters then show on hover/focus).
          const lane = player.chapters.length > 12 ? 8 : 24;
          const minimumLeft = 12 + chapterIndex * lane;
          const minimumRight = 12 + (player.chapters.length - 1 - chapterIndex) * lane;
          const chClock = fmtClock(ch.hour, ch.minute);
          const isDay = ch.kind === "day" && ch.day != null;
          const dayDate = isDay ? formatDate(ch.date, { weekday: true, comma: false }) : null;
          const ariaLabel = isDay
            ? `Skip to day ${ch.dayIndex ?? ch.day}${dayDate ? ` (${dayDate}${ch.label ? ` — ${ch.label}` : ""})` : ""}`
            : `Skip to round ${ch.round}${chClock ? ` (${chClock})` : ""}`;
          const electionTick = isDay && !!electionDate && ch.date === electionDate;
          const className = [
            "demo-timeline-tick",
            isDay ? "demo-timeline-tick--day" : "",
            isDay && isWeekend(ch.weekday) ? "demo-timeline-tick--weekend" : "",
            electionTick ? "demo-timeline-tick--election" : "",
          ].filter(Boolean).join(" ");
          const dense = player.chapters.length > 12;
          const tickStyle = { left: `clamp(${minimumLeft}px, ${left}%, calc(100% - ${minimumRight}px))` };
          const hover = {
            onMouseEnter: () => setHoverChapter(ch),
            onMouseLeave: () => setHoverChapter((c) => (c === ch ? null : c)),
          };
          const jump = (e: React.SyntheticEvent) => {
            e.stopPropagation();
            player.skipToRound(ch.round);
          };
          // A three-week campaign has too many chapters for 24 px targets in
          // one row: its ticks are pointer marks (hover for the tooltip) and
          // the slider's Page keys walk the days; a short replay keeps real
          // buttons.
          if (dense) {
            return (
              <span
                key={isDay ? `day-${ch.day}` : `round-${ch.round}`}
                className={`${className} demo-timeline-tick--mark`}
                style={tickStyle}
                aria-hidden="true"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={jump}
                {...hover}
              >
                {isDay && <span className="demo-timeline-tick-day">{weekdayInitial(ch.weekday)}</span>}
              </span>
            );
          }
          return (
            <button
              key={isDay ? `day-${ch.day}` : `round-${ch.round}`}
              className={className}
              style={tickStyle}
              aria-label={ariaLabel}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={jump}
              {...hover}
              onFocus={() => setHoverChapter(ch)}
              onBlur={() => setHoverChapter((c) => (c === ch ? null : c))}
            >
              {isDay && <span className="demo-timeline-tick-day" aria-hidden="true">{weekdayInitial(ch.weekday)}</span>}
            </button>
          );
        })}
        {/* Chapter tooltip: "Day 6 · Sat Apr 11 · Saturday market in Dover" / "Round 3 — 4:00 PM" */}
        {hoverChapter && player.duration > 0 && (
          <div
            className="demo-timeline-tooltip"
            style={{ left: `${(hoverChapter.index / player.duration) * 100}%` }}
            role="tooltip"
          >
            {hoverChapter.kind === "day" && hoverChapter.day != null
              ? chapterTitle(hoverChapter)
              : `Round ${hoverChapter.round}${fmtClock(hoverChapter.hour, hoverChapter.minute)
                ? ` — ${fmtClock(hoverChapter.hour, hoverChapter.minute)}`
                : ""}`}
          </div>
        )}
      </div>

      {/* Elapsed label */}
      <div className="demo-timeline-elapsed" aria-live="off">
        {player.ended
          ? "The town has decided"
          : atStart
            ? "Ready"
            : dayLabel
              ? `${dayLabel}${clock ? ` · ${clock}` : ""}`
              : `Round ${roundLabel}/${totalRounds || "–"}${clock ? ` · ${clock}` : ""}`}
      </div>

      {/* Which recording: a scenario can ship several (the one-day
          deliberation, the full campaign). Switching reloads the page with
          ?feed=<id> — a different recording is a different replay. */}
      {scen.demoFeeds.length > 1 && (
        <select
          className="demo-timeline-feed"
          value={scen.demoFeed?.id ?? scen.demoFeeds[0].id}
          onChange={(e) => {
            const url = new URL(window.location.href);
            url.searchParams.set("feed", e.target.value);
            window.location.assign(url.toString());
          }}
          aria-label="Recording"
          title="Recording"
        >
          {scen.demoFeeds.map((f) => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>
      )}

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
