import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import OpinionChart from "./OpinionChart";
import AgentCard from "./AgentCard";
import PlayerHUD from "./PlayerHUD";
import { useUserProfile } from "../context/UserProfileContext";
import { useRelationships } from "../hooks/useRelationships";
import { useSimulation } from "../hooks/useSimulation";
import type { AgentState, TownId, LeanId, DistrictSummary, SimulationEvent, SimulationEndedEvent, OpinionChangedEvent, Relationship, NewsReaction } from "../types/messages";
import { useScenario } from "../hooks/useScenario";
import { DEMO_MODE } from "../demo/demoMode";
import { appUrl } from "../lib/assetUrl";
import { readableInk } from "../lib/color";

/** Narrative recap of a persisted run (see /api/runs). */
interface RunRecap {
  runId: string;
  headline: string;
  markdown: string | null;
  endedAt?: string | null;
}

/** Minimal markdown split: "# Title" first line + prose paragraphs.
 *  Blockquote paragraphs (the responsible-use notice) become styled notes;
 *  bold markers are stripped rather than rendered. */
function parseRecap(markdown: string): {
  title: string | null;
  paragraphs: Array<{ text: string; note: boolean }>;
} {
  const trimmed = markdown.trim();
  const lines = trimmed.split("\n");
  let title: string | null = null;
  let body = trimmed;
  if (lines[0]?.startsWith("# ")) {
    title = lines[0].slice(2).trim();
    body = lines.slice(1).join("\n").trim();
  }
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, " ").trim())
    .filter(Boolean)
    .map((p) => {
      const note = p.startsWith(">");
      const text = p.replace(/^(?:>\s*)+/, "").replace(/\*\*/g, "").trim();
      return { text, note };
    });
  return { title, paragraphs };
}

interface DashboardProps {
  ws: {
    agents: Record<string, AgentState>;
    townSummaries: Record<TownId, any>;
    connected: boolean;
    currentRound: number;
    totalRounds?: number;
    simulationRunning: boolean;
    events?: SimulationEvent[];
    eventCursor?: number;
    relationships?: Record<string, Relationship>;
    newsReactions?: NewsReaction[];
  };
}

export default function Dashboard({ ws }: DashboardProps) {
  const navigate = useNavigate();
  const scen = useScenario();
  const { townMeta, optionColor, optionLabel, stanceIds, undecidedId } = scen;
  const [filter, setFilter] = useState<"all" | TownId | LeanId>("all");
  const [results, setResults] = useState<DistrictSummary | null>(null);
  const { profile } = useUserProfile();
  const { trustFor } = useRelationships(profile?.playerId);
  const { startSimulation, loading: simStartLoading, error: simStartError } = useSimulation();
  const [replayLoading, setReplayLoading] = useState(false);

  // Fetch results — backend now returns a flat DistrictSummary (no envelope).
  const refetchResults = useCallback(() => {
    if (DEMO_MODE) return;
    fetch("/api/simulation/results")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        // Tolerate both flat and legacy {summary: {...}} envelopes.
        const flat = d.town_summaries ? d : (d.summary ?? null);
        if (flat) setResults(flat as DistrictSummary);
      })
      .catch(() => { /* leave demo data alone */ });
  }, []);

  useEffect(() => {
    refetchResults();
  }, [refetchResults]);

  // ── Narrative recap of the latest persisted run ──────────────
  // The backend writes runs/<id>/summary.json (recap included) after every
  // completed simulation; surface it here so a finished run has a payoff.
  const [latestRun, setLatestRun] = useState<RunRecap | null>(null);
  const [justCompleted, setJustCompleted] = useState(false);
  const knownRunIdRef = useRef<string | null>(null);
  const recapPollRef = useRef<number | undefined>(undefined);

  const scenarioId = scen.scenario.id;
  const fetchLatestRun = useCallback(async (): Promise<RunRecap | null> => {
    if (DEMO_MODE) return null;
    try {
      const list = await fetch("/api/runs").then((r) => (r.ok ? r.json() : null));
      // Only surface runs of the scenario this dashboard is showing — a
      // Millbrook recap under the NJ-11 header reads as a data leak.
      const newest = list?.runs?.find(
        (r: { scenario_id?: string }) => !r.scenario_id || r.scenario_id === scenarioId,
      );
      if (!newest?.run_id) return null;
      const detail = await fetch(`/api/runs/${encodeURIComponent(newest.run_id)}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      return {
        runId: newest.run_id,
        headline: newest.headline || "",
        markdown: detail?.recap_markdown ?? null,
        endedAt: newest.ended_at ?? null,
      };
    } catch {
      return null;
    }
  }, [scenarioId]);

  useEffect(() => {
    if (DEMO_MODE) return;
    let cancelled = false;
    fetchLatestRun().then((run) => {
      if (cancelled || !run) return;
      knownRunIdRef.current = run.runId;
      setLatestRun(run);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(recapPollRef.current);
    };
  }, [fetchLatestRun]);

  // When the simulation finishes (running → not running), refetch results
  // and poll for the freshly persisted run's recap (it lands moments later).
  const [wasRunning, setWasRunning] = useState(false);
  useEffect(() => {
    if (ws.simulationRunning) {
      setWasRunning(true);
      setJustCompleted(false);
    } else if (wasRunning && !ws.simulationRunning) {
      setWasRunning(false);
      refetchResults();
      setJustCompleted(true);
      if (!DEMO_MODE) {
        let attempts = 0;
        const poll = async () => {
          attempts += 1;
          const run = await fetchLatestRun();
          if (run && run.runId !== knownRunIdRef.current) {
            knownRunIdRef.current = run.runId;
            setLatestRun(run);
            return;
          }
          if (attempts < 10) recapPollRef.current = window.setTimeout(poll, 1600);
        };
        recapPollRef.current = window.setTimeout(poll, 800);
      }
    }
  }, [ws.simulationRunning, wasRunning, refetchResults, fetchLatestRun]);

  const handleStart = useCallback(async () => {
    if (ws.simulationRunning) return;
    // No round count: the backend runs the scenario's full round plan.
    await startSimulation();
  }, [startSimulation, ws.simulationRunning]);

  // After a replay kicks off, point at where it can actually be WATCHED.
  const [replayStarted, setReplayStarted] = useState(false);
  const handleReplay = useCallback(async () => {
    setReplayLoading(true);
    try {
      const res = await fetch("/api/simulation/replay", { method: "POST" });
      if (res.ok) setReplayStarted(true);
    } catch { /* silent */ }
    setReplayLoading(false);
  }, []);

  // Zero-backend demo: /api/simulation/results never answers, but the replay
  // stream carries the same DistrictSummary on its simulation_ended event —
  // seek to the end of the timeline and the dashboard fills in.
  const streamedSummary = useMemo<DistrictSummary | null>(() => {
    const evts = ws.events ?? [];
    for (let i = evts.length - 1; i >= 0; i--) {
      if (evts[i].type === "simulation_ended") {
        return (evts[i] as SimulationEndedEvent).summary ?? null;
      }
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.eventCursor, ws.events]);

  const summaryData = results ?? streamedSummary;

  const allAgents = Object.values(ws.agents);
  const hasLiveAgents = allAgents.length > 0;
  // Scenario town roster, plus any stray towns present in the agent stream.
  const towns: TownId[] = useMemo(() => {
    const roster = scen.scenario.towns.map((t) => t.id);
    for (const a of allAgents) {
      if (a.town && !roster.includes(a.town)) roster.push(a.town);
    }
    return roster;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scen.scenario, allAgents.length]);

  const emptyOpinions = useCallback((): Record<LeanId, number> => {
    const out: Record<LeanId, number> = {};
    for (const k of stanceIds) out[k] = 0;
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stanceIds.join("|")]);

  // Compute opinions per town. Live AgentState wins; before a new run starts,
  // keep the latest persisted summary visible instead of pairing old insight
  // prose with an empty donut.
  const townOpinions = useMemo(() => {
    const result: Record<TownId, Record<LeanId, number>> = {};
    for (const t of towns) result[t] = emptyOpinions();
    if (allAgents.length > 0) {
      for (const a of allAgents) {
        const lean = (a.opinion?.candidate as LeanId) || undecidedId;
        if (result[a.town]) result[a.town][lean] = (result[a.town][lean] || 0) + 1;
      }
    } else {
      for (const summary of summaryData?.town_summaries ?? []) {
        if (!result[summary.town]) result[summary.town] = emptyOpinions();
        for (const [lean, count] of Object.entries(summary.opinions ?? {})) {
          result[summary.town][lean] = count;
        }
      }
    }
    return result;
  }, [allAgents, towns, emptyOpinions, undecidedId, summaryData]);

  const overallOpinions = useMemo(() => {
    const total = emptyOpinions();
    for (const t of towns) {
      for (const k of Object.keys(townOpinions[t] || {})) {
        total[k] = (total[k] || 0) + townOpinions[t][k];
      }
    }
    return total;
  }, [townOpinions, towns, emptyOpinions]);

  const opinionTotal = useMemo(
    () => Object.values(overallOpinions).reduce((sum, count) => sum + count, 0),
    [overallOpinions],
  );
  const hasOpinionData = opinionTotal > 0;

  // Filtered agents
  const filteredAgents = useMemo(() => {
    if (allAgents.length === 0) return [];
    if (filter === "all") return allAgents;
    if (towns.includes(filter)) {
      return allAgents.filter((a) => a.town === filter);
    }
    return allAgents.filter((a) => (a.opinion?.candidate || undecidedId) === filter);
  }, [allAgents, filter, towns, undecidedId]);

  const consensusZones = summaryData?.consensus_zones || [];
  const faultLines = summaryData?.fault_lines || [];

  // Scoreboard shell only exists when it has content: the demo's Recorded
  // chip, or a real player's quest chips over a populated district. An idle
  // live visit (no agents streaming, nothing running) must never open on a
  // blank strip.
  const showScoreboard =
    DEMO_MODE || (profile !== null && (hasLiveAgents || ws.simulationRunning));

  // True cold visit (live build, nothing has ever run): lead with the
  // pixel-illustration hero instead of an empty sentiment card.
  const preRun = !DEMO_MODE && !ws.simulationRunning && !hasLiveAgents && !hasOpinionData;
  const heroTown = scen.scenario.towns[0];

  return (
    <div
      className="max-w-7xl mx-auto px-6 py-6"
      style={{ background: "var(--bg-cream)" }}
    >
      {/* Header */}
      <div className="mb-6" style={{ animation: "stagger-in 0.5s var(--ease-genshin) backwards" }}>
        <h1
          className="text-3xl"
          style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)", fontWeight: 600, letterSpacing: "1px" }}
        >
          District Dashboard
        </h1>
        {/* Ornamental separator */}
        <svg width="140" height="10" viewBox="0 0 140 10" className="mt-1.5 mb-1">
          <defs>
            <linearGradient id="dash-sep" x1="0%" y1="50%" x2="100%" y2="50%">
              <stop offset="0%" stopColor="var(--gold-accent)" stopOpacity="0" />
              <stop offset="30%" stopColor="var(--gold-accent)" stopOpacity="0.35" />
              <stop offset="50%" stopColor="var(--gold-accent)" stopOpacity="0.5" />
              <stop offset="70%" stopColor="var(--gold-accent)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="var(--gold-accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line x1="0" y1="5" x2="140" y2="5" stroke="url(#dash-sep)" strokeWidth="1" />
          <rect x="64" y="1.5" width="7" height="7" rx="1" transform="rotate(45 67.5 5)" fill="var(--gold-accent)" opacity="0.45" />
        </svg>
        <p className="text-sm" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-body)" }}>
          {`Cross-town comparison — ${scen.title}`}
          {ws.simulationRunning && ` | Round ${ws.currentRound}`}
        </p>
      </div>

      {/* Completion announcement — a finished run must never end silently. */}
      {justCompleted && !ws.simulationRunning && (
        <div className="dashboard-complete-banner" role="status" aria-live="polite">
          <span className="dashboard-complete-mark" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M3 8.5l3.2 3.2L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <p>
            <strong>{DEMO_MODE ? "Replay complete." : "Simulation complete."}</strong>{" "}
            {hasOpinionData ? `${opinionTotal} residents have settled where they stand` : "The district has settled"}
            {DEMO_MODE || !latestRun ? " — final tallies below." : " — the narrative recap is below."}
          </p>
          <button
            type="button"
            className="dashboard-complete-dismiss"
            onClick={() => setJustCompleted(false)}
            aria-label="Dismiss completion notice"
          >
            ×
          </button>
        </div>
      )}

      {/* Scoreboard banner — Met/★ quest chrome exists only when a real
          player walks the towns (never in the hosted replay). Hidden
          entirely when there is nothing to put in it. */}
      {showScoreboard && (
      <div className="dashboard-scoreboard">
        <PlayerHUD
          compact
          totalAgents={allAgents.length || undefined}
          round={ws.currentRound}
          totalRounds={ws.totalRounds}
        />
        {!DEMO_MODE && profile && (
          <div className="dashboard-scoreboard-towns">
            {towns.map((t) => {
              const meta = townMeta(t);
              const townAgentIds = Object.values(ws.agents).filter((a) => a.town === t).map((a) => a.id);
              const metInTown = townAgentIds.filter((id) => profile?.metAgents?.includes(id)).length;
              const persuadedInTown = townAgentIds.filter((id) => profile?.persuadedAgents?.includes(id)).length;
              const total = townAgentIds.length || 0;
              return (
                <div key={t} className="dashboard-scoreboard-town" style={{ borderLeft: `3px solid ${meta.color}` }}>
                  <strong>{meta.name}</strong>
                  <span>Met {metInTown}{total > 0 ? ` / ${total}` : ""}</span>
                  <span style={{ color: "var(--gold-ink)" }}>★ {persuadedInTown}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      )}

      {/* Pre-run hero — a fresh district opens on the town itself, not on
          empty chart chrome. */}
      {preRun ? (
        <section className="dashboard-hero-empty" aria-label="No simulation has run yet">
          {heroTown?.map?.preview_path && (
            <img
              className="dashboard-hero-empty-illustration pixel-frame"
              src={appUrl(heroTown.map.preview_path)}
              alt=""
              aria-hidden="true"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          )}
          <div className="dashboard-hero-empty-body">
            <h2>{latestRun ? "The district is quiet" : "The district is waiting"}</h2>
            <p>
              {latestRun
                ? "No simulation is running — the last run's recap is below. Start a fresh run to watch the residents of "
                : "Nothing has been simulated yet. Start a run to watch the residents of "}
              {towns.length} towns deliberate <em>{scen.scenario.question}</em> — or wander
              into {heroTown?.name ?? "a town"} and meet them first.
            </p>
            <div className="dashboard-hero-empty-actions">
              <button
                type="button"
                className="dashboard-hero-empty-start"
                onClick={handleStart}
                disabled={simStartLoading}
                title={`Start a fresh ${scen.totalRounds}-round simulation`}
              >
                {simStartLoading ? "Starting…" : "Start Simulation"}
              </button>
              {heroTown && (
                <button
                  type="button"
                  className="dashboard-hero-empty-visit"
                  onClick={() => navigate(`/town/${heroTown.id}`)}
                >
                  Visit {heroTown.name} →
                </button>
              )}
              {simStartError && (
                <span className="dashboard-inline-error text-xs" role="alert">
                  {simStartError}
                </span>
              )}
            </div>
          </div>
        </section>
      ) : (
      <div
        className="dashboard-overview rounded-xl px-6 py-5 mb-6 flex items-center gap-8"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--card-border)",
          boxShadow: "var(--shadow-soft)",
          animation: "stagger-in 0.5s var(--ease-genshin) backwards",
          animationDelay: "80ms",
        }}
      >
        <div style={{ filter: "drop-shadow(0 0 8px rgba(196,163,90,0.15))" }}>
          <OpinionChart opinions={overallOpinions} size={120} />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-sm mb-2" style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)", letterSpacing: "0.5px" }}>
            District-Wide Sentiment {hasOpinionData ? `(${opinionTotal} agents)` : ""}
          </h3>
          {hasOpinionData ? (
            <div className="flex gap-6 mb-3 flex-wrap">
              {stanceIds.map((k) => (
                <div key={k} className="text-center">
                  <div
                    className="text-2xl font-bold"
                    data-stance-id={k}
                    data-stance-count={overallOpinions[k] || 0}
                    style={{ color: readableInk(optionColor(k)) }}
                  >
                    {overallOpinions[k] || 0}
                  </div>
                  <div className="text-xs" style={{ color: "var(--township-ink-muted)" }}>
                    {optionLabel(k)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm mb-3 italic" style={{ color: "var(--township-ink-muted)" }}>
              Run a simulation to see live district sentiment.
            </p>
          )}
          {!hasLiveAgents && hasOpinionData && (
            <p className="dashboard-data-note">Latest completed run</p>
          )}

          {/* Simulation controls — hidden in the demo build; the replay
              timeline (bottom of the screen) is the transport there. */}
          {DEMO_MODE ? (
            <p className="text-xs italic" style={{ color: "var(--township-ink-muted)" }}>
              Scrub the replay timeline below — seek to the final round to see where the district lands.
            </p>
          ) : ws.simulationRunning ? (
            /* Mid-run: honest progress plus a focal action — go watch it. */
            <div className="dashboard-run-progress" role="status" aria-live="polite">
              <div className="dashboard-run-progress-meter">
                <span className="dashboard-run-progress-label">
                  Round {ws.currentRound} of {ws.totalRounds || scen.totalRounds}
                </span>
                <div className="dashboard-run-progress-track" aria-hidden="true">
                  <div
                    className="dashboard-run-progress-fill"
                    style={{
                      width: `${Math.min(100, Math.max(6, (ws.currentRound / (ws.totalRounds || scen.totalRounds || 1)) * 100))}%`,
                    }}
                  />
                </div>
              </div>
              {towns[0] && (
                <button
                  type="button"
                  className="dashboard-watch-live"
                  onClick={() => navigate(`/town/${towns[0]}`)}
                >
                  Watch it live in {townMeta(towns[0]).name} →
                </button>
              )}
            </div>
          ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleStart}
              disabled={simStartLoading}
              className="px-4 py-2 rounded-lg text-sm disabled:opacity-60"
              style={{
                background: "var(--gold-accent)",
                color: "var(--text-on-gold)",
                fontFamily: "var(--font-display)",
                fontWeight: 600,
                letterSpacing: "0.5px",
                transition: "all 200ms ease",
                cursor: "pointer",
                boxShadow: "0 2px 8px var(--gold-glow)",
              }}
              title={`Start a fresh ${scen.totalRounds}-round simulation`}
            >
              {simStartLoading ? "Starting…" : "Start Simulation"}
            </button>
            <button
              onClick={handleReplay}
              disabled={replayLoading}
              className="px-3 py-2 rounded-lg text-xs disabled:opacity-50"
              style={{
                background: "transparent",
                color: "var(--text-secondary)",
                border: "1px solid var(--card-border)",
                fontFamily: "var(--font-body)",
                transition: "all 200ms ease",
              }}
              title="Replay the last cached simulation run — watched in the Town view"
            >
              {replayLoading ? "Replaying…" : "Replay last run"}
            </button>
            {replayStarted && towns[0] && (
              <button
                type="button"
                className="dashboard-watch-live"
                onClick={() => navigate(`/town/${towns[0]}`)}
              >
                Replay started — watch it in the Town view →
              </button>
            )}
            {simStartError && (
              <span className="dashboard-inline-error text-xs" role="alert">
                {simStartError}
              </span>
            )}
          </div>
          )}
        </div>
      </div>
      )}

      {/* Narrative recap — the payoff of a finished deliberation. */}
      {!DEMO_MODE && latestRun && (latestRun.markdown || latestRun.headline) && (() => {
        const parsed = latestRun.markdown
          ? parseRecap(latestRun.markdown)
          : { title: latestRun.headline, paragraphs: [] as Array<{ text: string; note: boolean }> };
        return (
          <section className="dashboard-recap" aria-label="Narrative recap of the latest run">
            <details className="dashboard-recap-details" open={justCompleted}>
              <summary className="dashboard-recap-summary">
                <span className="dashboard-recap-kicker">
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M3 2.5h7.5A2.5 2.5 0 0 1 13 5v8.5H5A2 2 0 0 1 3 11.5v-9Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                    <path d="M5.5 5.5h4.5M5.5 8h4.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
                  </svg>
                  Narrative recap — latest run
                </span>
                <strong className="dashboard-recap-headline">
                  {parsed.title || latestRun.headline || "How the deliberation unfolded"}
                </strong>
                <span className="dashboard-recap-caret" aria-hidden="true">▾</span>
              </summary>
              <div className="dashboard-recap-body">
                {parsed.paragraphs.map((p, i) => (
                  <p key={i} className={p.note ? "dashboard-recap-note" : undefined}>
                    {p.text}
                  </p>
                ))}
                <div className="dashboard-recap-footer">
                  <span>{latestRun.runId}</span>
                  <a href={`/api/runs/${encodeURIComponent(latestRun.runId)}/export`} download>
                    Download run bundle (JSON)
                  </a>
                </div>
              </div>
            </details>
          </section>
        );
      })()}

      {/* Town columns */}
      <div className="dashboard-town-grid mb-8">
        {towns.map((t) => {
          const meta = townMeta(t);
          const issues: string[] =
            ws.townSummaries[t]?.top_issues ||
            summaryData?.town_summaries?.find((s: any) => s.town === t)?.top_issues ||
            [];

          return (
            <div
              key={t}
              className="dashboard-town-card rounded-xl px-4 py-3 cursor-pointer"
              role="button"
              tabIndex={0}
              aria-label={`Visit ${meta.name}`}
              style={{
                background: "var(--bg-card)",
                borderWidth: "3px 1.5px 1.5px",
                borderStyle: "solid",
                borderColor: `${meta.color} var(--card-border) var(--card-border)`,
                boxShadow: "var(--shadow-soft)",
                transition: "all 250ms cubic-bezier(0.22, 1, 0.36, 1)",
                animation: "stagger-in 0.4s var(--ease-genshin) backwards",
                animationDelay: `${160 + towns.indexOf(t) * 80}ms`,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "var(--shadow-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "var(--shadow-soft)"; }}
              onClick={() => navigate(`/town/${t}`)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  navigate(`/town/${t}`);
                }
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="w-3 h-3 rounded-full" style={{ background: meta.color }} />
                <h3 className="font-semibold text-sm" style={{ fontFamily: "var(--font-display)", color: readableInk(meta.color), fontWeight: 600 }}>
                  {meta.name}
                </h3>
                <span className="text-xs ml-auto font-semibold" style={{ color: readableInk(meta.color) }}>
                  {meta.population}
                </span>
              </div>

              <div className="flex justify-center mb-2">
                <OpinionChart opinions={townOpinions[t]} size={80} showLegend={false} />
              </div>

              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ fontFamily: "var(--font-display)", color: "var(--gold-ink)", letterSpacing: "1.5px", fontSize: "10px" }}>
                  Top Issues
                </h4>
                {issues.length > 0 ? (
                  issues.slice(0, 2).map((issue: string, i: number) => (
                    <div
                      key={i}
                      className="dashboard-town-issue flex items-start gap-1.5 text-xs"
                      style={{ color: "var(--township-ink)" }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: meta.color, opacity: 0.5 }} />
                      <span className="dashboard-town-issue-text">{issue}</span>
                    </div>
                  ))
                ) : ws.simulationRunning ? (
                  <p className="text-xs italic py-0.5 dashboard-working" style={{ color: "var(--township-ink-muted)" }}>
                    Residents are deliberating — issues surface after round 1
                  </p>
                ) : (
                  <p className="text-xs italic py-0.5" style={{ color: "var(--township-ink-muted)" }}>
                    Run a simulation to surface issues.
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Consensus & Fault Lines */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {/* Consensus */}
        <div
          className="warm-glass rounded-xl p-5"
          style={{
            background: "var(--warm-glass-strong)",
            borderLeft: "3px solid var(--color-success)",
          }}
        >
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2" style={{ fontFamily: "var(--font-display)", color: "var(--color-success)", letterSpacing: "0.5px" }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
              <path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Consensus Zones
          </h3>
          {consensusZones.length > 0 ? (
            consensusZones.map((item, i) => (
              <p key={i} className="text-sm mb-1.5" style={{ color: "var(--township-ink)" }}>
                {item}
              </p>
            ))
          ) : ws.simulationRunning ? (
            <p className="text-sm italic dashboard-working" style={{ color: "var(--township-ink-muted)" }}>
              Deliberation in progress — agreements land with the final summary
            </p>
          ) : (
            <p className="text-sm italic" style={{ color: "var(--township-ink-muted)" }}>
              Run a simulation to surface points of agreement.
            </p>
          )}
        </div>

        {/* Fault Lines */}
        <div
          className="warm-glass rounded-xl p-5"
          style={{
            background: "var(--warm-glass-strong)",
            borderLeft: "3px solid var(--color-warning)",
          }}
        >
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2" style={{ fontFamily: "var(--font-display)", color: "var(--color-warning)", letterSpacing: "0.5px" }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 3v6M8 11.5v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            Fault Lines
          </h3>
          {faultLines.length > 0 ? (
            faultLines.map((item, i) => (
              <p key={i} className="text-sm mb-1.5" style={{ color: "var(--township-ink)" }}>
                {item}
              </p>
            ))
          ) : ws.simulationRunning ? (
            <p className="text-sm italic dashboard-working" style={{ color: "var(--township-ink-muted)" }}>
              Deliberation in progress — fault lines land with the final summary
            </p>
          ) : (
            <p className="text-sm italic" style={{ color: "var(--township-ink-muted)" }}>
              Run a simulation to surface disagreements.
            </p>
          )}
        </div>
      </div>

      {/* Opinion-change timeline */}
      {ws.events && ws.events.length > 0 && (() => {
        const shifts = ws.events
          .filter((e): e is OpinionChangedEvent => e.type === "opinion_changed")
          .slice(-20)
          .reverse();
        if (shifts.length === 0) return null;
        return (
          <div className="dashboard-timeline">
            <h3 className="dashboard-timeline-title">Opinion Timeline</h3>
            <ol
              className="dashboard-timeline-list"
              tabIndex={0}
              aria-label="Recent opinion changes"
            >
              {shifts.map((evt, i) => {
                const oldC = (evt.old_opinion?.candidate as LeanId) ?? undecidedId;
                const newC = (evt.new_opinion?.candidate as LeanId) ?? undecidedId;
                return (
                  <li key={i} className="dashboard-timeline-row">
                    <span
                      className="dashboard-timeline-dot"
                      style={{ background: optionColor(newC) }}
                    />
                    <div className="dashboard-timeline-content">
                      <strong>{evt.agent_name}</strong>
                      <span>
                        <span style={{ color: readableInk(optionColor(oldC)) }}>{optionLabel(oldC)}</span>
                        {" → "}
                        <span style={{ color: readableInk(optionColor(newC)), fontWeight: 600 }}>{optionLabel(newC)}</span>
                      </span>
                      <span className="dashboard-timeline-meta">{townMeta(evt.town).name}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })()}

      {/* Latest news reactions (live WS) */}
      {ws.newsReactions && ws.newsReactions.length > 0 && (
        <div
          className="rounded-xl p-5 mb-8"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--card-border)",
            boxShadow: "var(--shadow-soft)",
          }}
        >
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2" style={{ fontFamily: "var(--font-display)", color: "var(--gold-ink)", letterSpacing: "0.5px" }}>
            <span className="w-2 h-2 rounded-full" style={{ background: "var(--color-live)", animation: "pulse-glow 2s ease-in-out infinite" }} />
            Latest Reactions
          </h3>
          <div className="flex flex-col gap-2">
            {ws.newsReactions.slice(-8).reverse().map((r, i) => {
              const meta = townMeta(r.town);
              return (
                <div
                  key={`${r.agent_id}-${i}`}
                  className="flex items-start gap-2 rounded-lg px-3 py-2"
                  style={{ background: "var(--township-paper)", borderLeft: `3px solid ${meta?.color ?? "var(--card-border)"}` }}
                >
                  <span className="font-medium text-xs shrink-0" style={{ color: meta?.color ? readableInk(meta.color) : "var(--township-ink)" }}>
                    {r.agent_name}
                  </span>
                  <span className="text-xs" style={{ color: "var(--township-ink-muted)" }}>
                    {r.emotional_response}
                    {r.impact_on_vote ? ` — ${r.impact_on_vote}` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Agent Grid */}
      <div className="mb-4 flex items-center gap-2 flex-wrap">
        <h3 className="font-semibold text-sm mr-2" style={{ fontFamily: "var(--font-display)", color: "var(--gold-ink)", letterSpacing: "1px" }}>
          All Agents
        </h3>
        {[
          { value: "all", label: "All" },
          ...towns.map((t) => ({ value: t, label: townMeta(t).name })),
          { value: undecidedId, label: optionLabel(undecidedId) },
          ...scen.optionIds.map((o) => ({ value: o, label: optionLabel(o) })),
        ].map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value as any)}
            className="px-3 py-1 rounded-full text-xs font-medium transition-colors"
            style={{
              background: filter === f.value ? "var(--civic-blue)" : "var(--card-bg)",
              color: filter === f.value ? "var(--text-on-accent)" : "var(--township-ink-muted)",
              border: `1px solid ${filter === f.value ? "var(--civic-blue)" : "var(--card-border)"}`,
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filteredAgents.length > 0 ? (
        <div className="dashboard-agent-grid">
          {filteredAgents.map((a) => (
            <AgentCard
              key={a.id}
              agent={a}
              met={profile?.metAgents?.includes(a.id)}
              persuaded={profile?.persuadedAgents?.includes(a.id)}
              trust={trustFor(a.id) || undefined}
            />
          ))}
        </div>
      ) : (
        <div
          className="dashboard-empty-state rounded-xl p-8 text-center"
          style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
        >
          {allAgents.length === 0 && !preRun && scen.scenario.towns[0]?.map?.preview_path && (
            <img
              className="dashboard-empty-illustration pixel-frame"
              src={appUrl(scen.scenario.towns[0].map.preview_path)}
              alt=""
              aria-hidden="true"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          )}
          <p className="text-sm" style={{ color: "var(--township-ink-muted)" }}>
            {allAgents.length === 0
              ? DEMO_MODE
                ? "The town square is quiet. Press play below, or visit a town while the replay gathers its residents."
                : "The town square is quiet. Start a simulation, or visit a town to meet its residents."
              : "No agents match this filter."}
          </p>
          <div className="dashboard-empty-actions">
            {allAgents.length > 0 && filter !== "all" && (
              <button type="button" onClick={() => setFilter("all")}>Clear filter</button>
            )}
            {allAgents.length === 0 && scen.scenario.towns[0] && (
              <button
                type="button"
                onClick={() => navigate(`/town/${scen.scenario.towns[0].id}`)}
              >
                Visit {scen.scenario.towns[0].name}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
