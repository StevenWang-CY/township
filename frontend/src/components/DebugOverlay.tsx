import { useEffect, useState } from "react";
import type { SimulationEvent, WeatherKind } from "../types/messages";

interface DebugOverlayProps {
  events: SimulationEvent[];
  worldClock: { hour: number; minute: number };
  weather: WeatherKind;
  getPlayer?: () => { x: number; y: number } | null;
  getClosestAgent?: () => { id: string; distance: number } | null;
}

export default function DebugOverlay({
  events,
  worldClock,
  weather,
  getPlayer,
  getClosestAgent,
}: DebugOverlayProps) {
  const [fps, setFps] = useState(0);
  const [player, setPlayer] = useState<{ x: number; y: number } | null>(null);
  const [closest, setClosest] = useState<{ id: string; distance: number } | null>(null);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    let rafId = 0;

    const loop = () => {
      frame++;
      const now = performance.now();
      if (now - last >= 1000) {
        setFps(frame);
        frame = 0;
        last = now;
        if (getPlayer) setPlayer(getPlayer());
        if (getClosestAgent) setClosest(getClosestAgent());
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [getPlayer, getClosestAgent]);

  const recentEvents = events.slice(-5).reverse();

  return (
    <div className="debug-overlay" role="status" aria-label="Debug overlay">
      <div className="debug-overlay-row">
        <strong>FPS</strong> <span>{fps}</span>
      </div>
      <div className="debug-overlay-row">
        <strong>Clock</strong>{" "}
        <span>{worldClock.hour}:{worldClock.minute.toString().padStart(2, "0")}</span>
        <strong style={{ marginLeft: 12 }}>WX</strong> <span>{weather}</span>
      </div>
      {player && (
        <div className="debug-overlay-row">
          <strong>Player</strong>{" "}
          <span>{Math.round(player.x)}, {Math.round(player.y)}</span>
        </div>
      )}
      {closest && (
        <div className="debug-overlay-row">
          <strong>Closest</strong>{" "}
          <span>{closest.id} ({Math.round(closest.distance)}px)</span>
        </div>
      )}
      <div className="debug-overlay-row debug-overlay-row--list">
        <strong>Events</strong>
        <ul>
          {recentEvents.length === 0 && <li style={{ opacity: 0.5 }}>—</li>}
          {recentEvents.map((e, i) => (
            <li key={i}>{e.type}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
