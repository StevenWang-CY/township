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
  /** Persona routine, relationships and idle thoughts — the same fields the
   *  WebSocket roster carries, so a live town runs its schedules before any
   *  simulation event arrives. */
  routine?: unknown;
  relationships?: unknown;
  idle_thoughts?: unknown;
  /** Where the resident starts (their routine stop at the start clock). */
  location?: unknown;
}

function routineFrom(raw: unknown): Array<{ time: string; location: string; activity: string }> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw.filter((e): e is { time: string; location: string; activity: string } =>
    !!e && typeof e === "object"
    && typeof (e as { time?: unknown }).time === "string"
    && typeof (e as { location?: unknown }).location === "string"
    && typeof (e as { activity?: unknown }).activity === "string");
  return out.length > 0 ? out : undefined;
}

function relationshipsFrom(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
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
      const allConcerns = Array.isArray(record.top_concerns)
        ? record.top_concerns.filter((v): v is string => typeof v === "string")
        : [];
      const concerns = allConcerns.slice(0, 2);
      const idleThoughts = Array.isArray(record.idle_thoughts)
        ? record.idle_thoughts.filter((v): v is string => typeof v === "string")
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
        location: typeof record.location === "string" ? record.location : "",
        current_activity: "Going about the day",
        initials: initialsFor(name),
        color: ROSTER_COLORS[index % ROSTER_COLORS.length],
        routine: routineFrom(record.routine),
        relationships: relationshipsFrom(record.relationships),
        idle_thoughts: idleThoughts.length > 0 ? idleThoughts : undefined,
        top_concerns: allConcerns.length > 0 ? allConcerns : undefined,
      });
    });
  }
  return result;
}
