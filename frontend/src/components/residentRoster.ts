import type { AgentState, TownId } from "../types/messages";

/** Muted, deterministic fallback colors for roster-only API records. */
export const ROSTER_COLORS = [
  "#B07040", "#6098C0", "#508858", "#A06888", "#D0A050",
  "#707888", "#C06060", "#60A090", "#8070A0", "#88A050",
];

interface RosterAgentWire {
  agent_id?: unknown;
  name?: unknown;
  occupation?: unknown;
  initial_lean?: unknown;
  top_concerns?: unknown;
}

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/** Convert `/api/simulation/agents` records to the UI's AgentState shape. */
export function rosterAgentsFromPayload(
  payload: unknown,
  townIds: TownId[],
  undecidedId: string,
): AgentState[] {
  if (!payload || typeof payload !== "object") return [];
  const byTown = (payload as { agents?: unknown }).agents;
  if (!byTown || typeof byTown !== "object") return [];

  const result: AgentState[] = [];
  for (const town of townIds) {
    const records = (byTown as Record<string, unknown>)[town];
    if (!Array.isArray(records)) continue;
    records.forEach((raw, index) => {
      if (!raw || typeof raw !== "object") return;
      const record = raw as RosterAgentWire;
      const id = typeof record.agent_id === "string" ? record.agent_id : "";
      const name = typeof record.name === "string" ? record.name : id;
      if (!id || !name) return;
      const concerns = Array.isArray(record.top_concerns)
        ? record.top_concerns.filter((v): v is string => typeof v === "string").slice(0, 2)
        : [];
      result.push({
        id,
        name,
        town,
        occupation: typeof record.occupation === "string" ? record.occupation : "Resident",
        opinion: {
          candidate: typeof record.initial_lean === "string" ? record.initial_lean : undecidedId,
          confidence: 35,
          reasoning: "",
          top_issues: concerns,
        },
        location: "",
        current_activity: "Going about the day",
        initials: initialsFor(name),
        color: ROSTER_COLORS[index % ROSTER_COLORS.length],
      });
    });
  }
  return result;
}
