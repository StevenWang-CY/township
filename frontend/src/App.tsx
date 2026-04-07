import { useState } from "react";
import { Routes, Route, Link, useLocation } from "react-router-dom";
import { useWebSocket } from "./hooks/useWebSocket";
import DistrictMap from "./components/DistrictMap";
import TownView from "./components/TownView";
import Dashboard from "./components/Dashboard";
import GodsView from "./components/GodsView";

export default function App() {
  const ws = useWebSocket();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Header ───────────────────────────────────────── */}
      <header
        className="flex items-center justify-between px-6 py-3 border-b relative"
        style={{
          background: "rgba(250,247,242,0.95)",
          borderColor: "var(--card-border)",
          backdropFilter: "blur(8px)",
        }}
      >
        <Link to="/" className="flex items-center gap-2 no-underline">
          <span
            className="text-2xl font-bold tracking-tight"
            style={{ fontFamily: "Playfair Display, Georgia, serif", color: "var(--township-ink)" }}
          >
            Township
          </span>
          <span
            className="text-xs font-medium px-2 py-0.5 rounded-full"
            style={{ background: "var(--civic-blue)", color: "#fff", letterSpacing: "0.04em" }}
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
                className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                style={{
                  color: active ? "var(--civic-blue)" : "var(--township-ink-muted)",
                  background: active ? "rgba(59,89,152,0.08)" : "transparent",
                }}
              >
                {link.label}
              </Link>
            );
          })}

          {/* Connection indicator */}
          <div className="ml-3 flex items-center gap-1.5 text-xs" style={{ color: "var(--township-ink-muted)" }}>
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: ws.connected ? "#4A9B5C" : "#EF4444" }}
            />
            {ws.connected ? "Live" : "Offline"}
          </div>
        </nav>
      </header>

      {/* ── Content ──────────────────────────────────────── */}
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<DistrictMap />} />
          <Route path="/town/:townId" element={<TownView ws={ws} />} />
          <Route path="/dashboard" element={<Dashboard ws={ws} />} />
          <Route path="/gods-view" element={<GodsView ws={ws} />} />
        </Routes>
      </main>
    </div>
  );
}
