/* ── BottomSheet ─────────────────────────────────────────────
 * A phone-width host for side panels: a sheet docked to the bottom of its
 * container with a drag handle and three snap heights (peek, half, tall).
 * Drag with a finger or pointer, tap the handle to cycle, arrow keys on
 * the handle to step. Instant under reduced motion.
 * ─────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export type SheetSnap = 0 | 1 | 2;

interface BottomSheetProps {
  children: ReactNode;
  /** Snap heights in CSS lengths: peek, half, tall. */
  snaps?: [string, string, string];
  initial?: SheetSnap;
  label: string;
  /** Called after the sheet settles on a snap. */
  onSnap?: (snap: SheetSnap) => void;
  className?: string;
}

const DEFAULT_SNAPS: [string, string, string] = ["96px", "50%", "92%"];

function reducedMotion(): boolean {
  try {
    return document.documentElement.hasAttribute("data-reduced-motion") || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch { return false; }
}

export default function BottomSheet({ children, snaps = DEFAULT_SNAPS, initial = 0, label, onSnap, className }: BottomSheetProps) {
  const [snap, setSnap] = useState<SheetSnap>(initial);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const drag = useRef<{ startY: number; startH: number; moved: boolean } | null>(null);

  const settle = useCallback((next: SheetSnap) => {
    setSnap(next);
    setDragHeight(null);
    onSnap?.(next);
  }, [onSnap]);

  const snapPx = useCallback((): number[] => {
    const host = sheetRef.current?.parentElement;
    const hostH = host?.clientHeight ?? window.innerHeight;
    return snaps.map((s) => (s.endsWith("%") ? (parseFloat(s) / 100) * hostH : parseFloat(s)));
  }, [snaps]);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const el = sheetRef.current;
    if (!el) return;
    drag.current = { startY: e.clientY, startH: el.getBoundingClientRect().height, moved: false };
    (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return;
    const dy = drag.current.startY - e.clientY;
    if (Math.abs(dy) > 4) drag.current.moved = true;
    const [lo, , hi] = snapPx();
    setDragHeight(Math.max(lo * 0.6, Math.min(hi * 1.02, drag.current.startH + dy)));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    drag.current = null;
    try { (e.currentTarget as HTMLButtonElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (!d) return;
    if (!d.moved) { settle(((snap + 1) % 3) as SheetSnap); return; }
    const h = sheetRef.current?.getBoundingClientRect().height ?? 0;
    const px = snapPx();
    let best: SheetSnap = 0;
    px.forEach((p, i) => { if (Math.abs(p - h) < Math.abs(px[best] - h)) best = i as SheetSnap; });
    settle(best);
  };

  useEffect(() => {
    // Escape from anywhere inside the sheet drops it back to the peek.
    const el = sheetRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && snap !== 0) { e.stopPropagation(); settle(0); } };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [snap, settle]);

  const height = dragHeight != null ? `${dragHeight}px` : snaps[snap];
  const style: React.CSSProperties = {
    height,
    transition: dragHeight != null || reducedMotion() ? "none" : `height var(--duration-slow) var(--ease-out-soft)`,
  };

  return (
    <section ref={sheetRef} className={`bottom-sheet bottom-sheet--snap-${snap}${className ? ` ${className}` : ""}`} style={style} aria-label={label}>
      <button
        type="button"
        className="bottom-sheet-handle"
        aria-label={`${label}: ${["peek", "half", "tall"][snap]} — tap to expand`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") { e.preventDefault(); settle(Math.min(2, snap + 1) as SheetSnap); }
          if (e.key === "ArrowDown") { e.preventDefault(); settle(Math.max(0, snap - 1) as SheetSnap); }
        }}
      >
        <span className="bottom-sheet-grip" aria-hidden="true" />
      </button>
      <div className="bottom-sheet-body">{children}</div>
    </section>
  );
}
