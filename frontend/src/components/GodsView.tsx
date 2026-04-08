import { useState, useCallback, useEffect } from "react";
import OpinionChart from "./OpinionChart";
import type { NewsReaction, LeanId, TownId, AgentState } from "../types/messages";
import { TOWN_META, CANDIDATE_COLORS, CANDIDATE_NAMES } from "../types/messages";

/* ── Types ────────────────────────────────────────────────────── */

interface Scenario {
  id: string;
  name: string;
  description: string;
  category: string;
  expected_impact: string;
  affected_towns: string[];
}

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  immigration: { label: "Immigration", color: "#E8763B" },
  healthcare: { label: "Healthcare", color: "#3B82F6" },
  economy: { label: "Economy", color: "#F59E0B" },
  infrastructure: { label: "Infrastructure", color: "#6B7280" },
  education: { label: "Education", color: "#8B5CF6" },
  housing: { label: "Housing", color: "#10B981" },
  national_politics: { label: "National Politics", color: "#EF4444" },
  community: { label: "Community", color: "#EC4899" },
};

interface GodsViewProps {
  ws: {
    agents: Record<string, AgentState>;
    events: any[];
    connected: boolean;
  };
}

export default function GodsView({ ws }: GodsViewProps) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reactions, setReactions] = useState<NewsReaction[]>([]);
  const [submitted, setSubmitted] = useState(false);

  // Scenario library state
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [scenariosLoading, setScenariosLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Fetch scenarios on mount
  useEffect(() => {
    setScenariosLoading(true);
    fetch("/api/gods-view/scenarios")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setScenarios(data.scenarios || []);
      })
      .catch(() => {
        // Fallback: show nothing if backend is unavailable
        setScenarios([]);
      })
      .finally(() => {
        setScenariosLoading(false);
      });
  }, []);

  const submit = useCallback(async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError(null);
    setReactions([]);
    setSubmitted(true);

    try {
      const res = await fetch("/api/gods-view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: prompt.trim() }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setReactions(data.reactions || []);
    } catch (e: any) {
      setError(e.message);
      // Show demo reactions on error
      setReactions(getDemoReactions(prompt));
    } finally {
      setLoading(false);
    }
  }, [prompt]);

  // Group reactions by town
  const byTown: Record<TownId, NewsReaction[]> = { dover: [], montclair: [], parsippany: [], randolph: [] };
  for (const r of reactions) {
    if (byTown[r.town]) byTown[r.town].push(r);
  }

  // Filter scenarios by category
  const categories = Array.from(new Set(scenarios.map((s) => s.category)));
  const filteredScenarios = selectedCategory
    ? scenarios.filter((s) => s.category === selectedCategory)
    : scenarios;

  return (
    <div
      className="gods-view-container max-w-5xl mx-auto px-6 py-6"
      style={{
        background: "var(--bg-warm)",
        minHeight: "calc(100vh - 56px)",
        backgroundImage: "radial-gradient(ellipse at center, rgba(255,252,245,0.4) 0%, transparent 70%)",
      }}
    >
      {/* Header */}
      <div className="mb-6 text-center" style={{ animation: "stagger-in 0.5s var(--ease-genshin) backwards" }}>
        {/* Decorative eye icon */}
        <svg width="40" height="40" viewBox="0 0 40 40" className="mx-auto mb-3" style={{ color: "var(--gold-accent)" }}>
          <circle cx="20" cy="20" r="18" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3" />
          <ellipse cx="20" cy="20" rx="14" ry="9" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.6" />
          <circle cx="20" cy="20" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.6" />
          <circle cx="20" cy="20" r="2" fill="currentColor" opacity="0.5" />
        </svg>
        <h1
          className="text-3xl"
          style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)", fontWeight: 600, letterSpacing: "1.5px" }}
        >
          God's View
        </h1>
        {/* Ornamental separator */}
        <svg width="140" height="10" viewBox="0 0 140 10" className="mx-auto mt-1.5 mb-2">
          <defs>
            <linearGradient id="gv-sep" x1="0%" y1="50%" x2="100%" y2="50%">
              <stop offset="0%" stopColor="var(--gold-accent)" stopOpacity="0" />
              <stop offset="30%" stopColor="var(--gold-accent)" stopOpacity="0.35" />
              <stop offset="50%" stopColor="var(--gold-accent)" stopOpacity="0.5" />
              <stop offset="70%" stopColor="var(--gold-accent)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="var(--gold-accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line x1="0" y1="5" x2="140" y2="5" stroke="url(#gv-sep)" strokeWidth="1" />
          <rect x="64" y="1.5" width="7" height="7" rx="1" transform="rotate(45 67.5 5)" fill="var(--gold-accent)" opacity="0.45" />
        </svg>
        <p className="text-sm" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-body)" }}>
          Inject a hypothetical scenario and see how every agent reacts in real time.
        </p>
      </div>

      {/* Scenario Library */}
      <div className="mb-6">
        <h2
          className="text-lg mb-3"
          style={{ fontFamily: "var(--font-display)", color: "var(--gold-accent)", fontWeight: 600, letterSpacing: "1px" }}
        >
          Scenario Library
        </h2>

        {scenariosLoading ? (
          <div className="flex items-center gap-3 py-8 justify-center">
            <div
              className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: "var(--civic-blue)", borderTopColor: "transparent" }}
            />
            <span className="text-sm" style={{ color: "var(--township-ink-muted)" }}>
              Loading scenarios...
            </span>
          </div>
        ) : scenarios.length > 0 ? (
          <>
            {/* Category filter pills */}
            <div className="flex flex-wrap gap-2 mb-4">
              <button
                onClick={() => setSelectedCategory(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style={{
                  background: !selectedCategory ? "var(--civic-blue)" : "var(--township-paper)",
                  color: !selectedCategory ? "#fff" : "var(--township-ink-muted)",
                  border: `1px solid ${!selectedCategory ? "var(--civic-blue)" : "var(--card-border)"}`,
                }}
              >
                All
              </button>
              {categories.map((cat) => {
                const meta = CATEGORY_LABELS[cat] || { label: cat, color: "#6B7280" };
                const active = selectedCategory === cat;
                return (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(active ? null : cat)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                    style={{
                      background: active ? meta.color : "var(--township-paper)",
                      color: active ? "#fff" : meta.color,
                      border: `1px solid ${active ? meta.color : "var(--card-border)"}`,
                    }}
                  >
                    {meta.label}
                  </button>
                );
              })}
            </div>

            {/* Scenario cards grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
              {filteredScenarios.map((scenario) => {
                const catMeta = CATEGORY_LABELS[scenario.category] || { label: scenario.category, color: "#6B7280" };
                const isSelected = prompt === scenario.description;

                return (
                  <button
                    key={scenario.id}
                    onClick={() => setPrompt(scenario.description)}
                    className="rounded-xl p-4 text-left transition-all hover:scale-[1.01] active:scale-[0.99]"
                    style={{
                      background: isSelected ? `color-mix(in srgb, ${catMeta.color} 8%, white)` : "var(--card-bg)",
                      border: `1.5px solid ${isSelected ? catMeta.color : "var(--card-border)"}`,
                      boxShadow: isSelected ? `0 0 0 1px ${catMeta.color}40` : "var(--card-shadow)",
                    }}
                  >
                    {/* Category + name */}
                    <div className="flex items-center gap-2 mb-2">
                      <span
                        className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider"
                        style={{ background: `${catMeta.color}18`, color: catMeta.color }}
                      >
                        {catMeta.label}
                      </span>
                      {isSelected && (
                        <span className="text-[10px] font-medium ml-auto" style={{ color: catMeta.color }}>
                          Selected
                        </span>
                      )}
                    </div>

                    <h3 className="font-semibold text-sm mb-1.5" style={{ color: "var(--township-ink)" }}>
                      {scenario.name}
                    </h3>

                    <p className="text-xs mb-2 line-clamp-2" style={{ color: "var(--township-ink-muted)" }}>
                      {scenario.description}
                    </p>

                    {/* Expected impact */}
                    <p className="text-xs mb-2" style={{ color: "var(--township-ink)" }}>
                      <span className="font-medium">Expected impact: </span>
                      <span style={{ color: "var(--township-ink-muted)" }}>{scenario.expected_impact}</span>
                    </p>

                    {/* Affected towns badges */}
                    <div className="flex flex-wrap gap-1">
                      {scenario.affected_towns.map((t) => {
                        const townMeta = TOWN_META[t as TownId];
                        if (!townMeta) return null;
                        return (
                          <span
                            key={t}
                            className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                            style={{
                              background: `color-mix(in srgb, ${townMeta.color} 15%, white)`,
                              color: townMeta.color,
                            }}
                          >
                            {townMeta.name}
                          </span>
                        );
                      })}
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        ) : null}
      </div>

      {/* Prompt input (free-text) */}
      <div
        className="rounded-xl p-5 mb-6 relative overflow-hidden"
        style={{ background: "var(--bg-card)", border: "1px solid var(--card-border)", boxShadow: "var(--shadow-soft)" }}
      >
        {/* Corner ornaments */}
        <svg className="absolute top-2 left-2" width="20" height="20" viewBox="0 0 20 20" opacity="0.2">
          <path d="M0,15 L0,3 C0,1.5 1.5,0 3,0 L15,0" fill="none" stroke="var(--gold-accent)" strokeWidth="1.5" />
          <circle cx="0" cy="15" r="1.5" fill="var(--gold-accent)" />
        </svg>
        <svg className="absolute bottom-2 right-2" width="20" height="20" viewBox="0 0 20 20" opacity="0.2">
          <path d="M20,5 L20,17 C20,18.5 18.5,20 17,20 L5,20" fill="none" stroke="var(--gold-accent)" strokeWidth="1.5" />
          <circle cx="20" cy="5" r="1.5" fill="var(--gold-accent)" />
        </svg>

        <label className="block text-sm font-semibold mb-2" style={{ fontFamily: "var(--font-display)", color: "var(--gold-accent)", letterSpacing: "0.5px" }}>
          What if...
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Select a scenario above or describe your own hypothetical event..."
          rows={3}
          className="w-full px-4 py-3 rounded-lg text-sm resize-none outline-none"
          style={{
            background: "var(--bg-card)",
            border: "1px solid rgba(180,160,120,0.2)",
            color: "var(--text-primary)",
            fontFamily: "var(--font-body)",
            transition: "border-color 200ms, box-shadow 200ms",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "rgba(196,163,90,0.5)";
            e.currentTarget.style.boxShadow = "0 0 0 3px rgba(196,163,90,0.08)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "rgba(180,160,120,0.2)";
            e.currentTarget.style.boxShadow = "none";
          }}
        />

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={submit}
            disabled={loading || !prompt.trim()}
            className="px-6 py-2.5 rounded-lg text-sm text-white disabled:opacity-40 active:scale-[0.97]"
            style={{
              background: "var(--gold-accent)",
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              letterSpacing: "1px",
              transition: "all 200ms ease",
              boxShadow: "0 2px 8px var(--gold-glow)",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.filter = "brightness(1.1)"; e.currentTarget.style.boxShadow = "0 0 16px var(--gold-glow)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.filter = ""; e.currentTarget.style.boxShadow = "0 2px 8px var(--gold-glow)"; }}
          >
            {loading ? "Simulating..." : "Inject Scenario"}
          </button>
          {prompt.trim() && (
            <button
              onClick={() => setPrompt("")}
              className="px-4 py-2 rounded-lg text-sm transition-colors"
              style={{ color: "var(--township-ink-muted)", border: "1px solid var(--card-border)" }}
            >
              Clear
            </button>
          )}
          {error && (
            <span className="text-xs" style={{ color: "#EF4444" }}>
              Backend unreachable. Showing demo reactions.
            </span>
          )}
        </div>
      </div>

      {/* Results */}
      {submitted && (
        <div style={{ animation: "fade-in-up 0.4s ease-out" }}>
          {loading ? (
            <div className="text-center py-12">
              <div
                className="inline-block w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
                style={{ borderColor: "var(--civic-blue)", borderTopColor: "transparent" }}
              />
              <p className="mt-3 text-sm" style={{ color: "var(--township-ink-muted)" }}>
                Agents are processing this news...
              </p>
            </div>
          ) : (
            <>
              {/* Per-town reaction panels */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                {(["dover", "montclair", "parsippany", "randolph"] as TownId[]).map((t) => {
                  const meta = TOWN_META[t];
                  const townReactions = byTown[t];
                  if (townReactions.length === 0) return null;

                  return (
                    <div
                      key={t}
                      className="rounded-xl p-4"
                      style={{
                        background: "var(--bg-card)",
                        border: "1px solid var(--card-border)",
                        borderTop: `3px solid ${meta.color}`,
                        boxShadow: "var(--shadow-soft)",
                        animation: "stagger-in 0.4s var(--ease-genshin) backwards",
                        animationDelay: `${(["dover","montclair","parsippany","randolph"].indexOf(t)) * 60}ms`,
                      }}
                    >
                      <h3 className="font-semibold text-sm mb-3 flex items-center gap-2" style={{ fontFamily: "var(--font-display)", color: meta.color, letterSpacing: "0.5px" }}>
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: meta.color }} />
                        {meta.name}
                      </h3>

                      <div className="flex flex-col gap-3">
                        {townReactions.map((r, i) => (
                          <div
                            key={i}
                            className="rounded-lg p-3"
                            style={{ background: "var(--township-paper)" }}
                          >
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="font-medium text-sm" style={{ color: "var(--township-ink)" }}>
                                {r.agent_name}
                              </span>
                            </div>
                            <p className="text-xs mb-1" style={{ color: "var(--township-ink)" }}>
                              <span className="font-medium">Emotional:</span> {r.emotional_response}
                            </p>
                            <p className="text-xs mb-1" style={{ color: "var(--township-ink)" }}>
                              <span className="font-medium">Vote impact:</span> {r.impact_on_vote}
                            </p>
                            <p className="text-xs" style={{ color: "var(--township-ink-muted)", fontStyle: "italic" }}>
                              {r.reasoning}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {reactions.length === 0 && !loading && (
                <div
                  className="rounded-xl p-8 text-center"
                  style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
                >
                  <p className="text-sm" style={{ color: "var(--township-ink-muted)" }}>
                    No reactions yet. Make sure the simulation is running.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Demo reactions when backend isn't available ───────────── */

function getDemoReactions(prompt: string): NewsReaction[] {
  const isICE = prompt.toLowerCase().includes("ice");
  const isHealthcare = prompt.toLowerCase().includes("healthcare") || prompt.toLowerCase().includes("premium");
  const isLayoff = prompt.toLowerCase().includes("layoff");

  return [
    {
      agent_id: "dover-1",
      agent_name: "Carlos Restrepo",
      town: "dover" as TownId,
      headline: prompt,
      emotional_response: isICE
        ? "Terrified. My employees, my neighbors — everyone is scared."
        : "Concerned about how this affects my family and business.",
      impact_on_vote: isICE
        ? "Strongly pushes me toward Mejia. She understands our community."
        : "Makes me think more carefully about who will protect working families.",
      reasoning: "As a business owner in Dover's immigrant community, any policy that threatens our stability threatens everything I've built.",
    },
    {
      agent_id: "montclair-3",
      agent_name: "Dorothy Johnson",
      town: "montclair" as TownId,
      headline: prompt,
      emotional_response: "This is deeply troubling but unfortunately not surprising.",
      impact_on_vote: "Reinforces my support for Mejia's progressive platform.",
      reasoning: "After 40 years of teaching, I've seen how policy failures cascade through communities. We need systemic change.",
    },
    {
      agent_id: "parsippany-1",
      agent_name: "Rajesh Sharma",
      town: "parsippany" as TownId,
      headline: prompt,
      emotional_response: isLayoff
        ? "Very worried. Tech layoffs could hit our community hard."
        : "Need to analyze the policy implications carefully.",
      impact_on_vote: "Still weighing both candidates. This adds another factor to consider.",
      reasoning: "As an IT manager, I try to evaluate things systematically. Both candidates have relevant proposals.",
    },
    {
      agent_id: "randolph-1",
      agent_name: "James Thornton",
      town: "randolph" as TownId,
      headline: prompt,
      emotional_response: "Frustrated but pragmatic. We need practical solutions, not ideology.",
      impact_on_vote: "Hathaway's moderate approach seems more realistic for addressing this.",
      reasoning: "In finance, you learn that extreme positions rarely produce good outcomes. Hathaway understands that.",
    },
    {
      agent_id: "dover-5",
      agent_name: "Sofia Hernandez",
      town: "dover" as TownId,
      headline: prompt,
      emotional_response: isICE
        ? "I'm a DACA recipient. This is my worst nightmare."
        : "This affects young people like me the most.",
      impact_on_vote: "Mejia is the only candidate who truly represents people like me.",
      reasoning: "I came here as a child. This is the only country I know. I need a representative who sees me as fully American.",
    },
    {
      agent_id: "randolph-3",
      agent_name: "Col. Bob Mitchell",
      town: "randolph" as TownId,
      headline: prompt,
      emotional_response: "We need strong leadership, not hand-wringing.",
      impact_on_vote: "Hathaway has the temperament and background for tough situations.",
      reasoning: "In the military, I learned that decisive leadership matters more than perfect solutions.",
    },
  ];
}
