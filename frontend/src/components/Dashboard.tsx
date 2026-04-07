import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import OpinionChart from "./OpinionChart";
import AgentCard from "./AgentCard";
import type { AgentState, TownId, LeanId, DistrictSummary } from "../types/messages";
import { TOWN_META, CANDIDATE_COLORS } from "../types/messages";

/* ── Demo data when backend is offline ─────────────────────── */

const DEMO_OPINIONS: Record<TownId, Record<LeanId, number>> = {
  dover: { mejia: 3, hathaway: 1, bond: 0, undecided: 2 },
  montclair: { mejia: 5, hathaway: 1, bond: 0, undecided: 1 },
  parsippany: { mejia: 2, hathaway: 2, bond: 0, undecided: 3 },
  randolph: { mejia: 0, hathaway: 4, bond: 0, undecided: 2 },
};

const DEMO_ISSUES: Record<TownId, string[]> = {
  dover: ["Healthcare costs", "Immigration enforcement", "Property taxes"],
  montclair: ["Education funding", "Social justice", "Housing affordability"],
  parsippany: ["Property taxes", "Healthcare", "Community integration"],
  randolph: ["Tax burden", "School quality", "National security"],
};

interface DashboardProps {
  ws: {
    agents: Record<string, AgentState>;
    townSummaries: Record<TownId, any>;
    connected: boolean;
    currentRound: number;
    simulationRunning: boolean;
  };
}

export default function Dashboard({ ws }: DashboardProps) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<"all" | TownId | LeanId>("all");
  const [results, setResults] = useState<DistrictSummary | null>(null);

  // Fetch results
  useEffect(() => {
    fetch("/api/simulation/results")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setResults(d))
      .catch(() => {});
  }, []);

  const allAgents = Object.values(ws.agents);
  const towns: TownId[] = ["montclair", "parsippany", "dover", "randolph"];

  // Compute opinions per town
  const townOpinions = useMemo(() => {
    const result: Record<TownId, Record<LeanId, number>> = {
      dover: { mejia: 0, hathaway: 0, bond: 0, undecided: 0 },
      montclair: { mejia: 0, hathaway: 0, bond: 0, undecided: 0 },
      parsippany: { mejia: 0, hathaway: 0, bond: 0, undecided: 0 },
      randolph: { mejia: 0, hathaway: 0, bond: 0, undecided: 0 },
    };
    if (allAgents.length === 0) return DEMO_OPINIONS;
    for (const a of allAgents) {
      const lean = (a.opinion?.candidate as LeanId) || "undecided";
      if (result[a.town]) result[a.town][lean]++;
    }
    return result;
  }, [allAgents]);

  const overallOpinions = useMemo(() => {
    const total: Record<LeanId, number> = { mejia: 0, hathaway: 0, bond: 0, undecided: 0 };
    for (const t of towns) {
      for (const k of Object.keys(total) as LeanId[]) {
        total[k] += townOpinions[t][k];
      }
    }
    return total;
  }, [townOpinions]);

  // Filtered agents
  const filteredAgents = useMemo(() => {
    if (allAgents.length === 0) return [];
    if (filter === "all") return allAgents;
    if (["dover", "montclair", "parsippany", "randolph"].includes(filter)) {
      return allAgents.filter((a) => a.town === filter);
    }
    return allAgents.filter((a) => (a.opinion?.candidate || "undecided") === filter);
  }, [allAgents, filter]);

  const consensusZones = results?.consensus_zones || [
    "Gateway Tunnel is critical infrastructure",
    "Property taxes are too high across the district",
    "Healthcare affordability affects all demographics",
  ];

  const faultLines = results?.fault_lines || [
    "Immigration: Dover fears ICE; Randolph wants enforcement",
    "Taxes: Randolph wants cuts; Montclair wants progressive revenue",
    "Israel/Gaza: Deep divide between progressive and conservative blocs",
  ];

  return (
    <div className="max-w-7xl mx-auto px-6 py-6" style={{ background: "var(--bg-cream)" }}>
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
          Cross-town comparison of NJ-11 agent deliberation
          {ws.simulationRunning && ` | Round ${ws.currentRound}`}
        </p>
      </div>

      {/* Overall donut */}
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
            District-Wide Sentiment (26 agents)
          </h3>
          <div className="flex gap-6">
            {(["mejia", "hathaway", "bond", "undecided"] as LeanId[]).map((k) => (
              <div key={k} className="text-center">
                <div className="text-2xl font-bold" style={{ color: CANDIDATE_COLORS[k] }}>
                  {overallOpinions[k]}
                </div>
                <div className="text-xs capitalize" style={{ color: "var(--township-ink-muted)" }}>
                  {k}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Town columns */}
      <div className="dashboard-town-grid mb-8">
        {towns.map((t) => {
          const meta = TOWN_META[t];
          const issues =
            ws.townSummaries[t]?.top_issues ||
            results?.town_summaries?.find((s: any) => s.town === t)?.top_issues ||
            DEMO_ISSUES[t];

          return (
            <div
              key={t}
              className="rounded-xl p-4 cursor-pointer"
              style={{
                background: "var(--bg-card)",
                border: "1.5px solid var(--card-border)",
                boxShadow: "var(--shadow-soft)",
                borderTop: `3px solid ${meta.color}`,
                transition: "all 250ms cubic-bezier(0.22, 1, 0.36, 1)",
                animation: "stagger-in 0.4s var(--ease-genshin) backwards",
                animationDelay: `${160 + towns.indexOf(t) * 80}ms`,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "var(--shadow-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "var(--shadow-soft)"; }}
              onClick={() => navigate(`/town/${t}`)}
            >
              <div className="flex items-center gap-2 mb-3">
                <span className="w-3 h-3 rounded-full" style={{ background: meta.color }} />
                <h3 className="font-semibold text-sm" style={{ fontFamily: "var(--font-display)", color: meta.color, fontWeight: 600 }}>
                  {meta.name}
                </h3>
                <span className="text-xs ml-auto font-semibold" style={{ color: meta.color }}>
                  {meta.population}
                </span>
              </div>

              <div className="flex justify-center mb-3">
                <OpinionChart opinions={townOpinions[t]} size={100} showLegend={false} />
              </div>

              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ fontFamily: "var(--font-display)", color: "var(--gold-accent)", letterSpacing: "1.5px", fontSize: "10px" }}>
                  Top Issues
                </h4>
                {issues.slice(0, 3).map((issue: string, i: number) => (
                  <div
                    key={i}
                    className="flex items-center gap-1.5 text-xs py-0.5"
                    style={{ color: "var(--township-ink)" }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: meta.color, opacity: 0.5 }} />
                    {issue}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Consensus & Fault Lines */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {/* Consensus */}
        <div
          className="rounded-xl p-5"
          style={{
            background: "linear-gradient(135deg, rgba(74,155,92,0.04), rgba(74,155,92,0.01))",
            border: "1px solid rgba(74,155,92,0.2)",
          }}
        >
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2" style={{ color: "#4A9B5C" }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="7" stroke="#4A9B5C" strokeWidth="1.5" />
              <path d="M5 8l2 2 4-4" stroke="#4A9B5C" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Consensus Zones
          </h3>
          {consensusZones.map((item, i) => (
            <p key={i} className="text-sm mb-1.5" style={{ color: "var(--township-ink)" }}>
              {item}
            </p>
          ))}
        </div>

        {/* Fault Lines */}
        <div
          className="rounded-xl p-5"
          style={{
            background: "linear-gradient(135deg, rgba(239,68,68,0.04), rgba(239,68,68,0.01))",
            border: "1px solid rgba(239,68,68,0.2)",
          }}
        >
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2" style={{ color: "#EF4444" }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 3v6M8 11.5v1" stroke="#EF4444" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="8" cy="8" r="7" stroke="#EF4444" strokeWidth="1.5" />
            </svg>
            Fault Lines
          </h3>
          {faultLines.map((item, i) => (
            <p key={i} className="text-sm mb-1.5" style={{ color: "var(--township-ink)" }}>
              {item}
            </p>
          ))}
        </div>
      </div>

      {/* Agent Grid */}
      <div className="mb-4 flex items-center gap-2 flex-wrap">
        <h3 className="font-semibold text-sm mr-2" style={{ color: "var(--township-ink)" }}>
          All Agents
        </h3>
        {(
          [
            { value: "all", label: "All" },
            { value: "montclair", label: "Montclair" },
            { value: "parsippany", label: "Parsippany" },
            { value: "dover", label: "Dover" },
            { value: "randolph", label: "Randolph" },
            { value: "undecided", label: "Undecided" },
            { value: "mejia", label: "Mejia" },
            { value: "hathaway", label: "Hathaway" },
          ] as const
        ).map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value as any)}
            className="px-3 py-1 rounded-full text-xs font-medium transition-colors"
            style={{
              background: filter === f.value ? "var(--civic-blue)" : "var(--card-bg)",
              color: filter === f.value ? "#fff" : "var(--township-ink-muted)",
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
            <AgentCard key={a.id} agent={a} />
          ))}
        </div>
      ) : (
        <div
          className="rounded-xl p-8 text-center"
          style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
        >
          <p className="text-sm" style={{ color: "var(--township-ink-muted)" }}>
            {allAgents.length === 0
              ? "Start a simulation to see agents here. Visit a town to meet demo residents."
              : "No agents match this filter."}
          </p>
        </div>
      )}
    </div>
  );
}
