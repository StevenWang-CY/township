import { useState } from "react";
import { Routes, Route, Link, useLocation } from "react-router-dom";
import { useWebSocket } from "./hooks/useWebSocket";
import { UserProfileProvider } from "./context/UserProfileContext";
import DistrictMap from "./components/DistrictMap";
import TownView from "./components/TownView";
import OnboardingView from "./components/OnboardingView";
import Dashboard from "./components/Dashboard";
import GodsView from "./components/GodsView";

export default function App() {
  const ws = useWebSocket();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <UserProfileProvider>
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
                {/* Active underline in gold */}
                {active && (
                  <span
                    className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full"
                    style={{ background: "var(--gold-accent)" }}
                  />
                )}
              </Link>
            );
          })}

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
    </div>
    </UserProfileProvider>
  );
}
