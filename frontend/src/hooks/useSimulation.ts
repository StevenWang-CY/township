import { useState, useCallback } from "react";
import type { SimulationStatus, DistrictSummary } from "../types/messages";

export function useSimulation() {
  const [status, setStatus] = useState<SimulationStatus | null>(null);
  const [results, setResults] = useState<DistrictSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startSimulation = useCallback(async (rounds = 5) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/simulation/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rounds }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStatus(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const getStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/simulation/status");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SimulationStatus = await res.json();
      setStatus(data);
      return data;
    } catch (e: any) {
      setError(e.message);
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

  return { status, results, loading, error, startSimulation, getStatus, getResults };
}
