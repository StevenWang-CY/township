/* ── Breakpoints ─────────────────────────────────────────────
 * The four widths the stylesheets may query (tokens.css declares the same
 * values as --breakpoint-*). Components that must branch in JS — a sidebar
 * that becomes a bottom sheet, a hover card that becomes a tap sheet, a pixel
 * layer that stops animating — read them through `useMediaQuery`, so CSS and
 * TSX never disagree about where "compact" begins. Never restyle from here;
 * that stays in CSS.
 * ─────────────────────────────────────────────────────────── */

import { useSyncExternalStore } from "react";

export const BREAKPOINTS = { sm: 480, md: 768, lg: 1024, xl: 1280 } as const;

export type BreakpointName = keyof typeof BREAKPOINTS;

/** `(width < 768px)` and friends, spelled once. */
export function below(name: BreakpointName): string {
  return `(width < ${BREAKPOINTS[name]}px)`;
}

function subscribe(query: string, onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const list = window.matchMedia(query);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

function matches(query: string): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(query).matches;
}

/**
 * Live result of a media query (`useMediaQuery("(pointer: coarse)")`,
 * `useMediaQuery(below("md"))`). Re-renders when the match flips; false on
 * the server and in environments without matchMedia.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => subscribe(query, onChange),
    () => matches(query),
    () => false,
  );
}

/** True below the `md` breakpoint — the phone layout. */
export function useIsPhone(): boolean {
  return useMediaQuery(below("md"));
}
