import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import type { TownId, PoliticalRegistration } from "../types/messages";
import { DEMO_MODE } from "../demo/demoMode";
import { useScenarioContext } from "./ScenarioContext";
import { preparePlayerCapability } from "../lib/playerCapability";

/* ── User Profile Types ───────────────────────────────────────── */

export interface UserProfile {
  name: string;
  town: TownId;
  politicalLeaning: PoliticalRegistration;
  topConcerns: string[];
  personality: string;
  initials: string;
  color: string;
  agentId: string;
  // ── New optional fields ─────────────────────────────────────
  spriteKey?: string;
  outfitKey?: string;
  accessoryKey?: string;
  voicePreference?: string;
  audioEnabled?: boolean;
  audioAutoplay?: boolean;
  reducedMotion?: boolean;
  highContrast?: boolean;
  metAgents?: string[];
  persuadedAgents?: string[];
  playerId?: string;
}

interface UserProfileContextValue {
  profile: UserProfile | null;
  isOnboarded: boolean;
  setProfile: (p: UserProfile) => Promise<void>;
  clearProfile: () => void;
  chatMode: "manual" | "auto";
  setChatMode: (m: "manual" | "auto") => void;
  markAgentMet: (agentId: string) => void;
  markAgentPersuaded: (agentId: string) => void;
  setAudioPreferences: (opts: { enabled?: boolean; autoplay?: boolean }) => void;
  setReducedMotion: (b: boolean) => void;
  setHighContrast: (b: boolean) => void;
}

const STORAGE_KEY = "township-user-profile";

// The hosted replay has no accounts and writes no profile data. A small
// in-memory guest lets first-time visitors use accessibility preferences,
// open the journal explainer, and appear in the town without onboarding.
const DEMO_GUEST_PROFILE: UserProfile = {
  name: "Demo Visitor",
  town: "demo-town",
  politicalLeaning: "unaffiliated",
  topConcerns: [],
  personality: "Exploring a recorded civic deliberation.",
  initials: "DV",
  color: "#3B5998",
  agentId: "player-demo-visitor",
  playerId: "demo-visitor",
  spriteKey: "char-player",
  audioEnabled: true,
  audioAutoplay: false,
  reducedMotion: false,
  highContrast: false,
  metAgents: [],
  persuadedAgents: [],
};

function freshDemoGuest(town: TownId): UserProfile {
  return {
    ...DEMO_GUEST_PROFILE,
    town,
    topConcerns: [],
    metAgents: [],
    persuadedAgents: [],
  };
}

const UserProfileContext = createContext<UserProfileContextValue | null>(null);

/* ── Helpers ──────────────────────────────────────────────────── */

function safeUUID(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* ignore */
  }
  // Fallback
  return Math.random().toString(36).slice(2, 10);
}

function migrateProfile(raw: unknown): UserProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<UserProfile>;
  if (!p.name || !p.town) return null;

  // Ensure new optional fields exist (default-safe)
  const migrated: UserProfile = {
    name: p.name,
    town: p.town as TownId,
    politicalLeaning: (p.politicalLeaning as PoliticalRegistration) ?? "unaffiliated",
    topConcerns: Array.isArray(p.topConcerns) ? p.topConcerns : [],
    personality: p.personality ?? "",
    initials: p.initials ?? p.name.slice(0, 2).toUpperCase(),
    color: p.color ?? "#8B7D6B",
    agentId: p.agentId ?? "",
    spriteKey: p.spriteKey,
    outfitKey: p.outfitKey,
    accessoryKey: p.accessoryKey,
    voicePreference: p.voicePreference,
    audioEnabled: p.audioEnabled ?? true,
    audioAutoplay: p.audioAutoplay ?? false,
    reducedMotion: p.reducedMotion ?? false,
    highContrast: p.highContrast ?? false,
    metAgents: Array.isArray(p.metAgents) ? p.metAgents : [],
    persuadedAgents: Array.isArray(p.persuadedAgents) ? p.persuadedAgents : [],
    playerId: p.playerId ?? `player-${safeUUID()}`,
  };
  return migrated;
}

function readStoredProfile(): UserProfile | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    const migrated = migrateProfile(parsed);
    // Persist generated privacy/session fields once so a pre-migration profile
    // does not receive a different player ID on every reload.
    if (migrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    return null;
  }
}

/* ── Provider ─────────────────────────────────────────────────── */

export function UserProfileProvider({ children }: { children: ReactNode }) {
  const scenario = useScenarioContext();
  const demoTown = scenario.scenario.towns[0]?.id ?? "demo-town";
  const [profile, setProfileState] = useState<UserProfile | null>(() => (
    DEMO_MODE ? freshDemoGuest(demoTown) : readStoredProfile()
  ));

  const [chatMode, setChatMode] = useState<"manual" | "auto">("manual");

  // The staged scenario can change via ?scenario=. Keep the in-memory guest
  // rooted in that package rather than leaking the flagship's first town.
  useEffect(() => {
    if (!DEMO_MODE) return;
    setProfileState((prev) => prev ? { ...prev, town: demoTown } : freshDemoGuest(demoTown));
  }, [demoTown]);

  const persist = (p: UserProfile | null) => {
    if (DEMO_MODE) return;
    if (p) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  const setProfile = async (p: UserProfile) => {
    // Ensure playerId is stable across re-saves
    const withId: UserProfile = {
      ...p,
      playerId: p.playerId ?? profile?.playerId ?? `player-${safeUUID()}`,
      metAgents: p.metAgents ?? profile?.metAgents ?? [],
      persuadedAgents: p.persuadedAgents ?? profile?.persuadedAgents ?? [],
      audioEnabled: p.audioEnabled ?? profile?.audioEnabled ?? true,
      audioAutoplay: p.audioAutoplay ?? profile?.audioAutoplay ?? false,
      reducedMotion: p.reducedMotion ?? profile?.reducedMotion ?? false,
      highContrast: p.highContrast ?? profile?.highContrast ?? false,
    };
    if (!DEMO_MODE && !await preparePlayerCapability()) {
      throw new Error("Private browser storage is unavailable.");
    }
    persist(withId);
    setProfileState(withId);
  };

  const clearProfile = () => {
    setProfileState(DEMO_MODE ? freshDemoGuest(demoTown) : null);
    persist(null);
  };

  const updateProfile = (patch: Partial<UserProfile>) => {
    setProfileState((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      persist(next);
      return next;
    });
  };

  const markAgentMet = (agentId: string) => {
    setProfileState((prev) => {
      if (!prev) return prev;
      const met = prev.metAgents ?? [];
      if (met.includes(agentId)) return prev;
      const next = { ...prev, metAgents: [...met, agentId] };
      persist(next);
      return next;
    });
  };

  const markAgentPersuaded = (agentId: string) => {
    setProfileState((prev) => {
      if (!prev) return prev;
      const persuaded = prev.persuadedAgents ?? [];
      if (persuaded.includes(agentId)) return prev;
      const next = { ...prev, persuadedAgents: [...persuaded, agentId] };
      persist(next);
      return next;
    });
  };

  const setAudioPreferences = ({ enabled, autoplay }: { enabled?: boolean; autoplay?: boolean }) => {
    updateProfile({
      ...(enabled !== undefined ? { audioEnabled: enabled } : {}),
      ...(autoplay !== undefined ? { audioAutoplay: autoplay } : {}),
    });
  };

  const setReducedMotion = (b: boolean) => updateProfile({ reducedMotion: b });
  const setHighContrast = (b: boolean) => updateProfile({ highContrast: b });

  // Sync with storage changes from other tabs
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        try {
          const next = e.newValue ? migrateProfile(JSON.parse(e.newValue)) : null;
          setProfileState(next);
        } catch {
          setProfileState(null);
        }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return (
    <UserProfileContext.Provider
      value={{
        profile,
        isOnboarded: profile !== null,
        setProfile,
        clearProfile,
        chatMode,
        setChatMode,
        markAgentMet,
        markAgentPersuaded,
        setAudioPreferences,
        setReducedMotion,
        setHighContrast,
      }}
    >
      {children}
    </UserProfileContext.Provider>
  );
}

/* ── Hook ─────────────────────────────────────────────────────── */

export function useUserProfile(): UserProfileContextValue {
  const ctx = useContext(UserProfileContext);
  if (!ctx) throw new Error("useUserProfile must be used within UserProfileProvider");
  return ctx;
}
