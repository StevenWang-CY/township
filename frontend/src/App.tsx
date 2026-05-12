import { useState, useEffect, useRef } from "react";
import { Routes, Route, Link, useLocation, useNavigate } from "react-router-dom";
import { UserProfileProvider, useUserProfile } from "./context/UserProfileContext";
import { WebSocketProvider, useWebSocketContext } from "./context/WebSocketContext";
import { useAudio } from "./hooks/useAudio";
import DistrictMap from "./components/DistrictMap";
import TownView from "./components/TownView";
import OnboardingView from "./components/OnboardingView";
import Dashboard from "./components/Dashboard";
import GodsView from "./components/GodsView";
import Journal from "./components/Journal";

function AppShell() {
  const ws = useWebSocketContext();
  const location = useLocation();
  const navigate = useNavigate();
  const {
    profile,
    isOnboarded,
    clearProfile,
    setAudioPreferences,
    setReducedMotion,
    setHighContrast,
  } = useUserProfile();
  const [menuOpen, setMenuOpen] = useState(false);
  const [journalOpen, setJournalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Wire global audio cues to user-profile preferences + WebSocket events.
  // NOTE: `audio` is intentionally NOT in this effect's deps — its setters
  // are stable (useCallback) but a regressed hook could churn the object
  // identity and trigger an infinite re-render loop. Only the profile
  // preference itself should drive enable/disable. (Bug repro 2026-05-12.)
  const audio = useAudio();
  useEffect(() => {
    audio.setEnabled(profile?.audioEnabled !== false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.audioEnabled]);

  // Play a SFX when interesting simulation events arrive.
  // Same dep-array discipline as above: only the event count drives this.
  const lastEventIdxRef = useRef(0);
  useEffect(() => {
    if (ws.events.length <= lastEventIdxRef.current) return;
    const fresh = ws.events.slice(lastEventIdxRef.current);
    lastEventIdxRef.current = ws.events.length;
    for (const evt of fresh) {
      switch (evt.type) {
        case "opinion_changed":
          audio.play("opinion_change");
          break;
        case "news_injected":
          audio.play("news_breaking");
          break;
        case "agent_speech":
          audio.play("speech_pop");
          break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.events.length]);

  // Apply reduced-motion attribute on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (profile?.reducedMotion) {
      root.setAttribute("data-reduced-motion", "true");
    } else {
      root.removeAttribute("data-reduced-motion");
    }
  }, [profile?.reducedMotion]);

  // Apply high-contrast class on <html>
  useEffect(() => {
    document.documentElement.classList.toggle("high-contrast", !!profile?.highContrast);
  }, [profile?.highContrast]);

  const onResetProfile = () => {
    if (!confirm("Reset your profile? This clears your name, town, and progress.")) return;
    clearProfile();
    setSettingsOpen(false);
    navigate("/onboarding");
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Header ───────────────────────────────────────── */}
      <header
        className="flex items-center justify-between px-6 py-3 relative"
        style={{
          background: "var(--warm-glass)",
          backdropFilter: "blur(var(--warm-glass-blur))",
          WebkitBackdropFilter: "blur(var(--warm-glass-blur))",
          borderBottom: "1px solid var(--warm-glass-border)",
        }}
      >
        <Link to="/" className="flex items-center gap-2.5 no-underline">
          <span
            className="text-2xl tracking-tight"
            style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)", fontWeight: 600, letterSpacing: "1px" }}
          >
            Township
          </span>
          <span
            className="text-xs font-medium px-2.5 py-0.5 rounded-full"
            style={{ background: "var(--gold-accent)", color: "#fff", letterSpacing: "0.06em", fontFamily: "var(--font-body)" }}
          >
            NJ-11
          </span>
        </Link>

        {/* Hamburger button (mobile only) */}
        <button
          className="mobile-menu-btn"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Toggle menu"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {menuOpen ? (
              <>
                <path d="M6 6l12 12" />
                <path d="M18 6L6 18" />
              </>
            ) : (
              <>
                <path d="M3 6h18" />
                <path d="M3 12h18" />
                <path d="M3 18h18" />
              </>
            )}
          </svg>
        </button>

        <nav className={`nav-links ${menuOpen ? "nav-links--open" : ""}`}>
          {[
            { to: "/", label: "Map" },
            { to: "/dashboard", label: "Dashboard" },
            { to: "/gods-view", label: "God's View" },
          ].map((link) => {
            const active = location.pathname === link.to;
            return (
              <Link
                key={link.to}
                to={link.to}
                onClick={() => setMenuOpen(false)}
                className="relative px-3 py-1.5 text-sm font-medium"
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: "13px",
                  color: active ? "var(--text-primary)" : "var(--text-secondary)",
                  transition: "color 200ms ease",
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = "var(--text-primary)"; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = "var(--text-secondary)"; }}
              >
                {link.label}
                {active && (
                  <span
                    className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full"
                    style={{ background: "var(--gold-accent)" }}
                  />
                )}
              </Link>
            );
          })}

          {/* Journal */}
          {isOnboarded && (
            <button
              className="header-icon-btn"
              title="Open your journal"
              onClick={() => setJournalOpen(true)}
              aria-label="Open journal"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3v12a1 1 0 0 0 1 1h11" />
                <path d="M6 3h9a1 1 0 0 1 1 1v11" />
                <line x1="9" y1="6" x2="13" y2="6" />
                <line x1="9" y1="9" x2="13" y2="9" />
                <line x1="9" y1="12" x2="13" y2="12" />
              </svg>
            </button>
          )}

          {/* Settings */}
          <div className="header-settings-wrapper">
            <button
              className="header-icon-btn"
              title="Settings"
              onClick={() => setSettingsOpen((b) => !b)}
              aria-label="Settings"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="9" cy="9" r="2.5" />
                <path d="M9 1.5v2M9 14.5v2M2.5 9H.5M17.5 9h-2M4.4 4.4L3 3M15 15l-1.4-1.4M4.4 13.6L3 15M15 3l-1.4 1.4" />
              </svg>
            </button>
            {settingsOpen && profile && (
              <div className="header-settings-menu">
                <h4 className="header-settings-title">Settings</h4>
                <label className="header-settings-row">
                  <span>Audio</span>
                  <input
                    type="checkbox"
                    checked={profile.audioEnabled !== false}
                    onChange={(e) => setAudioPreferences({ enabled: e.target.checked })}
                  />
                </label>
                <label className="header-settings-row">
                  <span>Auto-play voice</span>
                  <input
                    type="checkbox"
                    checked={!!profile.audioAutoplay}
                    onChange={(e) => setAudioPreferences({ autoplay: e.target.checked })}
                  />
                </label>
                <label className="header-settings-row">
                  <span>Reduced motion</span>
                  <input
                    type="checkbox"
                    checked={!!profile.reducedMotion}
                    onChange={(e) => setReducedMotion(e.target.checked)}
                  />
                </label>
                <label className="header-settings-row">
                  <span>High contrast</span>
                  <input
                    type="checkbox"
                    checked={!!profile.highContrast}
                    onChange={(e) => setHighContrast(e.target.checked)}
                  />
                </label>
                <button className="header-settings-reset" onClick={onResetProfile}>
                  Reset profile
                </button>
              </div>
            )}
          </div>

          {/* Connection indicator */}
          <div className="ml-3 flex items-center gap-1.5 text-xs" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-body)" }}>
            <span
              className="w-2 h-2 rounded-full"
              style={{
                background: ws.connected ? "#4CAF50" : "#EF4444",
                animation: ws.connected ? "pulse-glow 2s ease-in-out infinite" : "none",
              }}
            />
            {ws.connected ? "Live" : "Offline"}
          </div>
        </nav>
      </header>

      {/* ── Content ──────────────────────────────────────── */}
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<DistrictMap />} />
          <Route path="/onboarding" element={<OnboardingView />} />
          <Route path="/town/:townId" element={<TownView ws={ws} />} />
          <Route path="/dashboard" element={<Dashboard ws={ws} />} />
          <Route path="/gods-view" element={<GodsView ws={ws} />} />
        </Routes>
      </main>

      {/* Journal panel */}
      <Journal open={journalOpen} onClose={() => setJournalOpen(false)} />

      {/* aria-live region for screen-reader speech mirror (FIX 14) */}
      <div id="aria-live-speech" aria-live="polite" aria-atomic="true" className="sr-only" />
    </div>
  );
}

export default function App() {
  return (
    <UserProfileProvider>
      <WebSocketProvider>
        <AppShell />
      </WebSocketProvider>
    </UserProfileProvider>
  );
}
