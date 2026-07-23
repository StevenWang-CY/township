import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import Phaser from "phaser";
import { TownScene, hasAuthoredTownMap } from "../game/TownScene";
import { GAME_CONFIG } from "../game/config";
import { useUserProfile } from "../context/UserProfileContext";
import { useTownData } from "../hooks/useTownData";
import { useRelationships } from "../hooks/useRelationships";
import { CanvasOverlay } from "./CanvasOverlay";
import ChatPanel from "./ChatPanel";
import AgentCard from "./AgentCard";
import PlayerHUD from "./PlayerHUD";
import MiniMap from "./MiniMap";
import Tutorial from "./Tutorial";
import DebugOverlay from "./DebugOverlay";
import { rosterAgentsFromPayload } from "./residentRoster";
import type { AgentState, TownId, LeanId, SimulationEvent, Opinion, ChatMessage } from "../types/messages";
import { useScenario } from "../hooks/useScenario";
import { readableInk } from "../lib/color";
import { DEMO_MODE } from "../demo/demoMode";
import { eventsSince, type WsState } from "../hooks/useWebSocket";
import { playerCapabilityHeaders, registerPlayerCapability } from "../lib/playerCapability";

interface TownViewProps {
  ws: WsState;
}

/* ── Keyboard Hint Overlay ────────────────────────────────── */

function KeyboardHint({ onDismiss }: { onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 5000);
    const onKey = () => { onDismiss(); clearTimeout(timer); };
    window.addEventListener("keydown", onKey, { once: true });
    return () => { clearTimeout(timer); window.removeEventListener("keydown", onKey); };
  }, [onDismiss]);

  return (
    <div className="keyboard-hint">
      <div className="keyboard-hint-inner">
        <div className="keyboard-hint-group">
          <div className="keyboard-hint-keys">
            <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>
          </div>
          <span className="keyboard-hint-label">Move</span>
        </div>
        <div className="keyboard-hint-divider" />
        <div className="keyboard-hint-group">
          <div className="keyboard-hint-keys">
            <kbd>E</kbd>
          </div>
          <span className="keyboard-hint-label">Talk</span>
        </div>
        <div className="keyboard-hint-divider" />
        <div className="keyboard-hint-group">
          <div className="keyboard-hint-keys">
            <kbd className="keyboard-hint-click">Click</kbd>
          </div>
          <span className="keyboard-hint-label">Chat</span>
        </div>
      </div>
    </div>
  );
}

/* ── TownView Component ───────────────────────────────────── */

export default function TownView({ ws }: TownViewProps) {
  const { townId } = useParams<{ townId: string }>();
  const scen = useScenario();
  const town = (townId as TownId) || scen.scenario.towns[0].id;
  const meta = scen.townMeta(town);
  const { profile, isOnboarded, markAgentMet, markAgentPersuaded } = useUserProfile();
  const { data: townData } = useTownData();
  const { trustFor } = useRelationships(profile?.playerId);

  const gameContainerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  // Latest scenario helpers for Phaser callbacks registered once at init.
  const scenRef = useRef(scen);
  useEffect(() => { scenRef.current = scen; }, [scen]);
  const sceneRef = useRef<TownScene | null>(null);
  const playerSpawnedRef = useRef(false);

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [sceneError, setSceneError] = useState<string | null>(null);
  const [sceneBootAttempt, setSceneBootAttempt] = useState(0);
  const [showKeyboardHint, setShowKeyboardHint] = useState(true);
  const [debugOpen, setDebugOpen] = useState(false);
  const [listenOpen, setListenOpen] = useState(false);
  const [listenNearbyLandmark, setListenNearbyLandmark] = useState<string | null>(null);
  const [gossipToast, setGossipToast] = useState<string | null>(null);
  const gossipTimerRef = useRef<number | undefined>(undefined);
  const lastProcessedCursor = useRef(0);
  // Stable ref to openChat so Phaser event handlers (registered once in
  // the init effect) always call the latest implementation — and therefore
  // capture preChatRef, snapshot opinion, and markAgentMet for in-canvas
  // clicks just like sidebar clicks.
  const openChatRef = useRef<(agentId: string) => void>(() => {});

  // Pre-chat snapshots for met/persuaded + journal
  const preChatRef = useRef<{
    agentId: string;
    opinion?: Opinion;
    trust: number;
  } | null>(null);
  const lastChatTranscriptRef = useRef<Record<string, ChatMessage[]>>({});

  // Before a live simulation streams, resolve the scenario's real roster from
  // the backend. Static replay mode receives the same authoritative roster as
  // transport metadata derived from simulation_started in the staged feed.
  const [rosterAgents, setRosterAgents] = useState<AgentState[]>([]);
  useEffect(() => {
    setRosterAgents([]);
    if (DEMO_MODE) return;
    const ctrl = new AbortController();
    fetch(`/api/simulation/agents?town=${encodeURIComponent(town)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setRosterAgents(rosterAgentsFromPayload(d, [town], scen.undecidedId));
      })
      .catch(() => { /* offline — sidebar stays empty, canvas still renders */ });
    return () => ctrl.abort();
  }, [town, scen.undecidedId]);

  // Applied agent state wins; before the first event, use the transport roster
  // (finite replay) or API roster (live). No scenario identity is special.
  const townAgents: AgentState[] = (() => {
    const fromWs = Object.values(ws.agents).filter((a) => a.town === town);
    if (fromWs.length > 0) return fromWs;
    const fromTransport = Object.values(ws.agentRoster).filter((a) => a.town === town);
    if (fromTransport.length > 0) return fromTransport;
    return rosterAgents;
  })();
  const streamedTotalAgents =
    Object.keys(ws.agents).length || Object.keys(ws.agentRoster).length || undefined;

  const selectedAgent = townAgents.find((a) => a.id === selectedAgentId) || null;

  // Event effects consume an absolute cursor, while discontinuous navigation
  // reconciles against this latest reducer snapshot. Keeping the snapshot in
  // a ref avoids turning every agent object update into a second scene pass.
  const replayStateRef = useRef({
    agents: townAgents,
    positions: ws.agentPositions,
    clock: ws.worldClock,
    weather: ws.weather,
  });
  replayStateRef.current = {
    agents: townAgents,
    positions: ws.agentPositions,
    clock: ws.worldClock,
    weather: ws.weather,
  };

  const reconcileScene = useCallback((scene: TownScene) => {
    const snapshot = replayStateRef.current;
    scene.syncReplayState(
      snapshot.agents,
      snapshot.positions,
      snapshot.clock,
      snapshot.weather,
    );
  }, []);

  // Build a player AgentState for the sidebar
  const playerAgentState: AgentState | null = profile && profile.town === town ? {
    id: profile.agentId,
    name: profile.name,
    town: profile.town as TownId,
    occupation: "You",
    opinion: { candidate: scen.undecidedId, confidence: 0, reasoning: "", top_issues: profile.topConcerns.length ? [profile.topConcerns[0]] : [] },
    location: "Exploring",
    current_activity: "Walking around",
    initials: profile.initials,
    color: profile.color,
    sprite_key: profile.spriteKey,
    outfit_key: profile.outfitKey,
    accessory_key: profile.accessoryKey,
  } : null;

  // Lookup table for proximity card
  const agentLookup = useMemo(() => {
    const map = new Map<string, AgentState>();
    for (const a of townAgents) map.set(a.id, a);
    return map;
  }, [townAgents]);

  /* ── Initialize Phaser ───────────────────────────────────── */

  useEffect(() => {
    if (!gameContainerRef.current || gameRef.current) return;
    setSceneReady(false);
    setSceneError(null);

    let game: Phaser.Game;
    try {
      const scene = new TownScene();
      sceneRef.current = scene;

      game = new Phaser.Game({
        ...GAME_CONFIG,
        parent: gameContainerRef.current,
        scene,
      });

      // Pass townId to scene
      game.scene.start("TownScene", {
        scenarioId: scen.scenario.id,
        townId: town,
        mapPath: meta.map?.path,
        reducedMotion: Boolean(profile?.reducedMotion),
      });
    } catch {
      sceneRef.current = null;
      setSceneError(`We couldn't open ${meta.name}'s map.`);
      return;
    }

    gameRef.current = game;

    // Listen for agent clicks and player events from Phaser
    const checkScene = setInterval(() => {
      const activeScene = game.scene.getScene("TownScene") as TownScene | undefined;
      if (activeScene?.scene?.isActive()) {
        clearInterval(checkScene);
        window.clearTimeout(bootTimeout);
        setSceneReady(true);

        activeScene.events.on("agent-clicked", (agentId: string) => {
          openChatRef.current(agentId);
        });

        activeScene.events.on("player-interact", (agentId: string) => {
          openChatRef.current(agentId);
        });

        activeScene.events.on("proximity-agent", (_agentId: string | null) => {
          // Could show a UI indicator — for now proximity is handled in-game
        });

        // Scenario data is authoritative for every opinion-ring color.
        const colors: Record<string, string> = {};
        for (const id of scenRef.current.optionIds) colors[id] = scenRef.current.optionColor(id);
        colors[scenRef.current.undecidedId] = scenRef.current.optionColor(scenRef.current.undecidedId);
        try { activeScene.setOptionColors(colors); } catch { /* ignore */ }

        // Spawn player if onboarded
        if (isOnboarded && profile && !playerSpawnedRef.current) {
          activeScene.addPlayer(profile);
          playerSpawnedRef.current = true;
        }
      }
    }, 200);

    const bootTimeout = window.setTimeout(() => {
      window.clearInterval(checkScene);
      setSceneError(`${meta.name}'s map is taking longer than expected.`);
    }, 12_000);

    return () => {
      clearInterval(checkScene);
      window.clearTimeout(bootTimeout);
      gameRef.current = null;
      sceneRef.current = null;
      playerSpawnedRef.current = false;
      game.destroy(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [town, sceneBootAttempt, profile?.reducedMotion]);

  /* ── Feed authoritative scenario option colors to Phaser ── */

  useEffect(() => {
    const scene = gameRef.current?.scene.getScene("TownScene") as TownScene | undefined;
    if (!scene) return;
    const colors: Record<string, string> = {};
    for (const id of scen.optionIds) colors[id] = scen.optionColor(id);
    colors[scen.undecidedId] = scen.optionColor(scen.undecidedId);
    try { scene.setOptionColors(colors); } catch { /* ignore */ }
  }, [scen, town]);

  /* ── Spawn player when profile becomes available ────────── */

  useEffect(() => {
    if (!isOnboarded || !profile || playerSpawnedRef.current) return;
    const scene = gameRef.current?.scene.getScene("TownScene") as TownScene | undefined;
    if (!scene?.scene?.isActive()) return;
    scene.addPlayer(profile);
    playerSpawnedRef.current = true;
  }, [isOnboarded, profile]);

  /* ── Toggle player input when chat opens/closes ─────────── */

  useEffect(() => {
    const scene = gameRef.current?.scene.getScene("TownScene") as TownScene | undefined;
    if (!scene?.scene?.isActive()) return;
    scene.setPlayerInputEnabled(!chatOpen);
  }, [chatOpen]);

  /* ── Safety: never leave an invisible chat open ───────────
   * ChatPanel renders null when the selected agent can't be resolved from
   * townAgents (e.g. the WS roster replaces the fallback agents after a
   * dwell-to-talk fired). If that happens while chatOpen is true the player
   * is silently locked out of movement — close the chat so the effect above
   * re-enables input. */
  useEffect(() => {
    if (chatOpen && !selectedAgent) setChatOpen(false);
  }, [chatOpen, selectedAgent]);

  /* ── Cleanup gossip toast timer on unmount ───────────────── */

  useEffect(() => {
    return () => {
      if (gossipTimerRef.current) window.clearTimeout(gossipTimerRef.current);
    };
  }, []);

  /* ── Bootstrap/reconcile agents when the scene or roster changes ───── */

  useEffect(() => {
    const scene = gameRef.current?.scene.getScene("TownScene") as TownScene | undefined;
    if (!scene?.scene?.isActive()) return;

    // Landmark lookup drives initial resident placement. Apply authoritative
    // staged/API town data first whenever it is already available; if it
    // arrives after scene boot, this effect runs again and rebases positions
    // once against the canonical landmark set.
    const activeTownData = townData?.[town];
    if (activeTownData) scene.setTownData(activeTownData);
    reconcileScene(scene);
    lastProcessedCursor.current = ws.eventCursor;
    // eventCursor is sampled only when the scene/roster bootstrap changes; it
    // must not make this effect consume normal incremental events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [townAgents.length, sceneReady, town, townData, reconcileScene]);

  /* ── Process new events ──────────────────────────────────── */

  useEffect(() => {
    const scene = gameRef.current?.scene.getScene("TownScene") as TownScene | undefined;
    if (!scene?.scene?.isActive()) return;

    const delta = eventsSince(ws, lastProcessedCursor.current);
    lastProcessedCursor.current = ws.eventCursor;

    // Seeking backward, jumping a long distance, or missing part of a bounded
    // live window must undo future visuals and avoid firing an animation storm.
    // Durable state (location/opinion/activity/clock/weather) is reconciled in
    // one pass; normal paced playback still gets every event effect below.
    if (
      delta.direction === "backward" ||
      delta.historyGap ||
      delta.events.length > 48
    ) {
      reconcileScene(scene);
      setGossipToast(null);
      window.clearTimeout(gossipTimerRef.current);
      return;
    }

    for (const evt of delta.events) {
      if ("town" in evt && (evt as any).town && (evt as any).town !== town) continue;

      switch (evt.type) {
        case "agent_moved":
          scene.moveAgent(evt.agent_id, evt.to_location, evt.x ?? undefined, evt.y ?? undefined);
          break;
        case "agent_speech":
          scene.showAgentSpeech(evt.agent_id, evt.text);
          if (evt.gesture && evt.gesture !== "none") {
            scene.playGesture(evt.agent_id, evt.gesture);
          }
          break;
        case "opinion_changed": {
          scene.updateAgentOpinion(evt.agent_id, evt.new_opinion.candidate);
          // Wayfinding glow + "!" emote in the NEW candidate color (FIX 16)
          scene.showAgentEmote(evt.agent_id, "opinion_changed");
          const delta = evt.confidence_delta ?? Math.abs((evt.new_opinion.confidence ?? 0) - (evt.old_opinion?.confidence ?? 0));
          if (delta >= 0) {
            try { scene.playOpinionShiftBeat(evt.agent_id); } catch { /* ignore */ }
          }
          break;
        }
        case "conversation_started":
          // Backend-driven sims now also pair-face participants (FIX 5).
          try { scene.handleConversationStarted(evt.conversation); } catch { /* ignore */ }
          for (const pid of evt.conversation.participants) {
            scene.showAgentEmote(pid, "reflecting");
            scene.showAgentSpeech(pid, `Discussing: ${evt.conversation.topic}`);
          }
          break;
        case "conversation_ended":
          try { scene.handleConversationEnded(evt.conversation_id); } catch { /* ignore */ }
          break;
        case "cross_town_gossip": {
          const e = evt as any;
          if (e.to_town === town) {
            try { scene.handleCrossTownGossip(e); } catch { /* ignore */ }
            setGossipToast(e.message);
            window.clearTimeout(gossipTimerRef.current);
            gossipTimerRef.current = window.setTimeout(() => setGossipToast(null), 1500);
          }
          break;
        }
        case "news_injected":
          try { scene.playNewsBeat(); } catch { /* ignore */ }
          break;
        case "simulation_ended":
          try { scene.playSimEndBeat(); } catch { /* ignore */ }
          break;
        case "world_clock_tick":
          try { scene.setWorldTime(evt.hour, evt.minute); } catch { /* ignore */ }
          break;
        case "weather_changed":
          try { scene.setWeather(evt.weather); } catch { /* ignore */ }
          break;
      }
    }
  }, [ws.eventCursor, town, sceneReady, reconcileScene]);

  /* ── Overlay data callback ─────────────────────────────────── */

  const getOverlayData = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene?.scene?.isActive()) return [];
    return scene.getOverlayData();
  }, []);

  const getPlayer = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene?.scene?.isActive()) return null;
    const ps = scene.getPlayerSprite();
    if (!ps) return null;
    return { x: ps.x, y: ps.y };
  }, []);

  const getAgent = useCallback((id: string) => agentLookup.get(id), [agentLookup]);

  const getMiniMapData = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene?.scene?.isActive()) return null;
    try {
      return scene.getMiniMapData();
    } catch {
      return null;
    }
  }, []);

  const handleMiniMapPin = useCallback((agentId: string) => {
    const scene = sceneRef.current;
    if (!scene?.scene?.isActive()) return;
    const sprite = (scene as any).agentSprites?.get?.(agentId);
    if (sprite && typeof sprite.x === "number") {
      try {
        scene.cameras.main.pan(sprite.x, sprite.y, 700, "Sine.easeInOut");
      } catch { /* ignore */ }
    }
  }, []);

  /* ── Debug overlay toggle (~) ──────────────────────────────── */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "`" || e.key === "~") {
        setDebugOpen((b) => !b);
      } else if (e.key === "t" || e.key === "T") {
        if (listenNearbyLandmark) {
          setListenOpen((b) => !b);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listenNearbyLandmark]);

  const getClosestAgent = useCallback(() => {
    const player = getPlayer();
    if (!player) return null;
    let best: { id: string; distance: number } | null = null;
    for (const a of townAgents) {
      const scene = sceneRef.current;
      if (!scene) continue;
      const sp = (scene as any).agentSprites?.get?.(a.id);
      if (!sp) continue;
      const d = Math.hypot(sp.x - player.x, sp.y - player.y);
      if (!best || d < best.distance) best = { id: a.id, distance: d };
    }
    return best;
  }, [getPlayer, townAgents]);

  /* ── Listen-in detection: player within 80px of park/transit/church ── */

  useEffect(() => {
    const id = setInterval(() => {
      const player = getPlayer();
      const data = getMiniMapData();
      if (!player || !data) return;
      const eligible = data.landmarks.filter(
        (lm) => ["park", "transit", "transport", "church"].includes(lm.type)
      );
      const ag = data.agents || [];
      let near: string | null = null;
      for (const lm of eligible) {
        const cx = lm.x + lm.w / 2;
        const cy = lm.y + lm.h / 2;
        if (Math.hypot(cx - player.x, cy - player.y) > 80) continue;
        const inBoundsCount = ag.filter((a) =>
          a.x >= lm.x && a.x <= lm.x + lm.w && a.y >= lm.y && a.y <= lm.y + lm.h
        ).length;
        if (inBoundsCount >= 2) {
          near = lm.name;
          break;
        }
      }
      setListenNearbyLandmark((prev) => (prev === near ? prev : near));
      if (!near && listenOpen) setListenOpen(false);
    }, 400);
    return () => clearInterval(id);
  }, [getPlayer, getMiniMapData, listenOpen]);

  /* ── UI Callbacks ────────────────────────────────────────── */

  const openChat = useCallback((agentId: string) => {
    const ag = townAgents.find((a) => a.id === agentId);
    if (ag) {
      preChatRef.current = {
        agentId,
        opinion: ag.opinion,
        trust: trustFor(agentId),
      };
      markAgentMet(agentId);
    }
    setSelectedAgentId(agentId);
    setChatOpen(true);
  }, [townAgents, trustFor, markAgentMet]);

  // Keep the Phaser event handler ref in sync with the latest openChat so
  // canvas clicks (agent-clicked / player-interact) take the SAME path as
  // sidebar clicks — capturing pre-chat opinion + marking agent met.
  useEffect(() => {
    openChatRef.current = openChat;
  }, [openChat]);

  const handleCloseChat = useCallback(() => {
    setChatOpen(false);

    // On close, check for persuasion + write journal entry
    const pre = preChatRef.current;
    if (!pre) return;
    const ag = townAgents.find((a) => a.id === pre.agentId);
    if (!ag) {
      preChatRef.current = null;
      return;
    }
    const beforeOp = pre.opinion;
    const afterOp = ag.opinion;
    const candidateChanged = beforeOp?.candidate !== afterOp?.candidate;
    const confidenceJumped =
      (afterOp?.confidence ?? 0) - (beforeOp?.confidence ?? 0) >= 10;
    if (candidateChanged || confidenceJumped) {
      markAgentPersuaded(pre.agentId);
    }

    // Persist journal entry to backend (silent on error)
    const transcript = lastChatTranscriptRef.current[pre.agentId] ?? [];
    const trustAfter = trustFor(pre.agentId);
    const playerId = profile?.playerId;
    if (playerId && (transcript.length > 0 || candidateChanged || confidenceJumped)) {
      void (async () => {
        if (!DEMO_MODE && !await registerPlayerCapability(playerId)) return;
        await fetch("/api/journal/entry", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...playerCapabilityHeaders(),
          },
          body: JSON.stringify({
            user_id: playerId,
            agent_id: pre.agentId,
            agent_name: ag.name,
            town: ag.town,
            transcript: transcript
              .filter((m) => m.role === "user" || m.role === "agent")
              .map((m) => ({ role: m.role, content: m.content, ts: m.timestamp })),
            opinion_before: beforeOp,
            opinion_after: afterOp,
            trust_before: pre.trust,
            trust_after: trustAfter,
          }),
        });
      })().catch((err) => {
        console.warn("[Township] journal POST failed:", err);
      });
    }
    preChatRef.current = null;
  }, [townAgents, profile?.playerId, trustFor, markAgentPersuaded]);

  const handleTranscriptUpdate = useCallback((agentId: string, msgs: ChatMessage[]) => {
    lastChatTranscriptRef.current[agentId] = msgs;
  }, []);

  // Filter agent-speech events that originated at the listen-in landmark
  const listenInSpeech = useMemo(() => {
    if (!listenOpen || !listenNearbyLandmark) return [];
    return ws.events
      .filter(
        (e) =>
          e.type === "agent_speech" &&
          (e as any).location === listenNearbyLandmark &&
          (e as any).town === town,
      )
      .slice(-20) as Array<{ agent_id: string; agent_name: string; text: string; type: "agent_speech" }>;
  }, [listenOpen, listenNearbyLandmark, ws.events, town]);

  return (
    <div className="town-view-layout">
      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Town header */}
        <div
          className="px-6 py-3 flex items-center gap-4"
          style={{
            background: "var(--warm-glass)",
            backdropFilter: "blur(var(--warm-glass-blur))",
            WebkitBackdropFilter: "blur(var(--warm-glass-blur))",
            borderBottom: "1px solid var(--warm-glass-border)",
          }}
        >
          <div
            className="w-3 h-3 rounded-full"
            style={{
              background: meta.color,
              animation: "pulse-glow 2s ease-in-out infinite",
            }}
          />
          <div>
            <h2
              className="font-semibold"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "18px",
                fontWeight: 600,
                color: "var(--text-primary)",
              }}
            >
              {meta.name}
            </h2>
            <p style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--text-muted)" }}>
              {[meta.tagline, meta.county, meta.population ? `Pop. ${meta.population}` : ""]
                .filter(Boolean)
                .join(" | ")}
            </p>
          </div>
          {ws.simulationRunning && (
            <div
              className="ml-auto px-3 py-1 rounded-full text-xs font-medium"
              style={{
                background: "color-mix(in srgb, var(--color-success) 10%, transparent)",
                color: "var(--color-success)",
              }}
            >
              Round {ws.currentRound} / {ws.totalRounds || scen.totalRounds}
            </div>
          )}
        </div>

        {/* Phaser canvas */}
        <div
          className="town-canvas-wrapper pixel-frame pixel-frame--inset flex-1 relative"
          style={{ background: "var(--pixel-canvas-mat)" }}
          aria-busy={!sceneReady && !sceneError}
        >
          <div ref={gameContainerRef} className="absolute inset-0" />
          {/* Parchment shimmer while the scene boots */}
          {!sceneReady && !sceneError && (
            <div className="town-canvas-skeleton" role="status" aria-live="polite">
              <span className="town-canvas-skeleton-label">Entering {meta.name}…</span>
            </div>
          )}
          {sceneError && (
            <div className="town-canvas-error" role="alert">
              <span className="town-canvas-error-mark" aria-hidden="true">!</span>
              <strong>{sceneError}</strong>
              <span>Your residents and replay are safe. Try loading the scene again.</span>
              <button type="button" onClick={() => setSceneBootAttempt((attempt) => attempt + 1)}>
                Try again
              </button>
            </div>
          )}
          <div className="canvas-vignette" />

          {/* DOM overlay for agent/landmark labels + proximity card */}
          <CanvasOverlay
            gameRef={gameRef}
            getOverlayData={getOverlayData}
            getPlayer={getPlayer}
            getAgent={getAgent}
            getTrust={trustFor}
            bottomInset={12}
          />

          {/* HUD top-left */}
          <div className="town-hud-top-left">
            <PlayerHUD
              worldClock={ws.worldClock}
              weather={ws.weather}
              totalAgents={streamedTotalAgents}
            />
          </div>

          {/* Top-right clock chip (FIX 13) */}
          <div className="world-clock-chip" aria-hidden="true">
            <span className="world-clock-chip-icon">
              {(ws.worldClock.hour >= 19 || ws.worldClock.hour < 6) ? "☾" : "☀"}
            </span>
            <span className="world-clock-chip-time">
              {String(ws.worldClock.hour).padStart(2, "0")}:{String(ws.worldClock.minute).padStart(2, "0")}
            </span>
          </div>

          {/* Mini-map top-right */}
          <div className="town-minimap-wrapper">
            <MiniMap
              getData={getMiniMapData}
              townId={town}
              previewPath={meta.map?.preview_path}
              showAuthoredPreview={hasAuthoredTownMap(meta.map?.path)}
              onPinClick={handleMiniMapPin}
            />
          </div>

          {/* Cross-town gossip toast */}
          {gossipToast && (
            <div className="gossip-toast" role="status">
              <span className="gossip-toast-dot" />
              {gossipToast}
            </div>
          )}

          {/* DOM title banner */}
          <div className="town-canvas-title absolute top-2 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
            <div
              className="px-6 py-1.5 rounded-lg"
              style={{
                background: "color-mix(in srgb, var(--overlay-ink) 52%, transparent)",
                backdropFilter: "blur(4px)",
                borderRadius: "9px",
              }}
            >
              <span
                className="text-base font-bold"
                style={{
                  fontFamily: "var(--font-display)",
                  color: "var(--text-on-accent)",
                  textShadow: "0 1px 3px rgba(0,0,0,0.4)",
                  letterSpacing: "0.5px",
                }}
              >
                {meta.name}
              </span>
            </div>
          </div>

          {/* Listen-in affordance + side panel */}
          {listenNearbyLandmark && !chatOpen && (
            <div className="listen-in-chip">
              {listenOpen ? (
                <span>Listening at <strong>{listenNearbyLandmark}</strong></span>
              ) : (
                <span>Press <kbd>T</kbd> to listen at <strong>{listenNearbyLandmark}</strong></span>
              )}
            </div>
          )}
          {listenOpen && listenNearbyLandmark && (
            <div className="listen-in-panel">
              <div className="listen-in-panel-header">
                <strong>{listenNearbyLandmark}</strong>
                <button onClick={() => setListenOpen(false)} aria-label="Close listen panel">×</button>
              </div>
              <div className="listen-in-panel-body">
                {listenInSpeech.length === 0 && (
                  <p style={{ color: "var(--text-muted)", fontSize: 12 }}>
                    Quiet right now. Stick around — voices will catch up here.
                  </p>
                )}
                {listenInSpeech.map((e, i) => (
                  <p key={i} className="listen-in-line">
                    <strong style={{ color: meta.color }}>{e.agent_name}:</strong> {e.text}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Keyboard hint overlay */}
          {showKeyboardHint && isOnboarded && (
            <KeyboardHint onDismiss={() => setShowKeyboardHint(false)} />
          )}

          {/* The hosted replay is immediately explorable without a player;
              movement onboarding belongs to the interactive local flow. */}
          {isOnboarded && !DEMO_MODE && <Tutorial />}

          {/* Debug overlay (toggled with ~) */}
          {debugOpen && (
            <DebugOverlay
              events={ws.events}
              worldClock={ws.worldClock}
              weather={ws.weather}
              getPlayer={getPlayer}
              getClosestAgent={getClosestAgent}
            />
          )}
        </div>
      </div>

      {/* Sidebar: agent list */}
      <div className="town-view-sidebar">
        <div className="px-4 py-3 border-b" style={{ borderColor: "rgba(180,160,120,0.12)" }}>
          <h3 className="text-xs font-semibold uppercase tracking-wider" style={{
            fontFamily: "var(--font-display)",
            color: "var(--gold-ink)",
            letterSpacing: "2.5px",
            fontSize: "11px",
          }}>
            Residents ({townAgents.length + (playerAgentState ? 1 : 0)})
          </h3>
          {/* Ornamental separator */}
          <svg width="120" height="8" viewBox="0 0 120 8" className="mt-2 opacity-60">
            <defs>
              <linearGradient id="sidebar-sep" x1="0%" y1="50%" x2="100%" y2="50%">
                <stop offset="0%" stopColor="var(--gold-accent)" stopOpacity="0" />
                <stop offset="30%" stopColor="var(--gold-accent)" stopOpacity="0.35" />
                <stop offset="50%" stopColor="var(--gold-accent)" stopOpacity="0.5" />
                <stop offset="70%" stopColor="var(--gold-accent)" stopOpacity="0.35" />
                <stop offset="100%" stopColor="var(--gold-accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <line x1="0" y1="4" x2="120" y2="4" stroke="url(#sidebar-sep)" strokeWidth="1" />
            <rect x="55" y="1" width="6" height="6" rx="0.5" transform="rotate(45 58 4)" fill="var(--gold-accent)" opacity="0.4" />
          </svg>
        </div>
        <div className="flex-1 overflow-y-auto px-1.5 py-1.5 flex flex-col gap-0">
          {/* Player card at top */}
          {playerAgentState && (
            <div className="player-sidebar-card">
              <AgentCard agent={playerAgentState} compact onClick={() => {}} />
              <span className="player-badge">YOU</span>
            </div>
          )}
          {/* NPC agents */}
          {townAgents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              compact
              onClick={() => openChat(agent.id)}
              met={profile?.metAgents?.includes(agent.id)}
              persuaded={profile?.persuadedAgents?.includes(agent.id)}
              trust={trustFor(agent.id)}
            />
          ))}
        </div>

        {/* Recent events for this town */}
        <div className="border-t px-3 py-2" style={{ borderColor: "rgba(180,160,120,0.12)" }}>
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-1.5" style={{
            fontFamily: "var(--font-display)",
            color: "var(--gold-ink)",
            letterSpacing: "2px",
            fontSize: "11px",
          }}>
            Recent Activity
          </h3>
          <div className="flex flex-col gap-1 max-h-[120px] overflow-y-auto">
            {(() => {
              // Stable absolute keys so a freshly-arrived row animates exactly once.
              const rows: Array<{ key: number; evt: SimulationEvent }> = [];
              ws.events.forEach((e, i) => {
                if ("town" in e && (e as any).town === town) {
                  rows.push({ key: ws.eventHistoryStart + i, evt: e });
                }
              });
              return rows.slice(-5).reverse().map(({ key, evt }) => {
                if (evt.type === "opinion_changed") {
                  const newC = (evt.new_opinion?.candidate as LeanId) || scen.undecidedId;
                  const stance = scen.optionColor(newC);
                  return (
                    <div key={key} className="town-activity-row town-activity-row--shift flex items-center gap-1.5">
                      <span
                        className="town-activity-shift-dot w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ background: stance }}
                      />
                      <p style={{ fontFamily: "var(--font-body)", fontSize: "11px", color: "var(--text-secondary)" }}>
                        <strong style={{ color: "var(--text-primary)", fontWeight: 600 }}>{evt.agent_name}</strong>
                        {" shifted → "}
                        <strong style={{ color: readableInk(stance), fontWeight: 600 }}>
                          {scen.optionLabel(newC)}
                        </strong>
                      </p>
                    </div>
                  );
                }
                return (
                  <div key={key} className="town-activity-row flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: meta.color }} />
                    <p style={{ fontFamily: "var(--font-body)", fontSize: "11px", color: "var(--text-secondary)" }}>
                      {eventLabel(evt, scen.optionLabel)}
                    </p>
                  </div>
                );
              });
            })()}
            {ws.events.filter((e) => "town" in e && (e as any).town === town).length === 0 && (
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: meta.color }} />
                <p className="italic" style={{ fontFamily: "var(--font-body)", fontSize: "11px", color: "var(--text-secondary)" }}>
                  Waiting for simulation events...
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Chat panel */}
      {chatOpen && (
        <ChatPanel
          agent={selectedAgent}
          onClose={handleCloseChat}
          onTranscriptChange={handleTranscriptUpdate}
        />
      )}
    </div>
  );
}

/* ── Helper ────────────────────────────────────────────────── */

function eventLabel(evt: SimulationEvent, optionLabel: (id: string) => string): string {
  switch (evt.type) {
    case "agent_moved":
      return `${evt.agent_name} moved to ${evt.to_location}`;
    case "agent_speech":
      return `${evt.agent_name}: "${evt.text.slice(0, 40)}..."`;
    case "opinion_changed":
      // Display label, never the raw option id ("Bond", not "bond").
      return `${evt.agent_name} shifted to ${optionLabel(evt.new_opinion.candidate)}`;
    case "conversation_started":
      return `${evt.conversation.participant_names.join(" & ")} started talking`;
    default:
      return evt.type.replace(/_/g, " ");
  }
}
