/**
 * The four layout breakpoints (mirrors styles/tokens.css) and a hook that
 * tracks a media query. Components use it to swap hosts (sidebar ↔ bottom
 * sheet), never to restyle — that stays in CSS.
 */
import { useEffect, useState } from "react";

export const BREAKPOINTS = { sm: 480, md: 768, lg: 1024, xl: 1280 } as const;

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    try { return window.matchMedia(query).matches; } catch { return false; }
  });
  useEffect(() => {
    let mql: MediaQueryList;
    try { mql = window.matchMedia(query); } catch { return; }
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** True below the `md` breakpoint — the phone layout. */
export function useIsPhone(): boolean {
  return useMediaQuery(`(width < ${BREAKPOINTS.md}px)`);
}
