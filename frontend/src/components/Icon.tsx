/* ── Icon ────────────────────────────────────────────────────
 * The app's small glyph set, drawn once here instead of inline in every
 * component. 18 px box, 1.5 px strokes, currentColor. Decorative by
 * default (aria-hidden); pass `title` for a labelled image.
 * ─────────────────────────────────────────────────────────── */

import type { CSSProperties } from "react";

export type IconName =
  | "menu" | "close" | "journal" | "settings" | "sun" | "moon" | "star"
  | "play" | "pause" | "replay" | "arrow-right" | "check" | "map"
  | "chevron-down" | "external" | "info" | "people" | "clock" | "feed"
  | "calendar" | "ballot" | "news" | "talk" | "walk" | "gossip";

const STROKES: Partial<Record<IconName, React.ReactNode>> = {
  menu: <><path d="M3 4.5h12" /><path d="M3 9h12" /><path d="M3 13.5h12" /></>,
  close: <><path d="M4.5 4.5l9 9" /><path d="M13.5 4.5l-9 9" /></>,
  journal: <><path d="M3 3v12a1 1 0 0 0 1 1h11" /><path d="M6 3h9a1 1 0 0 1 1 1v11" /><path d="M9 6h4M9 9h4M9 12h4" /></>,
  settings: <><circle cx="9" cy="9" r="2.5" /><path d="M9 1.5v2M9 14.5v2M2.5 9H.5M17.5 9h-2M4.4 4.4L3 3M15 15l-1.4-1.4M4.4 13.6L3 15M15 3l-1.4 1.4" /></>,
  sun: <><circle cx="9" cy="9" r="3.2" /><path d="M9 1.8v1.8M9 14.4v1.8M1.8 9h1.8M14.4 9h1.8M3.9 3.9l1.3 1.3M12.8 12.8l1.3 1.3M3.9 14.1l1.3-1.3M12.8 5.2l1.3-1.3" /></>,
  moon: <path d="M14.5 10.6A6.2 6.2 0 1 1 7.4 3.5a4.8 4.8 0 0 0 7.1 7.1z" />,
  replay: <><path d="M15 9a6 6 0 1 1-1.8-4.3" /><path d="M15 2.5V6h-3.5" /></>,
  "arrow-right": <><path d="M3 9h12" /><path d="M10.5 4.5L15 9l-4.5 4.5" /></>,
  check: <path d="M3.5 9.5l3.5 3.5 7.5-8" />,
  map: <><path d="M2.5 4.5l4.5-2 4 2 4.5-2v11l-4.5 2-4-2-4.5 2z" /><path d="M7 2.5v11M11 4.5v11" /></>,
  "chevron-down": <path d="M4.5 7l4.5 4.5L13.5 7" />,
  external: <><path d="M7.5 3.5H4a1 1 0 0 0-1 1v9.5a1 1 0 0 0 1 1h9.5a1 1 0 0 0 1-1V10" /><path d="M10.5 3h4.5v4.5" /><path d="M15 3l-7 7" /></>,
  info: <><circle cx="9" cy="9" r="7" /><path d="M9 8v4.5" /><path d="M9 5.5v.2" /></>,
  people: <><circle cx="6.5" cy="6" r="2.5" /><path d="M1.8 15c.4-3 2.4-4.5 4.7-4.5s4.3 1.5 4.7 4.5" /><circle cx="12.5" cy="6.5" r="2" /><path d="M12.2 10.6c2 .1 3.6 1.5 4 4.4" /></>,
  clock: <><circle cx="9" cy="9" r="7" /><path d="M9 4.8V9l3 1.8" /></>,
  feed: <><path d="M3 5h12" /><path d="M3 9h12" /><path d="M3 13h8" /></>,
  calendar: <><rect x="2.5" y="4" width="13" height="11.5" rx="1" /><path d="M2.5 7.5h13M6 2.5v3M12 2.5v3" /></>,
  ballot: <><rect x="2.5" y="7" width="13" height="8.5" rx="1" /><path d="M6 7V3.5h6V7" /><path d="M7.5 5.2l1 1 2-2" /></>,
  news: <><rect x="2.5" y="3.5" width="13" height="11" rx="1" /><path d="M5.5 7h3v3h-3zM10.5 7h2.5M10.5 10h2.5M5.5 12.5h7.5" /></>,
  talk: <><path d="M3 4.5h9a1 1 0 0 1 1 1V10a1 1 0 0 1-1 1H7l-3 2.5V11a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1z" /><path d="M15 8v3.5a1 1 0 0 1-1 1v2l-2-2" /></>,
  walk: <><circle cx="10" cy="3" r="1.4" /><path d="M8.5 6.5l2 1 1.5 2.5M8.5 6.5L6.5 9l2 2.5-1.5 4M10.5 7.5l1.2 3.4 2.3 1.6M8.5 11.5l3 1.2" /></>,
  gossip: <><path d="M2.5 5h7a1 1 0 0 1 1 1v3.5a1 1 0 0 1-1 1H6l-2.5 2V10.5h-1a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" /><path d="M12.5 8h3a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-.5v2l-2-2h-1" /></>,
};

const FILLS: Partial<Record<IconName, React.ReactNode>> = {
  star: <path d="M9 1.8l2.2 4.7 5.1.6-3.8 3.4 1.1 5L9 13l-4.6 2.5 1.1-5L1.7 7.1l5.1-.6z" />,
  play: <path d="M4 3h2v12H4zM6 4h2v10H6zM8 5h2v8H8zM10 6h2v6h-2zM12 7h2v4h-2zM14 8h1v2h-1z" />,
  pause: <><rect x="4" y="3" width="3.5" height="12" /><rect x="10.5" y="3" width="3.5" height="12" /></>,
};

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
  /** Accessible name; when omitted the glyph is decorative. */
  title?: string;
}

export default function Icon({ name, size = 18, className, style, title }: IconProps) {
  const fill = FILLS[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill={fill ? "currentColor" : "none"}
      stroke={fill ? "none" : "currentColor"}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title && <title>{title}</title>}
      {fill ?? STROKES[name]}
    </svg>
  );
}
