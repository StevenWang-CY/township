import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import Phaser from "phaser";
import { TownScene } from "../game/TownScene";
import { GAME_CONFIG } from "../game/config";
import ChatPanel from "./ChatPanel";
import AgentCard from "./AgentCard";
import type { AgentState, TownId, SimulationEvent } from "../types/messages";
import { TOWN_META } from "../types/messages";

interface TownViewProps {
  ws: {
    agents: Record<string, AgentState>;
    events: SimulationEvent[];
    conversations: any[];
    connected: boolean;
    currentRound: number;
    totalRounds: number;
    simulationRunning: boolean;
  };
}

/* ── Demo agents matching real backend agent IDs ──────────── */

const DEMO_AGENTS: Record<TownId, AgentState[]> = {
  dover: [
    { id: "carlos-restrepo", name: "Carlos Restrepo", town: "dover", occupation: "Restaurant Owner", opinion: { candidate: "undecided", confidence: 40, reasoning: "", top_issue: "healthcare" }, location: "La Finca Restaurant", current_activity: "Preparing lunch", initials: "CR", color: "#D48050" },
    { id: "miguel-hernandez", name: "Miguel Hernandez", town: "dover", occupation: "Construction Worker", opinion: { candidate: "undecided", confidence: 30, reasoning: "", top_issue: "immigration" }, location: "Public Housing", current_activity: "Worrying about ICE", initials: "MH", color: "#B07040" },
    { id: "maria-santos", name: "Maria Santos", town: "dover", occupation: "Nursing Assistant", opinion: { candidate: "mejia", confidence: 60, reasoning: "", top_issue: "healthcare" }, location: "Dover Station", current_activity: "Commuting to work", initials: "MS", color: "#C06060" },
    { id: "esperanza-guzman", name: "Esperanza Guzman", town: "dover", occupation: "Retired", opinion: { candidate: "mejia", confidence: 55, reasoning: "", top_issue: "social security" }, location: "St. Mary's Church", current_activity: "After mass", initials: "EG", color: "#908070" },
    { id: "sofia-ramirez", name: "Sofia Ramirez", town: "dover", occupation: "College Student (DACA)", opinion: { candidate: "undecided", confidence: 35, reasoning: "", top_issue: "immigration" }, location: "Public Library", current_activity: "Studying", initials: "SR", color: "#A06888" },
    { id: "tom-kowalski", name: "Tom Kowalski", town: "dover", occupation: "Retired Machinist", opinion: { candidate: "undecided", confidence: 40, reasoning: "", top_issue: "taxes" }, location: "Bodega Row", current_activity: "Getting coffee", initials: "TK", color: "#707888" },
  ],
  montclair: [
    { id: "sarah-&-david-chen", name: "Sarah & David Chen", town: "montclair", occupation: "Nonprofit Dir / Tech Mgr", opinion: { candidate: "mejia", confidence: 65, reasoning: "", top_issue: "education" }, location: "Bloomfield Ave", current_activity: "Working from home", initials: "SC", color: "#7868C0" },
    { id: "rosa-chen", name: "Rosa Chen", town: "montclair", occupation: "Retired Teacher", opinion: { candidate: "mejia", confidence: 70, reasoning: "", top_issue: "education" }, location: "Bay Street Station", current_activity: "Walking", initials: "RC", color: "#906888" },
    { id: "jordan-williams", name: "Jordan Williams", town: "montclair", occupation: "Painter / Barista", opinion: { candidate: "undecided", confidence: 30, reasoning: "", top_issue: "housing" }, location: "Art Museum", current_activity: "Sketching", initials: "JW", color: "#8878B0" },
    { id: "carmen-&-alejandro-vargas", name: "Carmen & Alejandro Vargas", town: "montclair", occupation: "Nurse / Restaurant Mgr", opinion: { candidate: "mejia", confidence: 60, reasoning: "", top_issue: "immigration" }, location: "Bloomfield Ave", current_activity: "At work", initials: "CV", color: "#C07060" },
    { id: "rabbi-daniel-goldstein", name: "Rabbi Daniel Goldstein", town: "montclair", occupation: "Rabbi", opinion: { candidate: "hathaway", confidence: 55, reasoning: "", top_issue: "israel" }, location: "Anderson Park", current_activity: "Walking", initials: "DG", color: "#A08868" },
    { id: "priya-patel", name: "Priya Patel", town: "montclair", occupation: "Boutique Owner", opinion: { candidate: "undecided", confidence: 35, reasoning: "", top_issue: "taxes" }, location: "Boutique Row", current_activity: "Opening shop", initials: "PP", color: "#60A090" },
    { id: "margaret-\"peggy\"-o'brien", name: "Margaret O'Brien", town: "montclair", occupation: "Retired Librarian", opinion: { candidate: "mejia", confidence: 60, reasoning: "", top_issue: "social security" }, location: "Public Library", current_activity: "Reading", initials: "MO", color: "#8070A0" },
  ],
  parsippany: [
    { id: "raj-&-sunita-krishnamurthy", name: "Raj & Sunita Krishnamurthy", town: "parsippany", occupation: "Software Engineer / Accountant", opinion: { candidate: "undecided", confidence: 40, reasoning: "", top_issue: "taxes" }, location: "Corporate Park", current_activity: "Working", initials: "RK", color: "#30A0A0" },
    { id: "kantibhai-\"kanti\"-desai", name: "Kantibhai Desai", town: "parsippany", occupation: "Retired", opinion: { candidate: "undecided", confidence: 25, reasoning: "", top_issue: "family" }, location: "Hindu Temple", current_activity: "Morning prayers", initials: "KD", color: "#D0A050" },
    { id: "brian-mccarthy", name: "Brian McCarthy", town: "parsippany", occupation: "Pharma Manager", opinion: { candidate: "hathaway", confidence: 55, reasoning: "", top_issue: "taxes" }, location: "NJ Transit Stop", current_activity: "Commuting", initials: "BM", color: "#708890" },
    { id: "aisha-&-omar-khan", name: "Aisha & Omar Khan", town: "parsippany", occupation: "Marketing / Finance", opinion: { candidate: "mejia", confidence: 50, reasoning: "", top_issue: "housing" }, location: "Residential Area", current_activity: "Apartment hunting", initials: "AK", color: "#50B8A0" },
    { id: "pawan-sharma", name: "Pawan Sharma", town: "parsippany", occupation: "Restaurant Owner", opinion: { candidate: "hathaway", confidence: 50, reasoning: "", top_issue: "business" }, location: "Indian Grocery", current_activity: "At restaurant", initials: "PS", color: "#B09060" },
    { id: "linda-morrison", name: "Linda Morrison", town: "parsippany", occupation: "Retired VP", opinion: { candidate: "undecided", confidence: 35, reasoning: "", top_issue: "healthcare" }, location: "Community Center", current_activity: "Morning walk", initials: "LM", color: "#808890" },
    { id: "grace-reyes", name: "Grace Reyes", town: "parsippany", occupation: "Nurse", opinion: { candidate: "mejia", confidence: 55, reasoning: "", top_issue: "healthcare" }, location: "Community Center", current_activity: "Volunteering", initials: "GR", color: "#6098C0" },
  ],
  randolph: [
    { id: "michael-\"mike\"-brennan", name: "Mike Brennan", town: "randolph", occupation: "Finance Director", opinion: { candidate: "hathaway", confidence: 70, reasoning: "", top_issue: "taxes" }, location: "Commercial Strip", current_activity: "Lunch break", initials: "MB", color: "#508858" },
    { id: "jennifer-\"jen\"-russo", name: "Jen Russo", town: "randolph", occupation: "Stay-at-home Mom", opinion: { candidate: "hathaway", confidence: 55, reasoning: "", top_issue: "schools" }, location: "High School", current_activity: "PTA meeting", initials: "JR", color: "#68A060" },
    { id: "frank-deluca", name: "Frank DeLuca", town: "randolph", occupation: "Retired Colonel", opinion: { candidate: "hathaway", confidence: 75, reasoning: "", top_issue: "security" }, location: "Randolph Diner", current_activity: "Morning coffee", initials: "FD", color: "#607860" },
    { id: "tyler-&-megan-hart", name: "Tyler & Megan Hart", town: "randolph", occupation: "Project Mgr / PT", opinion: { candidate: "undecided", confidence: 35, reasoning: "", top_issue: "housing" }, location: "Residential Cul-de-sacs", current_activity: "Reviewing mortgage", initials: "TH", color: "#80A868" },
    { id: "vikram-iyer", name: "Vikram Iyer", town: "randolph", occupation: "Software Engineer", opinion: { candidate: "undecided", confidence: 40, reasoning: "", top_issue: "schools" }, location: "Town Hall", current_activity: "Researching candidates", initials: "VI", color: "#409870" },
    { id: "tony-mancini", name: "Tony Mancini", town: "randolph", occupation: "Landscaping Owner", opinion: { candidate: "mejia", confidence: 55, reasoning: "", top_issue: "workers rights" }, location: "Commercial Strip", current_activity: "At work", initials: "TM", color: "#88A050" },
  ],
};

export default function TownView({ ws }: TownViewProps) {
  const { townId } = useParams<{ townId: string }>();
  const town = (townId as TownId) || "dover";
  const meta = TOWN_META[town];

  const gameContainerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneRef = useRef<TownScene | null>(null);

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const lastProcessedEvent = useRef(0);

  // Get agents for this town
  const townAgents: AgentState[] = (() => {
    const fromWs = Object.values(ws.agents).filter((a) => a.town === town);
    if (fromWs.length > 0) return fromWs;
    return DEMO_AGENTS[town] || [];
  })();

  const selectedAgent = townAgents.find((a) => a.id === selectedAgentId) || null;

  /* ── Initialize Phaser ───────────────────────────────────── */

  useEffect(() => {
    if (!gameContainerRef.current || gameRef.current) return;

    const scene = new TownScene();
    sceneRef.current = scene;

    const game = new Phaser.Game({
      ...GAME_CONFIG,
      parent: gameContainerRef.current,
      scene: scene,
    });

    // Pass townId to scene
    game.scene.start("TownScene", { townId: town });

    gameRef.current = game;

    // Listen for agent clicks from Phaser
    const checkScene = setInterval(() => {
      const activeScene = game.scene.getScene("TownScene") as TownScene | undefined;
      if (activeScene && activeScene.scene.isActive()) {
        clearInterval(checkScene);
        activeScene.events.on("agent-clicked", (agentId: string) => {
          setSelectedAgentId(agentId);
          setChatOpen(true);
        });

        // Add demo agents
        for (const agent of townAgents) {
          activeScene.addAgent(agent);
        }
      }
    }, 200);

    return () => {
      clearInterval(checkScene);
      game.destroy(true);
      gameRef.current = null;
      sceneRef.current = null;
    };
  }, [town]);

  /* ── Sync agents to Phaser when WS data updates ──────────── */

  useEffect(() => {
    const scene = gameRef.current?.scene.getScene("TownScene") as TownScene | undefined;
    if (!scene || !scene.scene.isActive()) return;

    for (const agent of townAgents) {
      scene.addAgent(agent);
    }
  }, [townAgents.length]);

  /* ── Process new events ──────────────────────────────────── */

  useEffect(() => {
    const scene = gameRef.current?.scene.getScene("TownScene") as TownScene | undefined;
    if (!scene || !scene.scene.isActive()) return;

    const newEvents = ws.events.slice(lastProcessedEvent.current);
    lastProcessedEvent.current = ws.events.length;

    for (const evt of newEvents) {
      if ("town" in evt && (evt as any).town !== town) continue;

      switch (evt.type) {
        case "agent_moved":
          scene.moveAgent(evt.agent_id, evt.to_location);
          break;
        case "agent_speech":
          scene.showAgentSpeech(evt.agent_id, evt.text);
          break;
        case "opinion_changed":
          scene.updateAgentOpinion(evt.agent_id, evt.new_opinion.candidate);
          break;
        case "conversation_started":
          // Show speech bubble for participants
          for (const pid of evt.conversation.participants) {
            scene.showAgentSpeech(pid, `Discussing: ${evt.conversation.topic}`);
          }
          break;
      }
    }
  }, [ws.events.length, town]);

  /* ── UI Callbacks ────────────────────────────────────────── */

  const openChat = useCallback((agentId: string) => {
    setSelectedAgentId(agentId);
    setChatOpen(true);
  }, []);

  return (
    <div className="town-view-layout">
      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Town header */}
        <div
          className="px-6 py-3 flex items-center gap-4 border-b"
          style={{ borderColor: "var(--card-border)", background: "var(--township-paper)" }}
        >
          <div className="w-3 h-3 rounded-full" style={{ background: meta.color }} />
          <div>
            <h2 className="text-lg font-bold" style={{ fontFamily: "Playfair Display, serif", color: meta.color }}>
              {meta.name}
            </h2>
            <p className="text-xs" style={{ color: "var(--township-ink-muted)" }}>
              {meta.tagline} | {meta.county} County | Pop. {meta.population}
            </p>
          </div>
          {ws.simulationRunning && (
            <div
              className="ml-auto px-3 py-1 rounded-full text-xs font-medium"
              style={{ background: "rgba(74,155,92,0.1)", color: "#4A9B5C" }}
            >
              Round {ws.currentRound} / {ws.totalRounds}
            </div>
          )}
        </div>

        {/* Phaser canvas */}
        <div className="town-canvas-wrapper flex-1 relative" style={{ background: "#e8dcc8" }}>
          <div ref={gameContainerRef} className="absolute inset-0" />
        </div>
      </div>

      {/* Sidebar: agent list */}
      <div className="town-view-sidebar">
        <div className="px-3 py-2 border-b" style={{ borderColor: "var(--card-border)" }}>
          <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--township-ink-muted)" }}>
            Residents ({townAgents.length})
          </h3>
        </div>
        <div className="flex-1 overflow-y-auto px-1.5 py-1.5 flex flex-col gap-0.5">
          {townAgents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} compact onClick={() => openChat(agent.id)} />
          ))}
        </div>

        {/* Recent events for this town */}
        <div className="border-t px-3 py-2" style={{ borderColor: "var(--card-border)" }}>
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--township-ink-muted)" }}>
            Recent Activity
          </h3>
          <div className="flex flex-col gap-1 max-h-[120px] overflow-y-auto">
            {ws.events
              .filter((e) => "town" in e && (e as any).town === town)
              .slice(-5)
              .reverse()
              .map((evt, i) => (
                <p key={i} className="text-[10px]" style={{ color: "var(--township-ink-muted)" }}>
                  {eventLabel(evt)}
                </p>
              ))}
            {ws.events.filter((e) => "town" in e && (e as any).town === town).length === 0 && (
              <p className="text-[10px] italic" style={{ color: "var(--township-ink-muted)" }}>
                Waiting for simulation events...
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Chat panel */}
      {chatOpen && <ChatPanel agent={selectedAgent} onClose={() => setChatOpen(false)} />}
    </div>
  );
}

/* ── Helper ────────────────────────────────────────────────── */

function eventLabel(evt: SimulationEvent): string {
  switch (evt.type) {
    case "agent_moved":
      return `${evt.agent_name} moved to ${evt.to_location}`;
    case "agent_speech":
      return `${evt.agent_name}: "${evt.text.slice(0, 40)}..."`;
    case "opinion_changed":
      return `${evt.agent_name} shifted to ${evt.new_opinion.candidate}`;
    case "conversation_started":
      return `${evt.conversation.participant_names.join(" & ")} started talking`;
    default:
      return evt.type.replace(/_/g, " ");
  }
}
