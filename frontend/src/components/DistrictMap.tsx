import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUserProfile } from "../context/UserProfileContext";
import { useWebSocketContext } from "../context/WebSocketContext";
import { DEMO_MODE } from "../demo/demoMode";
import { useScenario } from "../hooks/useScenario";
import type { ScenarioContextValue } from "../hooks/useScenario";
import { appUrl } from "../lib/assetUrl";
import { below, useMediaQuery } from "../lib/breakpoints";
import { readableInk, withAlpha } from "../lib/color";
import type { AgentState, LeanId, TownId } from "../types/messages";
import AtlasHoverCard from "./atlas/AtlasHoverCard";
import AtlasPanel from "./atlas/AtlasPanel";
import { supportsOffsetPath } from "./atlas/AtlasFolk";
import { useOverworldAtlas } from "./atlas/overworld";
import type { AtlasSiteRecord } from "./atlas/overworld";
import type { SiteView } from "./atlas/types";
import { residentsLine } from "./atlas/types";
import { rosterAgentsFromPayload } from "./residentRoster";

/* ───────────────────────────────────────────────────────────────
   District Atlas — /map.

   A native-resolution pixel overworld (scripts/mapgen/overworld.py) with a
   real mini-town on every site, hanging nameplates, the residents strolling
   each town's main street tinted by their stance, a postcard hover card
   (a tap sheet on touch), and the town-card grid below. Everything the
   page knows about towns comes from the scenario package; the atlas
   assets are presentation only and the page degrades to town buttons
   without them.
   ─────────────────────────────────────────────────────────────── */

/** Leading (non-undecided) option per town from agent states. */
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
    for (const [k, n] of Object.entries(counts[t])) {
      if (k !== undecidedId && n > bestN) {
        best = k;
        bestN = n;
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

function decisionDayLabel(scen: ScenarioContextValue): string {
  const raw = scen.scenario.dates?.decision_day;
  if (!raw) return "";
  const d = new Date(`${raw}T00:00:00`);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

/** Sites for towns the overworld does not know (or before it loads): a
 *  notional pad, so the card grid never waits on the atlas. */
function placeholderRecord(id: TownId, name: string): AtlasSiteRecord {
  return { id, name, x: 0, y: 0, pad: { x: 0, y: 0, w: 12, h: 10 }, walk: [] };
}

export default function DistrictMap() {
  const navigate = useNavigate();
  const { isOnboarded, profile } = useUserProfile();
  const ws = useWebSocketContext();
  const scen = useScenario();
  const compact = useMediaQuery(below("md"));
  const coarse = useMediaQuery("(pointer: coarse)");
  const [hovered, setHovered] = useState<TownId | null>(null);
  const [selected, setSelected] = useState<TownId | null>(null);
  const sheetRef = useRef<HTMLElement>(null);
  // The page fades in as a whole (the shell's demo banner settles under the
  // same beat); the e2e suite waits for this to reach 1 before auditing.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  const townIds = useMemo(() => scen.scenario.towns.map((t) => t.id), [scen.scenario]);
  const overworld = useOverworldAtlas(scen.scenario.id, townIds);

  // Before a live simulation starts, use the real scenario roster so every
  // atlas gets the same portrait + leading-option treatment. Static demos get
  // an authoritative transport roster primed from their staged feed.
  const [rosterAgents, setRosterAgents] = useState<AgentState[]>([]);
  useEffect(() => {
    setRosterAgents([]);
    if (DEMO_MODE) return;
    const ctrl = new AbortController();
    fetch("/api/simulation/agents", { signal: ctrl.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (payload) setRosterAgents(rosterAgentsFromPayload(payload, townIds, scen.undecidedId));
      })
      .catch(() => {
        /* zero-backend demo: the replay supplies residents */
      });
    return () => ctrl.abort();
  }, [scen.scenario.id, scen.undecidedId, townIds]);

  const displayAgents = useMemo(() => {
    const live = Object.values(ws.agents);
    if (live.length > 0) return live;
    const transportRoster = Object.values(ws.agentRoster);
    return transportRoster.length > 0 ? transportRoster : rosterAgents;
  }, [ws.agents, ws.agentRoster, rosterAgents]);

  const showMet = !DEMO_MODE && isOnboarded;
  const sites = useMemo<SiteView[]>(() => {
    const leaders = leadingOptionPerTown(displayAgents, townIds, scen.undecidedId);
    const met = new Set(profile?.metAgents ?? []);
    const records = overworld.state === "ready" ? overworld.atlas.sites : [];
    return townIds.map((id) => {
      const meta = scen.townMeta(id);
      const agents = displayAgents.filter((a) => a.town === id);
      const leader = leaders[id];
      return {
        id,
        meta,
        record: records.find((r) => r.id === id) ?? placeholderRecord(id, meta.name),
        agents,
        total: agents.length,
        met: agents.filter((a) => met.has(a.id)).length,
        showMet,
        leaderLabel: leader ? scen.optionLabel(leader) : null,
        leaderColor: leader ? scen.optionColor(leader) : null,
      };
    });
  }, [displayAgents, townIds, scen, overworld, profile?.metAgents, showMet]);

  const stanceColor = (a: AgentState) =>
    scen.optionColor((a.opinion?.candidate as LeanId) || scen.undecidedId);

  const goToTown = (id: TownId) => {
    // The hosted replay should reveal its strongest surface immediately;
    // profile creation remains part of the interactive local experience.
    navigate(DEMO_MODE || isOnboarded ? `/town/${id}` : `/onboarding?town=${id}`);
  };
  // Touch and compact screens have no hover: the first tap opens the sheet
  // below the panel, whose button enters the town. Pointers go straight in.
  const touchFirst = compact || coarse;
  const activateSite = (id: TownId) => {
    if (!touchFirst) return goToTown(id);
    setSelected(id);
    setHovered(id);
  };
  useEffect(() => {
    if (selected) sheetRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  const motionReduced = motionIsReduced();
  const dday = decisionDayLabel(scen);
  const totalResidents = displayAgents.length;
  const subtitle = [
    totalResidents ? `${totalResidents} AI Residents` : "AI Residents",
    `${townIds.length} Town${townIds.length === 1 ? "" : "s"}`,
  ].join(" · ");
  const selectedSite = selected ? sites.find((s) => s.id === selected) ?? null : null;

  return (
    <div className={`district-map${ready ? " is-ready" : ""}`}>
      {/* The wordmark lives in the app header and the scenario title on the
          cartouche, so this block leads with the one thing nothing else on
          the page says: the question at stake. */}
      <div className="district-map-head">
        <h1>{scen.question}</h1>
        <p className="district-map-sub">
          {touchFirst ? "Tap a community to meet your AI neighbors" : "Click a community to meet your AI neighbors"}
          {dday ? ` · Decision day ${dday}` : ""}
        </p>
      </div>

      <AtlasPanel
        status={overworld}
        sites={sites}
        towns={sites.map((s) => ({ id: s.id, name: s.meta.name, color: s.meta.color }))}
        title={scen.title}
        subtitle={subtitle}
        hovered={hovered}
        onHover={setHovered}
        onActivate={activateSite}
        animateFolk={!motionReduced && supportsOffsetPath()}
        driftClouds={!motionReduced}
        stanceColor={stanceColor}
        renderHoverCard={
          touchFirst
            ? undefined
            : (site, style, id) => (
                <AtlasHoverCard key={site.id} site={site} scenario={scen} variant="float" id={id} style={style} />
              )
        }
      />

      {touchFirst && selectedSite && (
        <section ref={sheetRef} className="atlas-sheet" aria-label={`${selectedSite.meta.name} details`}>
          <AtlasHoverCard
            site={selectedSite}
            scenario={scen}
            variant="sheet"
            onEnter={() => goToTown(selectedSite.id)}
            onClose={() => setSelected(null)}
          />
        </section>
      )}

      <div className="atlas-decision">
        <p className="atlas-decision-title">{dday ? `Decision day — ${dday}` : scen.title}</p>
        <p className="atlas-decision-prose">{scen.scenario.dates?.prose || scen.question}</p>
      </div>

      {/* Town cards: the postcard, the name, the tagline, the census, the leader. */}
      <div className="district-town-cards">
        {sites.map((site, idx) => {
          const { meta } = site;
          const chipTone = site.leaderColor ?? "var(--color-neutral)";
          const postcard = meta.postcardPath ? appUrl(meta.postcardPath) : null;
          return (
            <button
              key={site.id}
              type="button"
              className={`district-town-card${hovered === site.id ? " district-town-card--lit" : ""}`}
              style={{
                ["--town-accent" as string]: meta.color,
                animationDelay: `${120 + idx * 80}ms`,
              }}
              onClick={() => goToTown(site.id)}
              onMouseEnter={() => setHovered(site.id)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(site.id)}
              onBlur={() => setHovered(null)}
            >
              <span className="district-town-card-postcard-frame">
                {postcard ? (
                  <img className="district-town-card-postcard" src={postcard} width={224} height={144} alt="" loading="lazy" />
                ) : (
                  <span className="district-town-card-postcard-fallback">{meta.name.charAt(0)}</span>
                )}
              </span>
              <span className="district-town-card-body">
                <span className="district-town-card-name">{meta.name}</span>
                {meta.tagline && <span className="district-town-card-tagline">{meta.tagline}</span>}
                <span className="district-town-card-meta">
                  {[residentsLine(site), meta.county ?? ""].filter(Boolean).join(" · ")}
                </span>
                <span
                  className="district-town-card-chip"
                  style={{
                    background: withAlpha(chipTone, 0.12),
                    borderColor: withAlpha(chipTone, 0.35),
                    color: site.leaderColor ? readableInk(site.leaderColor) : "var(--text-muted)",
                  }}
                >
                  <span className="district-town-card-chip-dot" style={{ background: chipTone }} aria-hidden="true" />
                  {site.leaderLabel ? `Leading: ${site.leaderLabel}` : `No ${scen.optionNoun()} leading yet`}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
