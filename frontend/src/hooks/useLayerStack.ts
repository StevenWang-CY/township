import { useEffect, useRef } from "react";

/* ── Universal Escape stack ─────────────────────────────────────
 *
 * Every dismissable layer (chat panel, tutorial, journal, settings,
 * listen-in panel) registers itself here while open. ONE capture-phase
 * document listener closes only the TOP layer per Escape press — stacked
 * layers peel off one at a time instead of all vanishing on one key.
 *
 * Layers register in mount order; the most recently opened layer is the
 * top of the stack. Components keep their own focus traps — this hook
 * only owns Escape.
 */

interface LayerEntry {
  id: number;
  close: () => void;
}

const stack: LayerEntry[] = [];
let nextId = 1;
let listenerAttached = false;

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== "Escape" || stack.length === 0) return;
  event.preventDefault();
  event.stopPropagation();
  const top = stack[stack.length - 1];
  top.close();
}

function ensureListener() {
  if (listenerAttached || typeof document === "undefined") return;
  // Capture phase: beat any per-component document listeners that might
  // still look at Escape.
  document.addEventListener("keydown", onKeyDown, true);
  listenerAttached = true;
}

function releaseListenerIfIdle() {
  if (!listenerAttached || stack.length > 0) return;
  document.removeEventListener("keydown", onKeyDown, true);
  listenerAttached = false;
}

/**
 * Register `close` as a dismissable layer while `active` is true.
 * Escape always dismisses the top-most active layer only.
 */
export function useLayerStack(active: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!active) return;
    const entry: LayerEntry = { id: nextId++, close: () => closeRef.current() };
    stack.push(entry);
    ensureListener();
    return () => {
      const idx = stack.indexOf(entry);
      if (idx >= 0) stack.splice(idx, 1);
      releaseListenerIfIdle();
    };
  }, [active]);
}

/** Test/diagnostic hook: current stack depth. */
export function layerStackDepth(): number {
  return stack.length;
}
