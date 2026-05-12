import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { AgentState, ChatMessage, LeanId } from "../types/messages";
import { TOWN_META, CANDIDATE_COLORS, CANDIDATE_NAMES } from "../types/messages";
import { AGENT_VOICES, AGENT_VOICE_MAP } from "../game/config";
import { resolveAgentSprite } from "../game/spriteCustomization";
import { useUserProfile } from "../context/UserProfileContext";
import { useRelationships } from "../hooks/useRelationships";
import { useWebSocketContext } from "../context/WebSocketContext";
import { useAudio } from "../hooks/useAudio";
import SpritePortrait from "./SpritePortrait";
import MoodIndicator from "./MoodIndicator";
import TrustBadge from "./TrustBadge";

/* ── Persistent transcripts (one record per agent across panel reopens) ── */

const TRANSCRIPT_CACHE: Record<string, ChatMessage[]> = {};

/* ── ElevenLabs TTS Helper ───────────────────────────────────── */

function getVoiceId(agentId: string): string {
  const voiceType = AGENT_VOICE_MAP[agentId] || "default";
  const voice = AGENT_VOICES[voiceType] || AGENT_VOICES["default"];
  return voice.voiceId;
}

async function speakWithElevenLabs(
  text: string,
  voiceId: string,
  onStart: () => void,
  onEnd: () => void,
  onError: (err: string) => void,
): Promise<void> {
  const apiKey = (import.meta as any).env?.VITE_ELEVENLABS_API_KEY;
  if (!apiKey) {
    onError("ElevenLabs API key not configured (set VITE_ELEVENLABS_API_KEY)");
    return;
  }

  onStart();

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": apiKey,
        },
        body: JSON.stringify({
          text: text.slice(0, 1000),
          model_id: "eleven_monolingual_v1",
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`ElevenLabs API error: ${response.status}`);
    }

    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);

    audio.onended = () => {
      URL.revokeObjectURL(audioUrl);
      onEnd();
    };
    audio.onerror = () => {
      URL.revokeObjectURL(audioUrl);
      onError("Audio playback failed");
    };

    await audio.play();
  } catch (err: any) {
    onError(err.message || "TTS failed");
  }
}

/* ── Speaker Icon ────────────────────────────────────────────── */

function SpeakerIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3L4.5 5.5H2v5h2.5L8 13V3z" />
      <path d="M10.5 5.5a3.5 3.5 0 010 5" />
      <path d="M12 4a5.5 5.5 0 010 8" />
    </svg>
  );
}

function MicIcon({ size = 16, recording = false }: { size?: number; recording?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="2" width="4" height="8" rx="2" fill={recording ? "currentColor" : "none"} />
      <path d="M4 9a4 4 0 008 0" />
      <path d="M8 13v2" />
    </svg>
  );
}

function LoadingDots() {
  return (
    <span className="inline-flex gap-0.5">
      <span className="w-1 h-1 rounded-full bg-current animate-bounce" style={{ animationDelay: "0ms" }} />
      <span className="w-1 h-1 rounded-full bg-current animate-bounce" style={{ animationDelay: "150ms" }} />
      <span className="w-1 h-1 rounded-full bg-current animate-bounce" style={{ animationDelay: "300ms" }} />
    </span>
  );
}

/* ── Listen Button Component ─────────────────────────────────── */

function ListenButton({ text, agentId }: { text: string; agentId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "playing" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleClick = () => {
    if (state === "loading" || state === "playing") return;
    const voiceId = getVoiceId(agentId);
    speakWithElevenLabs(
      text,
      voiceId,
      () => setState("playing"),
      () => setState("idle"),
      (err) => {
        setErrorMsg(err);
        setState("error");
        setTimeout(() => setState("idle"), 3000);
      },
    );
    setState("loading");
  };

  return (
    <button
      onClick={handleClick}
      disabled={state === "loading" || state === "playing"}
      className="listen-btn inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-colors"
      style={{
        color:
          state === "playing"
            ? "var(--civic-blue)"
            : state === "error"
              ? "#EF4444"
              : "var(--township-ink-muted)",
        background: state === "playing" ? "rgba(59,89,152,0.08)" : "transparent",
        cursor: state === "loading" || state === "playing" ? "default" : "pointer",
        opacity: state === "loading" ? 0.6 : 1,
      }}
      title={state === "error" ? errorMsg : "Listen to this message"}
    >
      {state === "loading" ? (
        <LoadingDots />
      ) : state === "playing" ? (
        <>
          <SpeakerIcon size={12} />
          <span>Playing...</span>
        </>
      ) : state === "error" ? (
        <span>No API key</span>
      ) : (
        <SpeakerIcon size={12} />
      )}
    </button>
  );
}

/* ── Chat Mode Toggle ────────────────────────────────────────── */

function ChatModeToggle({
  mode,
  onChange,
}: {
  mode: "manual" | "auto";
  onChange: (m: "manual" | "auto") => void;
}) {
  return (
    <div className="chat-mode-toggle">
      <button
        className={`chat-mode-toggle-btn ${mode === "manual" ? "chat-mode-toggle-btn--active" : ""}`}
        onClick={() => onChange("manual")}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M2 12V4a2 2 0 012-2h8a2 2 0 012 2v5a2 2 0 01-2 2H5l-3 3z" />
        </svg>
        Manual
      </button>
      <button
        className={`chat-mode-toggle-btn ${mode === "auto" ? "chat-mode-toggle-btn--active" : ""}`}
        onClick={() => onChange("auto")}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M8 1l1.5 4.5L14 7l-4.5 1.5L8 13l-1.5-4.5L2 7l4.5-1.5z" />
        </svg>
        Auto
      </button>
    </div>
  );
}

/* ── Mood classifier ─────────────────────────────────────────── */

function classifyMood(text: string): "positive" | "negative" | "neutral" {
  const t = text.toLowerCase();
  const positive = ["great", "hopeful", "good", "thank", "love", "glad", "amazing", "wonderful", "yes"];
  const negative = ["concerned", "worried", "scared", "angry", "no ", "won't", "terrible", "hate", "frustrat"];
  if (positive.some((w) => t.includes(w))) return "positive";
  if (negative.some((w) => t.includes(w))) return "negative";
  return "neutral";
}

/* ── Topic suggestions ───────────────────────────────────────── */

const TOPIC_FALLBACKS: Record<string, string[]> = {
  default: ["healthcare", "immigration", "taxes", "schools", "housing"],
};

function topicsForAgent(agent: AgentState): string[] {
  const out: string[] = [];
  const tops = agent.opinion?.top_issues ?? [];
  for (const t of tops) if (t && !out.includes(t)) out.push(t);

  // Town-specific defaults
  const townTopics: Record<string, string[]> = {
    dover: ["immigration", "healthcare", "small business"],
    montclair: ["education", "social justice", "housing"],
    parsippany: ["taxes", "schools", "community"],
    randolph: ["taxes", "schools", "national security"],
  };
  for (const t of townTopics[agent.town] || []) {
    if (!out.includes(t)) out.push(t);
  }
  for (const t of TOPIC_FALLBACKS.default) {
    if (out.length >= 5) break;
    if (!out.includes(t)) out.push(t);
  }
  return out.slice(0, 5);
}

/* ── ChatPanel ───────────────────────────────────────────────── */

interface ChatPanelProps {
  agent: AgentState | null;
  onClose: () => void;
  /** Called when transcript updates (used to persist as a journal entry). */
  onTranscriptChange?: (agentId: string, messages: ChatMessage[]) => void;
}

export default function ChatPanel({ agent, onClose, onTranscriptChange }: ChatPanelProps) {
  const { profile, chatMode, setChatMode } = useUserProfile();
  // We also use WS so we can read live relationships into the chat header.
  const ws = useWebSocketContext();
  const audio = useAudio();
  const { trustFor } = useRelationships(profile?.playerId, {
    liveRelationships: ws.relationships,
  });

  const initialMessages = (): ChatMessage[] => {
    if (agent && TRANSCRIPT_CACHE[agent.id]) return TRANSCRIPT_CACHE[agent.id];
    if (!agent) return [];
    const playerName = profile?.name || "You";
    return [
      {
        id: "system-intro",
        role: "system",
        content: `${playerName} approaches ${agent.name}, ${agent.occupation} in ${TOWN_META[agent.town].name}.`,
        timestamp: new Date().toISOString(),
      },
    ];
  };

  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [mood, setMood] = useState<"positive" | "negative" | "neutral">("neutral");
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memories, setMemories] = useState<string[] | null>(null);
  const [recording, setRecording] = useState(false);
  const autoAbortRef = useRef(false);
  const autoStartedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const lastAgentMsgIdRef = useRef<string | null>(null);

  // Update transcript cache + parent
  useEffect(() => {
    if (!agent) return;
    TRANSCRIPT_CACHE[agent.id] = messages;
    onTranscriptChange?.(agent.id, messages);
  }, [agent, messages, onTranscriptChange]);

  // Reset / hydrate when agent changes (don't wipe transcripts)
  useEffect(() => {
    if (!agent) return;
    if (TRANSCRIPT_CACHE[agent.id]) {
      setMessages(TRANSCRIPT_CACHE[agent.id]);
    } else {
      const playerName = profile?.name || "You";
      const intro: ChatMessage = {
        id: "system-intro",
        role: "system",
        content: `${playerName} approaches ${agent.name}, ${agent.occupation} in ${TOWN_META[agent.town].name}.`,
        timestamp: new Date().toISOString(),
      };
      setMessages([intro]);
      TRANSCRIPT_CACHE[agent.id] = [intro];
    }
    setMobileExpanded(true);
    setAutoRunning(false);
    autoAbortRef.current = false;
    lastAgentMsgIdRef.current = null;
    setMemories(null);
    setMemoryOpen(false);
    // Audio cue: opening the chat with a new agent.
    audio.play("chat_open");
    // Fire-and-forget memory peek fetch (gracefully degrades)
    fetch(`/api/simulation/agent/${encodeURIComponent(agent.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        const memList =
          (Array.isArray(data.memories) && data.memories.slice(-5)) ||
          (Array.isArray(data.memory) && data.memory.slice(-5)) ||
          null;
        if (memList) setMemories(memList);
      })
      .catch(() => { /* graceful degrade */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent?.id]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Update mood based on latest agent message
  useEffect(() => {
    const latestAgent = [...messages].reverse().find((m) => m.role === "agent");
    if (latestAgent && latestAgent.id !== lastAgentMsgIdRef.current) {
      lastAgentMsgIdRef.current = latestAgent.id;
      setMood(classifyMood(latestAgent.content));
      // Voice auto-play
      if (agent && profile?.audioAutoplay) {
        const voiceId = getVoiceId(agent.id);
        speakWithElevenLabs(
          latestAgent.content,
          voiceId,
          () => {},
          () => {},
          () => {},
        );
      }
    }
  }, [messages, agent, profile?.audioAutoplay]);

  // Start auto-conversation when switching to auto mode
  useEffect(() => {
    if (chatMode === "auto" && agent && !autoRunning && !autoStartedRef.current) {
      autoStartedRef.current = true;
      runAutoConversation();
    }
    if (chatMode === "manual") {
      autoAbortRef.current = true;
      autoStartedRef.current = false;
      setAutoRunning(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatMode, agent?.id]);

  /* ── Manual mode: send message ─────────────────────────── */

  const sendMessage = useCallback(async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || !agent || sending) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);
    audio.play("chat_send");

    // Typing indicator
    const typingId = `typing-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: typingId, role: "system", content: "Thinking...", timestamp: new Date().toISOString() },
    ]);

    try {
      const body: any = { message: userMsg.content };
      if (profile) {
        body.user_profile = {
          name: profile.name,
          town: profile.town,
          political_leaning: profile.politicalLeaning,
          top_concerns: profile.topConcerns,
        };
        if (profile.playerId) body.user_id = profile.playerId;
      }

      const res = await fetch(`/api/chat/${encodeURIComponent(agent.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      setMessages((prev) => prev.filter((m) => m.id !== typingId));

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const agentMsg: ChatMessage = {
        id: `agent-${Date.now()}`,
        role: "agent",
        content: data.response || data.message || "...",
        timestamp: new Date().toISOString(),
        agent_id: agent.id,
      };
      setMessages((prev) => [...prev, agentMsg]);
    } catch (err: any) {
      setMessages((prev) => prev.filter((m) => m.id !== typingId));
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: "system",
          content: `Could not reach ${agent.name}. (${err.message})`,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
    }
  }, [input, agent, sending, profile, audio]);

  /* ── Topic chip click ─────────────────────────────────────── */

  const onTopicChipClick = useCallback((topic: string) => {
    const message = `Tell me about ${topic}`;
    setInput(message);
  }, []);

  /* ── Push-to-talk mic ─────────────────────────────────────── */

  const startRecording = useCallback(async () => {
    if (recording) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessages((prev) => [
        ...prev,
        {
          id: `notice-${Date.now()}`,
          role: "system",
          content: "Mic transcription not available in this browser.",
          timestamp: new Date().toISOString(),
        },
      ]);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recordedChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        // Tear down audio stream
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordedChunksRef.current, { type: "audio/webm" });
        if (blob.size === 0) return;
        // Try /api/transcribe — gracefully degrade if missing
        try {
          const fd = new FormData();
          fd.append("audio", blob, "voice.webm");
          const res = await fetch("/api/transcribe", { method: "POST", body: fd });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          const transcript = data.text || data.transcript || "";
          if (transcript) {
            setInput(transcript);
          }
        } catch {
          setMessages((prev) => [
            ...prev,
            {
              id: `notice-${Date.now()}`,
              role: "system",
              content: "Mic transcription not available.",
              timestamp: new Date().toISOString(),
            },
          ]);
        }
      };
      recorder.start();
      setRecording(true);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `notice-${Date.now()}`,
          role: "system",
          content: "Microphone access denied.",
          timestamp: new Date().toISOString(),
        },
      ]);
    }
  }, [recording]);

  const stopRecording = useCallback(() => {
    if (!recording) return;
    try {
      mediaRecorderRef.current?.stop();
    } catch { /* ignore */ }
    setRecording(false);
  }, [recording]);

  /* ── Auto mode: AI-driven conversation ─────────────────── */

  const runAutoConversation = useCallback(async () => {
    if (!agent || !profile || autoRunning) return;
    setAutoRunning(true);
    autoAbortRef.current = false;

    const history: Array<{ role: string; content: string }> = [];
    let turnCounter = 0;

    for (let turn = 0; turn < 5; turn++) {
      if (autoAbortRef.current) break;

      try {
        await new Promise((r) => setTimeout(r, turn === 0 ? 500 : 2000));
        if (autoAbortRef.current) break;

        const userTypingId = `user-typing-${turnCounter}`;
        if (turn > 0) {
          setMessages((prev) => [
            ...prev,
            { id: userTypingId, role: "system", content: "You're thinking...", timestamp: new Date().toISOString() },
          ]);
        }

        const res = await fetch(`/api/chat/auto/${encodeURIComponent(agent.id)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_profile: {
              name: profile.name,
              town: profile.town,
              political_leaning: profile.politicalLeaning,
              top_concerns: profile.topConcerns,
              personality: profile.personality,
            },
            user_id: profile.playerId,
            conversation_history: history,
          }),
        });

        if (turn > 0) {
          setMessages((prev) => prev.filter((m) => m.id !== userTypingId));
        }

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (autoAbortRef.current) break;

        const userText = data.user_message || `What do you think about the election?`;
        const agentText = data.agent_response || "...";

        const userMsg: ChatMessage = {
          id: `auto-user-${turnCounter}-${Date.now()}`,
          role: "user",
          content: userText,
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, userMsg]);
        history.push({ role: "user", content: userText });

        const agentTypingId = `agent-typing-${turnCounter}`;
        setMessages((prev) => [
          ...prev,
          { id: agentTypingId, role: "system", content: `${agent.name.split(" ")[0]} is thinking...`, timestamp: new Date().toISOString() },
        ]);
        await new Promise((r) => setTimeout(r, 1500));
        setMessages((prev) => prev.filter((m) => m.id !== agentTypingId));
        if (autoAbortRef.current) break;

        const agentMsg: ChatMessage = {
          id: `auto-agent-${turnCounter}-${Date.now()}`,
          role: "agent",
          content: agentText,
          timestamp: new Date().toISOString(),
          agent_id: agent.id,
        };
        setMessages((prev) => [...prev, agentMsg]);
        history.push({ role: "agent", content: agentText });

        turnCounter++;
        if (data.should_end) break;
      } catch (err: any) {
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: "system",
            content: `Auto-conversation paused. (${err.message})`,
            timestamp: new Date().toISOString(),
          },
        ]);
        break;
      }
    }

    if (!autoAbortRef.current) {
      setMessages((prev) => [
        ...prev,
        {
          id: `system-end-${Date.now()}`,
          role: "system",
          content: "The conversation naturally winds down...",
          timestamp: new Date().toISOString(),
        },
      ]);
    }

    autoStartedRef.current = false;
    setAutoRunning(false);
  }, [agent, profile, autoRunning]);

  const topics = useMemo(() => (agent ? topicsForAgent(agent) : []), [agent]);
  const sprite = useMemo(() => (agent ? resolveAgentSprite(agent.id) : null), [agent]);

  if (!agent) return null;

  const meta = TOWN_META[agent.town];
  const candidate = (agent.opinion?.candidate as LeanId) || "undecided";
  const opinionLabel = CANDIDATE_NAMES[candidate];
  const initials =
    agent.initials ||
    agent.name
      .split(" ")
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

  const isAuto = chatMode === "auto";
  const trust = trustFor(agent.id);

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className="chat-panel-backdrop"
        onClick={() => onClose()}
        style={{ background: "rgba(0,0,0,0.12)" }}
      />
      <div
        className={`chat-panel fixed top-0 right-0 h-full w-[400px] max-w-full flex flex-col z-50 slide-panel-enter ${mobileExpanded ? "chat-panel--expanded" : ""}`}
        style={{
          background: "var(--bg-paper)",
          borderLeft: "1px solid var(--warm-glass-border)",
          boxShadow: "-8px 0 30px rgba(100,80,50,0.08)",
        }}
      >
        {/* Header */}
        <div
          className="px-4 py-3 flex flex-col"
          style={{ background: "var(--bg-warm)" }}
        >
          <div className="flex items-start gap-3">
            <div style={{ border: `3px solid ${meta.color}`, borderRadius: "50%", padding: 1 }}>
              <SpritePortrait
                agentId={agent.id}
                spriteKey={sprite?.spriteKey}
                fallbackInitials={initials}
                color={agent.color || meta.color}
                size={56}
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <h3 style={{ fontFamily: "var(--font-display)", fontSize: "17px", color: "var(--text-primary)", fontWeight: 600 }}>
                  {agent.name}
                </h3>
                <MoodIndicator mood={mood} size={14} />
              </div>
              <p style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--text-secondary)" }}>
                {agent.occupation}
              </p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className={`town-badge town-badge--${agent.town}`}>{meta.name}</span>
                <span className={`opinion-badge opinion-badge--${agent.opinion?.candidate || "undecided"}`}>
                  {opinionLabel}
                  {agent.opinion?.confidence ? ` ${agent.opinion.confidence}%` : ""}
                </span>
                <TrustBadge trust={trust} size="small" />
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg transition-colors"
                style={{ color: "var(--text-muted)", transition: "color 150ms" }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
                aria-label="Close chat"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M4.5 4.5L13.5 13.5M13.5 4.5L4.5 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
              {profile && (
                <ChatModeToggle mode={chatMode} onChange={setChatMode} />
              )}
            </div>
          </div>
          {/* Ornamental separator */}
          <svg width="100%" height="8" viewBox="0 0 360 8" preserveAspectRatio="none" className="mt-3">
            <defs>
              <linearGradient id="chat-sep" x1="0%" y1="50%" x2="100%" y2="50%">
                <stop offset="0%" stopColor="var(--gold-accent)" stopOpacity="0" />
                <stop offset="30%" stopColor="var(--gold-accent)" stopOpacity="0.3" />
                <stop offset="50%" stopColor="var(--gold-accent)" stopOpacity="0.45" />
                <stop offset="70%" stopColor="var(--gold-accent)" stopOpacity="0.3" />
                <stop offset="100%" stopColor="var(--gold-accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <line x1="0" y1="4" x2="360" y2="4" stroke="url(#chat-sep)" strokeWidth="1" />
            <rect x="174" y="1" width="6" height="6" rx="0.5" transform="rotate(45 177 4)" fill="var(--gold-accent)" opacity="0.4" />
          </svg>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
          {messages.map((msg) => (
            <div key={msg.id} className="flex flex-col">
              {msg.role === "agent" && (
                <span style={{
                  fontFamily: "var(--font-body)",
                  fontSize: "11px",
                  color: meta?.color || "var(--text-secondary)",
                  fontWeight: 600,
                  marginBottom: "2px",
                  display: "block",
                }}>
                  {agent?.name.split(" ")[0]}
                </span>
              )}
              <div className={`chat-bubble chat-bubble--${msg.role}`}>
                {msg.content}
              </div>
              {msg.role === "agent" && msg.agent_id && (
                <div className="self-start mt-0.5 ml-1">
                  <ListenButton text={msg.content} agentId={msg.agent_id} />
                </div>
              )}
            </div>
          ))}
          {autoRunning && (
            <div className="flex items-center gap-2 py-2">
              <div className="w-2 h-2 rounded-full bg-[var(--civic-blue)] animate-pulse" />
              <span className="text-xs" style={{ color: "var(--township-ink-muted)" }}>
                Auto-conversation in progress...
              </span>
            </div>
          )}
        </div>

        {/* Memory peek */}
        <details
          className="memory-peek"
          open={memoryOpen}
          onToggle={(e) => setMemoryOpen((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="memory-peek-toggle">
            What {agent.name.split(" ")[0]} remembers
          </summary>
          <div className="memory-peek-body">
            {!memories && (
              <p className="memory-peek-empty">Memories not available for this agent.</p>
            )}
            {memories && memories.length === 0 && (
              <p className="memory-peek-empty">No memories yet.</p>
            )}
            {memories && memories.length > 0 && (
              <ul className="memory-peek-list">
                {memories.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            )}
          </div>
        </details>

        {/* Topic chips */}
        {!isAuto && (
          <div className="topic-chips-row">
            {topics.map((t) => (
              <button
                key={t}
                className="topic-chip"
                onClick={() => onTopicChipClick(t)}
                disabled={sending}
                style={{ borderColor: `${meta.color}55`, color: meta.color }}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="px-4 py-3" style={{ borderTop: "1px solid var(--warm-glass-border)", background: "var(--bg-paper)" }}>
          <div className="relative">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
              placeholder={
                isAuto
                  ? "AI persona is speaking for you..."
                  : `Talk to ${agent.name.split(" ")[0]}...`
              }
              className="w-full pl-5 pr-24 py-3 rounded-full text-sm outline-none"
              style={{
                background: "var(--bg-card)",
                border: "1px solid rgba(180,160,120,0.2)",
                fontFamily: "var(--font-body)",
                fontSize: "13.5px",
                color: "var(--text-primary)",
                opacity: isAuto ? 0.5 : 1,
                transition: "border-color 200ms, box-shadow 200ms",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = `${meta?.color || 'var(--gold-accent)'}80`;
                e.currentTarget.style.boxShadow = `0 0 0 3px ${meta?.color || 'var(--gold-accent)'}14`;
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = 'rgba(180,160,120,0.2)';
                e.currentTarget.style.boxShadow = 'none';
              }}
              disabled={sending || isAuto}
            />
            {isAuto ? (
              <button
                onClick={() => { autoAbortRef.current = true; setChatMode("manual"); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-4 py-1.5 rounded-full text-xs font-medium"
                style={{
                  background: autoRunning ? "#EF4444" : "transparent",
                  color: autoRunning ? "#fff" : "var(--text-muted)",
                  border: autoRunning ? "none" : "1px solid var(--card-border)",
                }}
              >
                {autoRunning ? "Stop" : "Stopped"}
              </button>
            ) : (
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <button
                  onMouseDown={startRecording}
                  onMouseUp={stopRecording}
                  onMouseLeave={() => recording && stopRecording()}
                  onTouchStart={startRecording}
                  onTouchEnd={stopRecording}
                  disabled={sending}
                  title="Hold to record"
                  className="mic-btn w-9 h-9 rounded-full flex items-center justify-center"
                  style={{
                    background: recording ? "#EF4444" : "transparent",
                    color: recording ? "#fff" : "var(--text-muted)",
                    border: "1px solid var(--card-border)",
                    transition: "all 200ms ease",
                  }}
                >
                  <MicIcon size={14} recording={recording} />
                </button>
                <button
                  onClick={() => sendMessage()}
                  disabled={sending || !input.trim()}
                  className="w-9 h-9 rounded-full flex items-center justify-center text-white transition-all disabled:opacity-30"
                  style={{
                    background: meta?.color || "var(--civic-blue)",
                    transition: "all 200ms ease",
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M1 7h10M8 4l3 3-3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
