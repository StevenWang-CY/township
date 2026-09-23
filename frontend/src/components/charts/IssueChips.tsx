/* ── IssueChips ──────────────────────────────────────────────
 * A town's top issues as short chips: the first few words with a count
 * of how many residents raised it (when the summary carries one) and
 * the full text in the tooltip. Keeps the dashboard readable where raw
 * summary strings used to run three lines each.
 * ─────────────────────────────────────────────────────────── */

export interface IssueLike {
  issue: string;
  count?: number;
  importance?: number;
}

interface IssueChipsProps {
  issues: Array<string | IssueLike>;
  accent: string;
  max?: number;
  words?: number;
}

export function shortIssue(text: string, words = 4): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const parts = clean.split(" ");
  if (parts.length <= words) return clean.replace(/[.,;:]+$/, "");
  return parts.slice(0, words).join(" ").replace(/[.,;:]+$/, "") + "…";
}

export default function IssueChips({ issues, accent, max = 4, words = 4 }: IssueChipsProps) {
  const items = issues.slice(0, max).map((i) => (typeof i === "string" ? { issue: i } : i));
  if (items.length === 0) return null;
  return (
    <ul className="issue-chips">
      {items.map((it, i) => (
        <li key={i} className="issue-chip dashboard-town-issue" title={it.issue} style={{ borderColor: accent }}>
          <span className="issue-chip-text dashboard-town-issue-text">{shortIssue(it.issue, words)}</span>
          {it.count != null && it.count > 1 && <span className="issue-chip-count">{it.count}</span>}
        </li>
      ))}
    </ul>
  );
}
