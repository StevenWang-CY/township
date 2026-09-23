/* ── useSimulation ───────────────────────────────────────────
 * The REST side of a live run: start it (quick plan or campaign), poll its
 * status, and drive the campaign transport (pause / resume / speed / skip
 * to the next day). Status polling runs every 2 s while `poll` is true and
 * fetches once whenever that flag flips, so the last status of a finished
 * run (its stopped_reason, its budget) lands without a stray interval.
 * ─────────────────────────────────────────────────────────── */

import { useState, useCallback, useEffect, useRef } from "react";
import type { SimulationStatus, DistrictSummary, RunPreset } from "../types/messages";
import { DEMO_MODE } from "../demo/demoMode";

/** POST /api/simulation/start body (every field optional; the backend
 *  defaults to the scenario's quick plan at 1×). */
export interface StartRequest {
  town?: string;
  rounds?: number;
  preset?: RunPreset;
  days?: number;
  until_election?: boolean;
  speed?: number;
  budget_usd?: number;
  /** A persisted campaign run id to continue from its latest checkpoint. */
  resume?: string;
}

export interface UseSimulationOptions {
  /** Poll /status while true (and fetch once whenever the flag changes). */
  poll?: boolean;
  pollMs?: number;
}

async function postJson(url: string, body?: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** The backend's error envelope ({status:"error", message}) or the HTTP line. */
async function describeFailure(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (data && typeof data.message === "string") return data.message;
  } catch { /* not JSON */ }
  return `HTTP ${res.status}`;
}

export function useSimulation(options: UseSimulationOptions = {}) {
  const { poll = false, pollMs = 2000 } = options;
  const [status, setStatus] = useState<SimulationStatus | null>(null);
  const [results, setResults] = useState<DistrictSummary | null>(null);
  const [loading, setLoading] = useState(false);
  /** The last start error (shown beside the start button). */
  const [error, setError] = useState<string | null>(null);
  /** The last transport error (pause/resume/speed/skip). */
  const [transportError, setTransportError] = useState<string | null>(null);
  const [transportBusy, setTransportBusy] = useState(false);

  // `rounds` omitted -> backend runs the active scenario's full round plan
  // (the scenario knows its own length; the UI must not assume 5).
  const startSimulation = useCallback(async (request?: number | StartRequest) => {
    setLoading(true);
    setError(null);
    try {
      const body: StartRequest = typeof request === "number" ? { rounds: request } : (request ?? {});
      const res = await postJson("/api/simulation/start", body);
      if (!res.ok) throw new Error(await describeFailure(res));
      const data: SimulationStatus = await res.json();
      setStatus((prev) => ({ ...(prev ?? {}), ...data } as SimulationStatus));
      return data;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const getStatus = useCallback(async () => {
    if (DEMO_MODE) return null;
    try {
      const res = await fetch("/api/simulation/status");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SimulationStatus = await res.json();
      setStatus(data);
      return data;
    } catch {
      // A status poll that misses (server restarting, tab waking) is not a
      // user-facing error; the next poll simply tries again.
      return null;
    }
  }, []);

  const getResults = useCallback(async () => {
    try {
      const res = await fetch("/api/simulation/results");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: DistrictSummary = await res.json();
      setResults(data);
      return data;
    } catch (e: any) {
      setError(e.message);
      return null;
    }
  }, []);

  /* ── Campaign transport ──────────────────────────────────── */

  const transport = useCallback(async (url: string, body?: unknown) => {
    setTransportBusy(true);
    setTransportError(null);
    try {
      const res = await postJson(url, body);
      if (!res.ok) throw new Error(await describeFailure(res));
      const data = await res.json().catch(() => ({}));
      // Every transport reply carries the orchestrator's status fields.
      setStatus((prev) => (prev ? { ...prev, ...data, status: prev.status } : prev));
      return true;
    } catch (e: any) {
      setTransportError(e.message);
      return false;
    } finally {
      setTransportBusy(false);
    }
  }, []);

  const pause = useCallback(() => transport("/api/simulation/pause"), [transport]);
  const resume = useCallback(() => transport("/api/simulation/resume"), [transport]);
  const setSpeed = useCallback((multiplier: number) => transport("/api/simulation/speed", { multiplier }), [transport]);
  const skipDay = useCallback(() => transport("/api/simulation/skip-day"), [transport]);

  /* ── Polling ─────────────────────────────────────────────── */

  const getStatusRef = useRef(getStatus);
  useEffect(() => { getStatusRef.current = getStatus; }, [getStatus]);
  useEffect(() => {
    if (DEMO_MODE) return;
    let cancelled = false;
    const tick = () => { if (!cancelled) void getStatusRef.current(); };
    tick();
    if (!poll) return () => { cancelled = true; };
    const id = window.setInterval(tick, Math.max(500, pollMs));
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [poll, pollMs]);

  return {
    status,
    results,
    loading,
    error,
    transportError,
    transportBusy,
    startSimulation,
    getStatus,
    getResults,
    pause,
    resume,
    setSpeed,
    skipDay,
  };
}
