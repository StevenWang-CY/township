import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import type { TownId, PoliticalRegistration } from "../types/messages";

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
}

interface UserProfileContextValue {
  profile: UserProfile | null;
  isOnboarded: boolean;
  setProfile: (p: UserProfile) => void;
  clearProfile: () => void;
  chatMode: "manual" | "auto";
  setChatMode: (m: "manual" | "auto") => void;
}

const STORAGE_KEY = "township-user-profile";

const UserProfileContext = createContext<UserProfileContextValue | null>(null);

/* ── Provider ─────────────────────────────────────────────────── */

export function UserProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfileState] = useState<UserProfile | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const [chatMode, setChatMode] = useState<"manual" | "auto">("manual");

  const setProfile = (p: UserProfile) => {
    setProfileState(p);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  };

  const clearProfile = () => {
    setProfileState(null);
    localStorage.removeItem(STORAGE_KEY);
  };

  // Sync with storage changes from other tabs
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setProfileState(e.newValue ? JSON.parse(e.newValue) : null);
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
