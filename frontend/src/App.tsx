import { lazy, Suspense, useState, useEffect, useRef } from "react";
import { Routes, Route, Link, useLocation, useNavigate } from "react-router-dom";
import { UserProfileProvider, useUserProfile } from "./context/UserProfileContext";
import { WebSocketProvider, useWebSocketContext } from "./context/WebSocketContext";
import { ScenarioProvider } from "./context/ScenarioContext";
import { useScenario } from "./hooks/useScenario";
import { useAudio } from "./hooks/useAudio";
import DistrictMap from "./components/DistrictMap";
import Dashboard from "./components/Dashboard";
import GodsView from "./components/GodsView";
import Journal from "./components/Journal";
import MediaBar from "./components/MediaBar";
import ProvenanceChip from "./components/ProvenanceChip";
import Icon from "./components/Icon";
import ResponsibleUseNotice from "./components/ResponsibleUseNotice";
import { DEMO_MODE } from "./demo/demoMode";
import { eventsSince } from "./hooks/useWebSocket";
import { appUrl } from "./lib/assetUrl";
import { useLayerStack } from "./hooks/useLayerStack";

// Phaser is the largest dependency in the app. Lazy-loading keeps it out of
// the atlas/dashboard bundles; the landing town view streams it on demand.
const TownView = lazy(() => import("./components/TownView"));
const OnboardingView = lazy(() => import("./components/OnboardingView"));

function RouteLoading() {
  return (
    <div className="route-loading" role="status" aria-live="polite">
      <span className="route-loading-mark" aria-hidden="true" />
      <span>Opening the town…</span>
    </div>
  );
}

function AppShell() {
  const ws = useWebSocketContext();
  const scen = useScenario();
  const location = useLocation();
  const navigate = useNavigate();
  const {
    profile,
    isOnboarded,
    preferences,
    clearProfile,
    setAudioPreferences,
    setReducedMotion,
    setHighContrast,
  } = useUserProfile();
  const [menuOpen, setMenuOpen] = useState(false);
  const [journalOpen, setJournalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const settingsWrapperRef = useRef<HTMLDivElement>(null);

  // Wire global audio cues to user-profile preferences + WebSocket events.
  // NOTE: `audio` is intentionally NOT in this effect's deps — its setters
  // are stable (useCallback) but a regressed hook could churn the object
  // identity and trigger an infinite re-render loop. Only the profile
  // preference itself should drive enable/disable. (Bug repro 2026-05-12.)
  const audio = useAudio();
  useEffect(() => {
    audio.setEnabled(preferences.audioEnabled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferences.audioEnabled]);

  // Play a SFX when interesting simulation events arrive.
  // Same dep-array discipline as above: only the event count drives this.
  const lastEventCursorRef = useRef(0);
  useEffect(() => {
    const delta = eventsSince(ws, lastEventCursorRef.current);
    lastEventCursorRef.current = ws.eventCursor;

    // A backward seek is state navigation, not a burst of new activity. A
    // large forward jump (or a live-history gap after a suspended tab) is
    // reconciled by state consumers without playing hundreds of stale sounds.
    if (delta.direction !== "forward" || delta.historyGap || delta.events.length > 24) return;

    for (const evt of delta.events) {
      switch (evt.type) {
        case "opinion_changed":
          audio.play("opinion_change");
          break;
        case "news_injected":
          audio.play("news_breaking");
          break;
        case "agent_speech":
          audio.play("speech_pop");
          // Mirror only newly-arrived speech. Re-reducing a replay prefix must
          // never announce historical/future dialogue to a screen reader.
          document.getElementById("aria-live-speech")!.textContent =
            `Agent ${evt.agent_name}: ${evt.text}`;
          break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.eventCursor]);

  // Apply reduced-motion attribute on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (preferences.reducedMotion) {
      root.setAttribute("data-reduced-motion", "true");
    } else {
      root.removeAttribute("data-reduced-motion");
    }
  }, [preferences.reducedMotion]);

  // Apply high-contrast class on <html>
  useEffect(() => {
    document.documentElement.classList.toggle("high-contrast", preferences.highContrast);
  }, [preferences.highContrast]);

  // Escape closes the settings popover via the universal layer stack —
  // only when it is the top-most open layer.
  useLayerStack(settingsOpen, () => {
    setSettingsOpen(false);
    requestAnimationFrame(() => settingsButtonRef.current?.focus());
  });

  useEffect(() => {
    if (!settingsOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!settingsWrapperRef.current?.contains(event.target as Node)) {
        setSettingsOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [settingsOpen]);

  // "Saved to your journal → View" toasts (TownView) open the drawer from
  // outside the header via this app-level event.
  useEffect(() => {
    const openJournal = () => setJournalOpen(true);
    window.addEventListener("township-open-journal", openJournal);
    return () => window.removeEventListener("township-open-journal", openJournal);
  }, []);

  const onResetProfile = () => {
    const message = DEMO_MODE
      ? "Reset this session's demo preferences?"
      : "Reset your profile? This clears your name, town, and progress.";
    if (!confirm(message)) return;
    clearProfile();
    setSettingsOpen(false);
    if (!DEMO_MODE) navigate("/onboarding");
  };

  const demoTimelineVisible = DEMO_MODE && (
    location.pathname === "/" ||
    location.pathname.startsWith("/town/") ||
    location.pathname === "/dashboard"
  );

  // Town routes pin the shell to the viewport (desktop) so the canvas, its
  // corner affordances, and the resident rail are all fully visible without
  // the disclosure bar pushing them below the fold.
  const townRoute = location.pathname === "/" || location.pathname.startsWith("/town/");

  return (
    <div className={`min-h-screen flex flex-col${DEMO_MODE ? " demo-mode" : ""}${townRoute ? " app-shell--pinned" : ""}`}>
      {/* ── Header ───────────────────────────────────────── */}
      <header className="app-header">
        <Link to="/" className="app-brand">
          <span className="app-wordmark">Township</span>
          <span className="app-scenario-chip" title={scen.title}>{scen.title}</span>
        </Link>

        {/* Hamburger button (mobile only) */}
        <button
          className="mobile-menu-btn"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Toggle menu"
          aria-expanded={menuOpen}
          aria-controls="primary-navigation"
        >
          <Icon name={menuOpen ? "close" : "menu"} size={22} />
        </button>

        <nav id="primary-navigation" className={`nav-links ${menuOpen ? "nav-links--open" : ""}`}>
          {[
            { to: "/", label: "Town" },
            { to: "/map", label: "Map" },
            { to: "/dashboard", label: "Dashboard" },
            { to: "/gods-view", label: "God's View" },
          ].map((link) => {
            // "/" is the living town view; deep links under /town/ light it too.
            const active = link.to === "/"
              ? location.pathname === "/" || location.pathname.startsWith("/town/")
              : location.pathname === link.to;
            return (
              <Link
                key={link.to}
                to={link.to}
                onClick={() => setMenuOpen(false)}
                className={`nav-link${active ? " nav-link--active" : ""}`}
                aria-current={active ? "page" : undefined}
              >
                {link.label}
              </Link>
            );
          })}

          <a
            href={appUrl("legal/THIRD_PARTY_NOTICES.md")}
            target="_blank"
            rel="noreferrer"
            className="nav-link"
          >
            Credits
          </a>

          {/* Journal */}
          {isOnboarded && (
            <button
              className="header-icon-btn"
              title="Open your journal"
              onClick={() => setJournalOpen(true)}
              aria-label="Open journal"
              aria-haspopup="dialog"
              aria-expanded={journalOpen}
              aria-controls="journal-panel"
            >
              <Icon name="journal" />
            </button>
          )}

          {/* Settings */}
          <div className="header-settings-wrapper" ref={settingsWrapperRef}>
            <button
              ref={settingsButtonRef}
              className="header-icon-btn"
              title="Settings"
              onClick={() => setSettingsOpen((b) => !b)}
              aria-label="Settings"
              aria-expanded={settingsOpen}
              aria-controls="header-settings-menu"
              aria-haspopup="dialog"
            >
              <Icon name="settings" />
            </button>
            {settingsOpen && (
              <div id="header-settings-menu" className="header-settings-menu" role="dialog" aria-label="Display and audio settings">
                <h4 className="header-settings-title">Settings</h4>
                <label className="header-settings-row">
                  <span>Audio</span>
                  <input
                    type="checkbox"
                    checked={preferences.audioEnabled}
                    onChange={(e) => setAudioPreferences({ enabled: e.target.checked })}
                  />
                </label>
                <label className="header-settings-row">
                  <span>Auto-play voice</span>
                  <input
                    type="checkbox"
                    checked={preferences.audioAutoplay}
                    onChange={(e) => setAudioPreferences({ autoplay: e.target.checked })}
                  />
                </label>
                <label className="header-settings-row">
                  <span>Reduced motion</span>
                  <input
                    type="checkbox"
                    checked={preferences.reducedMotion}
                    onChange={(e) => setReducedMotion(e.target.checked)}
                  />
                </label>
                <label className="header-settings-row">
                  <span>High contrast</span>
                  <input
                    type="checkbox"
                    checked={preferences.highContrast}
                    onChange={(e) => setHighContrast(e.target.checked)}
                  />
                </label>
                {profile ? (
                  <button className="header-settings-reset" onClick={onResetProfile}>
                    {DEMO_MODE ? "Reset demo preferences" : "Reset profile"}
                  </button>
                ) : (
                  <button
                    className="header-settings-reset"
                    onClick={() => { setSettingsOpen(false); navigate("/onboarding"); }}
                  >
                    Create your resident →
                  </button>
                )}
              </div>
            )}
          </div>

          {/* What the viewer is looking at: a recorded replay, or the live link. */}
          <ProvenanceChip connected={ws.connected} />
        </nav>
      </header>

      <ResponsibleUseNotice />

      {/* ── Content ──────────────────────────────────────── */}
      <main className={`flex-1${demoTimelineVisible ? " demo-timeline-space" : ""}`}>
        <Suspense fallback={<RouteLoading />}>
          <Routes>
            {/* The landing IS the product: the flagship town, alive on load.
                The illustrated District Atlas moved to /map. */}
            <Route path="/" element={<TownView ws={ws} />} />
            <Route path="/map" element={<DistrictMap />} />
            <Route path="/onboarding" element={<OnboardingView />} />
            <Route path="/town/:townId" element={<TownView ws={ws} />} />
            <Route path="/dashboard" element={<Dashboard ws={ws} />} />
            <Route path="/gods-view" element={<GodsView ws={ws} />} />
          </Routes>
        </Suspense>
      </main>

      {/* Replay transport dock — on the town + dashboard surfaces */}
      {demoTimelineVisible && <MediaBar variant="transport" />}

      {/* Journal panel */}
      <Journal open={journalOpen} onClose={() => setJournalOpen(false)} />

      {/* aria-live region for screen-reader speech mirror (FIX 14) */}
      <div id="aria-live-speech" aria-live="polite" aria-atomic="true" className="sr-only" />
    </div>
  );
}

export default function App() {
  return (
    <ScenarioProvider>
      <UserProfileProvider>
        <WebSocketProvider>
          <AppShell />
        </WebSocketProvider>
      </UserProfileProvider>
    </ScenarioProvider>
  );
}
