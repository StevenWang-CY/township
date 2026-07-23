import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { AgentState, ChatMessage, LeanId, Opinion, Relationship } from "../types/messages";
import { useScenario } from "../hooks/useScenario";
import { voiceIdForAgent } from "../game/config";
import { resolveAgentSprite } from "../game/spriteCustomization";
import { useUserProfile } from "../context/UserProfileContext";
import { publishPrivateRelationshipUpdate, useRelationships } from "../hooks/useRelationships";
import { useAudio } from "../hooks/useAudio";
import { DEMO_MODE, REPO_URL, INSTALL_HINT } from "../demo/demoMode";
import SpritePortrait from "./SpritePortrait";
import MoodIndicator from "./MoodIndicator";
import TrustBadge from "./TrustBadge";
import { readableInk } from "../lib/color";
import { playerCapabilityHeaders, registerPlayerCapability } from "../lib/playerCapability";
import { useLayerStack } from "../hooks/useLayerStack";

/* ── Persistent transcripts (one record per agent across panel reopens) ── */

const TRANSCRIPT_CACHE: Record<string, ChatMessage[]> = {};

/* ── Stage-direction rendering ──────────────────────────────────
 * Agents emit gesture / body language wrapped in *single asterisks*
 * (chat-RP convention). Rendered inline as italic, muted, slightly
 * smaller text — and stripped before being sent to TTS so ElevenLabs
 * doesn't pronounce the asterisks. */

const GESTURE_RE = /\*([^*\n]+?)\*/g;

function renderMessageContent(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  GESTURE_RE.lastIndex = 0;
  while ((m = GESTURE_RE.exec(text)) !== null) {
    if (m.index > lastIdx) {
      parts.push(text.slice(lastIdx, m.index));
    }
    parts.push(
      <span key={`g-${m.index}`} className="chat-gesture">
        {m[1].trim()}
      </span>,
    );
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }
  return parts.length === 0 ? text : parts;
}

function stripGesturesForSpeech(text: string): string {
  return text.replace(GESTURE_RE, "").replace(/[ \t]{2,}/g, " ").trim();
}

/* ── Server-proxied TTS Helper (POST /api/tts) ───────────────── */

async function speakWithTTS(
  text: string,
  voiceId: string,
  onStart: () => void,
  onEnd: () => void,
  onError: (err: string) => void,
): Promise<void> {
  onStart();

  try {
    const response = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.slice(0, 1000), voice_id: voiceId }),
    });

    if (response.status === 503) {
      onError("Voice unavailable");
      return;
    }
    if (!response.ok) {
      throw new Error(`TTS error: ${response.status}`);
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
    onError(err.message || "Voice unavailable");
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
    const voiceId = voiceIdForAgent(agentId);
    speakWithTTS(
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
        <span>Voice off</span>
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
  default: ["local services", "household costs", "community priorities", "implementation", "tradeoffs"],
};

function topicsForAgent(agent: AgentState): string[] {
  const out: string[] = [];
  const tops = agent.opinion?.top_issues ?? [];
  for (const t of tops) if (t && !out.includes(t)) out.push(t);

  for (const t of TOPIC_FALLBACKS.default) {
    if (out.length >= 5) break;
    if (!out.includes(t)) out.push(t);
  }
  return out.slice(0, 5);
}

/* ── Intro line grammar ──────────────────────────────────────
 * The guest player is literally named "You", which conjugates second-person
 * ("You walk up…"), while a named player conjugates third-person
 * ("Maya walks up…"). Never emit "You approaches".
 *
 * The "walks up" fiction is only earned when a player sprite actually
 * stands in this town; spectators "strike up a conversation", and the demo
 * replay is honest about being recorded. */

function isSecondPerson(name: string): boolean {
  return name.trim().toLowerCase() === "you";
}

/** "Owner, La Finca Restaurant" → " — owner of La Finca Restaurant".
 *  Only simple "Role, Place" pairs are rewritten; multi-role or annotated
 *  occupations ("Retired (formerly …)", "…, County College of Morris
 *  student") keep their own wording, just lowercased mid-sentence. */
function occupationBlurb(occupation: string | undefined): string {
  const raw = (occupation ?? "").trim().replace(/\.$/, "");
  if (!raw) return "";
  // The place must read as a proper noun ("La Finca Restaurant"), not a
  // second role ("former marketing manager") — those keep their comma.
  const pair = raw.match(/^([^,()]{2,40}), ([A-Z][^,]+)$/);
  let text =
    pair && !/\b(student|retired|former|formerly)\b/i.test(raw)
      ? `${pair[1]} of ${pair[2]}`
      : raw;
  // Lowercase the leading word unless it looks like an acronym or proper noun
  // kept capitalized mid-sentence (e.g. "ER nurse").
  if (/^[A-Z][a-z]/.test(text)) text = text[0].toLowerCase() + text.slice(1);
  return ` — ${text}`;
}

function introLine(playerName: string, agent: AgentState, playerPresent: boolean): string {
  const blurb = occupationBlurb(agent.occupation);
  if (DEMO_MODE) {
    return `You're watching ${agent.name}'s recorded conversations${blurb ? ` —${blurb.slice(2)}` : ""}.`;
  }
  if (!playerPresent) {
    return `You strike up a conversation with ${agent.name}${blurb}.`;
  }
  const verb = isSecondPerson(playerName) ? "walk up to" : "walks up to";
  return `${playerName} ${verb} ${agent.name}${blurb}.`;
}

/* ── ChatPanel ───────────────────────────────────────────────── */

interface ChatPanelProps {
  agent: AgentState | null;
  onClose: () => void;
  /** Called when transcript updates (used to persist as a journal entry). */
  onTranscriptChange?: (agentId: string, messages: ChatMessage[]) => void;
  /** True when a player sprite actually stands in this town — earns the
   *  "walks up to" intro; otherwise the copy is spectator-honest. */
  playerPresent?: boolean;
  /** Demo replay: this resident's recorded speech lines (fills the panel
   *  instead of an empty scroll area). */
  recordedLines?: string[];
}

export default function ChatPanel({
  agent,
  onClose,
  onTranscriptChange,
  playerPresent = false,
  recordedLines = [],
}: ChatPanelProps) {
  const { profile, chatMode, setChatMode } = useUserProfile();
  const { scenario, townMeta, optionColor, optionLabel, undecidedId } = useScenario();
  const audio = useAudio();
  const { trustFor } = useRelationships(profile?.playerId);

  const initialMessages = (): ChatMessage[] => {
    if (agent && TRANSCRIPT_CACHE[agent.id]) return TRANSCRIPT_CACHE[agent.id];
    if (!agent) return [];
    const playerName = profile?.name || "You";
    return [
      {
        id: "system-intro",
        role: "system",
        content: introLine(playerName, agent, playerPresent),
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
  // Live header overrides from the chat response (don't wait for WS).
  const [liveOpinion, setLiveOpinion] = useState<Opinion | null>(null);
  const [liveTrust, setLiveTrust] = useState<number | null>(null);
  const autoAbortRef = useRef(false);
  const autoStartedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const lastAgentMsgIdRef = useRef<string | null>(null);
  onCloseRef.current = onClose;

  // Escape closes the chat through the universal layer stack — only when
  // the chat is the top-most open layer (journal/settings above it peel
  // off first).
  useLayerStack(!!agent, () => onCloseRef.current());

  // The live chat is a modal side panel: move focus in, keep keyboard focus
  // inside, and restore the invoking control on exit.
  useEffect(() => {
    if (!agent) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => closeButtonRef.current?.focus());

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute("hidden"));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      requestAnimationFrame(() => restoreFocusRef.current?.focus());
    };
  }, [agent?.id]);

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
        content: introLine(playerName, agent, playerPresent),
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
    setLiveOpinion(null);
    setLiveTrust(null);
    // Audio cue: opening the chat with a new agent.
    audio.play("chat_open");
    refetchMemories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent?.id]);

  // Re-pull the agent's memory list. Used at open time, after every new
  // agent message (so the conversation we just had appears in the panel),
  // and when the user expands the memory peek manually.
  const refetchMemories = useCallback(() => {
    if (!agent?.id) return;
    if (DEMO_MODE) {
      setMemories([]);
      return;
    }
    fetch(`/api/simulation/agent/${encodeURIComponent(agent.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        const raw = Array.isArray(data.memories)
          ? data.memories
          : Array.isArray(data.memory)
          ? data.memory
          : null;
        if (raw === null) return; // endpoint shape we don't recognise
        setMemories(raw.slice(-5));
      })
      .catch(() => { /* graceful degrade */ });
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
      // The backend just appended a "Chat:" memory for this turn; pull the
      // updated list so the memory peek reflects the conversation we are
      // actually having (was previously stale after the open-time fetch).
      refetchMemories();
      // Voice auto-play — strip *gestures* so TTS doesn't pronounce the asterisks
      // or read stage directions aloud.
      if (agent && profile?.audioAutoplay) {
        const voiceId = voiceIdForAgent(agent.id);
        speakWithTTS(
          stripGesturesForSpeech(latestAgent.content),
          voiceId,
          () => {},
          () => {},
          () => {},
        );
      }
    }
  }, [messages, agent, profile?.audioAutoplay]);

  // Start auto-conversation when switching to auto mode (never in the
  // zero-backend demo build — there is no /api/chat to drive it).
  useEffect(() => {
    if (DEMO_MODE) return;
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

      if (profile?.playerId && !DEMO_MODE && !await registerPlayerCapability(profile.playerId)) {
        throw new Error("Private player access could not be established");
      }

      const res = await fetch(`/api/chat/${encodeURIComponent(agent.id)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...playerCapabilityHeaders(),
        },
        body: JSON.stringify(body),
      });

      setMessages((prev) => prev.filter((m) => m.id !== typingId));

      // On 404 (agent unknown) / 503 (LLM unavailable) → visible system notice,
      // never an agent bubble.
      if (!res.ok) {
        const reason =
          res.status === 503
            ? "the agent service is unavailable right now"
            : res.status === 404
              ? "that resident could not be found"
              : `request failed (HTTP ${res.status})`;
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: "system",
            content: `${agent.name} could not be reached — ${reason}.`,
            timestamp: new Date().toISOString(),
          },
        ]);
        return;
      }

      const data = await res.json();

      const agentMsg: ChatMessage = {
        id: `agent-${Date.now()}`,
        role: "agent",
        content: data.response || data.message || "...",
        timestamp: new Date().toISOString(),
        agent_id: agent.id,
      };
      setMessages((prev) => [...prev, agentMsg]);

      // Update the header immediately from this browser-private response.
      // Opinion shifts may also be public simulation events; trust never is.
      if (data.opinion && typeof data.opinion === "object") {
        setLiveOpinion(data.opinion as Opinion);
      }
      if (typeof data.trust === "number") {
        setLiveTrust(data.trust);
      }
      if (
        profile?.playerId
        && data.relationship
        && typeof data.relationship === "object"
        && typeof data.relationship.trust === "number"
      ) {
        publishPrivateRelationshipUpdate(
          profile.playerId,
          agent.id,
          data.relationship as Relationship,
        );
      }
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
        const notifyUnavailable = () =>
          setMessages((prev) => [
            ...prev,
            {
              id: `notice-${Date.now()}`,
              role: "system",
              content: "Voice input unavailable",
              timestamp: new Date().toISOString(),
            },
          ]);
        if (blob.size === 0) {
          notifyUnavailable();
          return;
        }
        // POST /api/transcribe → {transcript} (200) or 503 {error}.
        try {
          const fd = new FormData();
          fd.append("audio", blob, "voice.webm");
          const res = await fetch("/api/transcribe", { method: "POST", body: fd });
          if (!res.ok) {
            notifyUnavailable();
            return;
          }
          const data = await res.json();
          const transcript = (data.transcript || "").trim();
          if (data.error || !transcript) {
            notifyUnavailable();
            return;
          }
          setInput(transcript);
        } catch {
          notifyUnavailable();
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
    const firstName = agent.name.split(" ")[0];

    for (let turn = 0; turn < 5; turn++) {
      if (autoAbortRef.current) break;

      // Show a typing indicator immediately so the user has visible feedback
      // for the entire (slow, multi-call LLM) round-trip. The backend's
      // /api/chat/auto/{id} runs two sequential LLM passes and routinely
      // takes 10-20s; without this the panel looked frozen for the first
      // turn after the static intro.
      const turnTypingId = `auto-typing-${turnCounter}`;
      setMessages((prev) => [
        ...prev,
        {
          id: turnTypingId,
          role: "system",
          content: turn === 0
            ? `${profile.name} ${isSecondPerson(profile.name) ? "are" : "is"} thinking of what to ask…`
            : `${profile.name} consider${isSecondPerson(profile.name) ? "" : "s"} a follow-up…`,
          timestamp: new Date().toISOString(),
        },
      ]);

      // Small breath between turns so the eye can track the new bubble.
      // Skipped on turn 0 (the static intro already provides the pause).
      if (turn > 0) {
        await new Promise((r) => setTimeout(r, 600));
        if (autoAbortRef.current) { setMessages((prev) => prev.filter((m) => m.id !== turnTypingId)); break; }
      }

      // 60s soft timeout so a hung backend surfaces as an error instead of
      // an infinite spinner. AbortController fires on either the timeout or
      // a Stop click.
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), 60_000);
      const onAbort = () => controller.abort();
      // Mirror autoAbortRef onto the controller so the existing Stop button
      // tears down the in-flight request cleanly.
      const abortPollId = setInterval(() => { if (autoAbortRef.current) onAbort(); }, 200);

      let data: any;
      try {
        if (profile.playerId && !DEMO_MODE && !await registerPlayerCapability(profile.playerId)) {
          throw new Error("Private player access could not be established");
        }
        const res = await fetch(`/api/chat/auto/${encodeURIComponent(agent.id)}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...playerCapabilityHeaders(),
          },
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
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
      } catch (err: any) {
        clearTimeout(timeoutHandle);
        clearInterval(abortPollId);
        setMessages((prev) => prev.filter((m) => m.id !== turnTypingId));
        if (autoAbortRef.current) break;
        const msg = err?.name === "AbortError"
          ? "No reply from the model in 60s — try again or switch to Manual."
          : `Auto-conversation paused. (${err?.message ?? "unknown error"})`;
        setMessages((prev) => [
          ...prev,
          { id: `error-${Date.now()}`, role: "system", content: msg, timestamp: new Date().toISOString() },
        ]);
        break;
      }
      clearTimeout(timeoutHandle);
      clearInterval(abortPollId);

      if (autoAbortRef.current) { setMessages((prev) => prev.filter((m) => m.id !== turnTypingId)); break; }

      if (data.opinion && typeof data.opinion === "object") {
        setLiveOpinion(data.opinion as Opinion);
      }
      if (typeof data.trust === "number") {
        setLiveTrust(data.trust);
      }
      if (
        profile.playerId
        && data.relationship
        && typeof data.relationship === "object"
        && typeof data.relationship.trust === "number"
      ) {
        publishPrivateRelationshipUpdate(
          profile.playerId,
          agent.id,
          data.relationship as Relationship,
        );
      }

      const userText = data.user_message || scenario.question;
      const agentText = data.agent_response || "…";

      // Replace the typing indicator with the actual user message.
      const userMsg: ChatMessage = {
        id: `auto-user-${turnCounter}-${Date.now()}`,
        role: "user",
        content: userText,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => prev.filter((m) => m.id !== turnTypingId).concat(userMsg));
      history.push({ role: "user", content: userText });

      // Brief read-pause + agent-side typing indicator so the user message
      // is legible before the agent reply pops in. Previously waited 1500ms
      // for "show-don't-tell" — felt artificial on top of the already-slow
      // LLM round trip. 350ms is enough breathing room.
      const agentTypingId = `agent-typing-${turnCounter}`;
      setMessages((prev) => [
        ...prev,
        { id: agentTypingId, role: "system", content: `${firstName} is replying…`, timestamp: new Date().toISOString() },
      ]);
      await new Promise((r) => setTimeout(r, 350));
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

  // Demo replay: the panel shows the resident's recorded speech instead of
  // an empty scroll area with nothing but the install note.
  const displayMessages = useMemo(() => {
    if (!DEMO_MODE || !agent) return messages;
    const recorded: ChatMessage[] = recordedLines.map((text, i) => ({
      id: `recorded-${i}`,
      role: "agent",
      content: text,
      timestamp: "",
      agent_id: agent.id,
    }));
    return [...messages, ...recorded];
  }, [messages, recordedLines, agent]);

  const topics = useMemo(() => (agent ? topicsForAgent(agent) : []), [agent]);
  const sprite = useMemo(
    () => (agent ? resolveAgentSprite(agent.id, scenario.id) : null),
    [agent, scenario.id],
  );

  if (!agent) return null;

  const meta = townMeta(agent.town);
  // Prefer the live opinion from the most recent chat response over the WS state.
  const headerOpinion = liveOpinion ?? agent.opinion;
  const candidate = (headerOpinion?.candidate as LeanId) || undecidedId;
  const opinionLabel = optionLabel(candidate);
  const initials =
    agent.initials ||
    agent.name
      .split(" ")
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

  const isAuto = chatMode === "auto";
  const trust = liveTrust ?? trustFor(agent.id);

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className="chat-panel-backdrop"
        onClick={() => onClose()}
        style={{ background: "rgba(0,0,0,0.12)" }}
      />
      <div
        ref={panelRef}
        className={`chat-panel fixed top-0 right-0 h-full w-[400px] max-w-full flex flex-col z-50 slide-panel-enter ${mobileExpanded ? "chat-panel--expanded" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-panel-title"
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
            <SpritePortrait
              agentId={agent.id}
              spriteKey={agent.sprite_key ?? sprite?.spriteKey}
              accessoryKey={agent.accessory_key ?? sprite?.accessoryKey}
              fallbackInitials={initials}
              color={agent.color || meta.color}
              ringColor={optionColor(candidate)}
              size={56}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <h3 id="chat-panel-title" style={{ fontFamily: "var(--font-display)", fontSize: "17px", color: "var(--text-primary)", fontWeight: 600 }}>
                  {agent.name}
                </h3>
                <MoodIndicator mood={mood} size={14} />
              </div>
              <p style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--text-secondary)" }}>
                {agent.occupation}
              </p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span
                  className="town-badge"
                  style={{ color: readableInk(meta.color), background: `color-mix(in srgb, ${meta.color} 15%, white)` }}
                >
                  {meta.name}
                </span>
                <span
                  className="opinion-badge"
                  style={{
                    color: readableInk(optionColor(candidate)),
                    background: `color-mix(in srgb, ${optionColor(candidate)} 15%, white)`,
                  }}
                >
                  {opinionLabel}
                  {headerOpinion?.confidence ? ` ${headerOpinion.confidence}%` : ""}
                </span>
                <TrustBadge trust={trust} size="small" />
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <button
                ref={closeButtonRef}
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
              {profile && !DEMO_MODE && (
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
          {DEMO_MODE && recordedLines.length === 0 && (
            <p className="text-xs italic" style={{ color: "var(--township-ink-muted)" }}>
              Nothing recorded from {agent.name.split(" ")[0]} yet — play the
              timeline below and their lines will appear here.
            </p>
          )}
          {displayMessages.map((msg) => (
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
                {msg.role === "agent" ? renderMessageContent(msg.content) : msg.content}
              </div>
              {msg.role === "agent" && msg.agent_id && !DEMO_MODE && (
                <div className="self-start mt-0.5 ml-1">
                  <ListenButton text={stripGesturesForSpeech(msg.content)} agentId={msg.agent_id} />
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
          onToggle={(e) => {
            const isOpen = (e.currentTarget as HTMLDetailsElement).open;
            setMemoryOpen(isOpen);
            // Pull a fresh list each time the user expands — covers the case
            // where the user chats first and only checks "what X remembers"
            // afterwards.
            if (isOpen) refetchMemories();
          }}
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
        {!isAuto && !DEMO_MODE && (
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

        {/* Input — in the demo build there is no chat backend; a gentle
            pointer at the zero-key local install replaces send/mic/TTS. */}
        {DEMO_MODE ? (
          <div className="px-4 py-3" style={{ borderTop: "1px solid var(--warm-glass-border)", background: "var(--bg-paper)" }}>
            <div className="demo-locked-note" title={INSTALL_HINT}>
              <span>
                Live chat needs the local install —{" "}
                <a href={REPO_URL} target="_blank" rel="noreferrer">zero keys required</a>.
              </span>
            </div>
          </div>
        ) : (
        <div className="px-4 py-3" style={{ borderTop: "1px solid var(--warm-glass-border)", background: "var(--bg-paper)" }}>
          <div className="relative">
            <input
              aria-label={`Message ${agent.name}`}
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
                  aria-label={recording ? "Stop recording" : "Hold to record a voice message"}
                  aria-pressed={recording}
                  onKeyDown={(event) => {
                    if ((event.key === "Enter" || event.key === " ") && !recording) {
                      event.preventDefault();
                      void startRecording();
                    }
                  }}
                  onKeyUp={(event) => {
                    if ((event.key === "Enter" || event.key === " ") && recording) {
                      event.preventDefault();
                      stopRecording();
                    }
                  }}
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
                  aria-label={`Send message to ${agent.name}`}
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
        )}
      </div>
    </>
  );
}
