import { useState, useRef, useEffect, useCallback } from "react";
import type { AgentState, ChatMessage, LeanId } from "../types/messages";
import { TOWN_META, CANDIDATE_COLORS, CANDIDATE_NAMES } from "../types/messages";
import { AGENT_VOICES, AGENT_VOICE_MAP } from "../game/config";
import { useUserProfile } from "../context/UserProfileContext";

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
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
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

/* ── ChatPanel ───────────────────────────────────────────────── */

interface ChatPanelProps {
  agent: AgentState | null;
  onClose: () => void;
}

export default function ChatPanel({ agent, onClose }: ChatPanelProps) {
  const { profile, chatMode, setChatMode } = useUserProfile();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const autoAbortRef = useRef(false);
  const autoStartedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset messages when agent changes
  useEffect(() => {
    if (agent) {
      const playerName = profile?.name || "You";
      setMessages([
        {
          id: "system-intro",
          role: "system",
          content: `${playerName} approaches ${agent.name}, ${agent.occupation} in ${TOWN_META[agent.town].name}.`,
          timestamp: new Date().toISOString(),
        },
      ]);
      setMobileExpanded(true);
      setAutoRunning(false);
      autoAbortRef.current = false;
    }
  }, [agent?.id]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

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
  }, [chatMode, agent?.id]);

  /* ── Manual mode: send message ─────────────────────────── */

  const sendMessage = useCallback(async () => {
    if (!input.trim() || !agent || sending) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: input.trim(),
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);

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
      }

      const res = await fetch(`/api/chat/${agent.id}`, {
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
  }, [input, agent, sending, profile]);

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
        // Small delay between turns
        await new Promise((r) => setTimeout(r, turn === 0 ? 500 : 2000));
        if (autoAbortRef.current) break;

        // Show typing indicator for user persona
        const userTypingId = `user-typing-${turnCounter}`;
        if (turn > 0) {
          setMessages((prev) => [
            ...prev,
            { id: userTypingId, role: "system", content: "You're thinking...", timestamp: new Date().toISOString() },
          ]);
        }

        const res = await fetch(`/api/chat/auto/${agent.id}`, {
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
            conversation_history: history,
          }),
        });

        // Remove user typing indicator
        if (turn > 0) {
          setMessages((prev) => prev.filter((m) => m.id !== userTypingId));
        }

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (autoAbortRef.current) break;

        const userText = data.user_message || `What do you think about the election?`;
        const agentText = data.agent_response || "...";

        // Show user message
        const userMsg: ChatMessage = {
          id: `auto-user-${turnCounter}-${Date.now()}`,
          role: "user",
          content: userText,
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, userMsg]);
        history.push({ role: "user", content: userText });

        // Typing delay for agent response
        const agentTypingId = `agent-typing-${turnCounter}`;
        setMessages((prev) => [
          ...prev,
          { id: agentTypingId, role: "system", content: `${agent.name.split(" ")[0]} is thinking...`, timestamp: new Date().toISOString() },
        ]);
        await new Promise((r) => setTimeout(r, 1500));
        setMessages((prev) => prev.filter((m) => m.id !== agentTypingId));
        if (autoAbortRef.current) break;

        // Show agent response
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

  if (!agent) return null;

  const meta = TOWN_META[agent.town];
  const opinionColor = CANDIDATE_COLORS[(agent.opinion?.candidate as LeanId) || "undecided"];
  const opinionLabel = CANDIDATE_NAMES[(agent.opinion?.candidate as LeanId) || "undecided"];
  const initials =
    agent.initials ||
    agent.name
      .split(" ")
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

  const isAuto = chatMode === "auto";

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className="chat-panel-backdrop"
        onClick={() => onClose()}
      />
      <div
        className={`chat-panel fixed top-0 right-0 h-full w-[400px] max-w-full flex flex-col z-50 slide-panel-enter ${mobileExpanded ? "chat-panel--expanded" : ""}`}
        style={{
          background: "var(--card-bg)",
          borderLeft: "1px solid var(--card-border)",
          boxShadow: "-4px 0 24px rgba(0,0,0,0.08)",
        }}
      >
        {/* Header */}
        <div
          className="px-4 py-3 flex items-start gap-3 border-b"
          style={{ borderColor: "var(--card-border)", background: "var(--township-paper)" }}
        >
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold shrink-0"
            style={{
              background: agent.color || meta.color,
              boxShadow: `0 0 0 3px ${opinionColor}`,
            }}
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm" style={{ color: "var(--township-ink)" }}>
              {agent.name}
            </h3>
            <p className="text-xs" style={{ color: "var(--township-ink-muted)" }}>
              {agent.occupation}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <span className={`town-badge town-badge--${agent.town}`}>{meta.name}</span>
              <span className={`opinion-badge opinion-badge--${agent.opinion?.candidate || "undecided"}`}>
                {opinionLabel}
                {agent.opinion?.confidence ? ` ${agent.opinion.confidence}%` : ""}
              </span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-black/5 transition-colors"
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

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
          {messages.map((msg) => (
            <div key={msg.id} className="flex flex-col">
              <div className={`chat-bubble chat-bubble--${msg.role}`}>
                {msg.content}
              </div>
              {/* Listen button for agent messages */}
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

        {/* Input */}
        <div className="px-4 py-3 border-t" style={{ borderColor: "var(--card-border)" }}>
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
              placeholder={
                isAuto
                  ? "AI persona is speaking for you..."
                  : `Ask ${agent.name.split(" ")[0]} anything...`
              }
              className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
              style={{
                background: isAuto ? "var(--card-border)" : "var(--township-paper)",
                border: "1px solid var(--card-border)",
                color: "var(--township-ink)",
                opacity: isAuto ? 0.5 : 1,
              }}
              disabled={sending || isAuto}
            />
            {isAuto ? (
              <button
                onClick={() => {
                  autoAbortRef.current = true;
                  setChatMode("manual");
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{
                  background: autoRunning ? "#EF4444" : "var(--township-paper)",
                  color: autoRunning ? "#fff" : "var(--township-ink-muted)",
                  border: autoRunning ? "none" : "1px solid var(--card-border)",
                }}
              >
                {autoRunning ? "Stop" : "Stopped"}
              </button>
            ) : (
              <button
                onClick={sendMessage}
                disabled={sending || !input.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-40"
                style={{ background: "var(--civic-blue)" }}
              >
                Send
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
