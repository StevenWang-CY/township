/**
 * Activity feed entries: the simulation's raw events reduced to the handful
 * of things a viewer wants to read about a town — who moved, who talked,
 * who changed their mind (and, once attribution lands, why), what the news
 * said, who voted, what crossed the town line. Pure; components format.
 */
import type { SimulationEvent } from "../types/messages";

export type ActivityKind = "move" | "talk" | "shift" | "news" | "vote" | "gossip";

export interface ActivityEntry {
  /** Stable key: the event's absolute index in the run. */
  id: number;
  kind: ActivityKind;
  round?: number;
  /** The resident the row is about (taps through to them). */
  actorId?: string;
  actor?: string;
  /** Second party, place, or headline. */
  target?: string;
  /** New stance for a shift (option id, undecided included). */
  stanceId?: string;
  /** Why it happened, when known (filled by attribution). */
  cause?: string;
  /** Town the row belongs to (undefined = district-wide). */
  town?: string;
}

export interface ActivityLookups {
  /** Name for a resident id (undefined when unknown). */
  agentName: (id: string) => string | undefined;
}

export interface ActivityOptions {
  /** Absolute index of `events[0]` (the reducer's history start). */
  startIndex?: number;
  /** Keep at most this many rows, newest first. */
  limit?: number;
  /** Include per-resident moves (chatty in a replay); on by default. */
  moves?: boolean;
}

/**
 * Newest-first entries for `town` (or every town when null). Decided ids
 * on a round_ended become one vote row per resident.
 */
export function activityEntries(
  events: SimulationEvent[],
  town: string | null,
  lookups: ActivityLookups,
  opts: ActivityOptions = {},
): ActivityEntry[] {
  const start = opts.startIndex ?? 0;
  const limit = opts.limit ?? 40;
  const includeMoves = opts.moves ?? true;
  const out: ActivityEntry[] = [];
  let round: number | undefined;
  for (let i = 0; i < events.length; i++) {
    const evt = events[i];
    const id = start + i;
    switch (evt.type) {
      case "round_started":
        if (!town || !evt.town || evt.town === town) round = evt.round;
        break;
      case "agent_moved":
        if (!includeMoves || (town && evt.town !== town)) break;
        out.push({ id, kind: "move", round, actorId: evt.agent_id, actor: evt.agent_name, target: evt.to_location, town: evt.town });
        break;
      case "conversation_started": {
        const c = evt.conversation;
        if (town && c.town !== town) break;
        const [a, b] = c.participant_names;
        out.push({ id, kind: "talk", round: c.round ?? round, actorId: c.participants[0], actor: a, target: b ? `${b}${c.location ? ` · ${c.location}` : ""}` : c.location, town: c.town });
        break;
      }
      case "opinion_changed":
        if (town && evt.town !== town) break;
        out.push({ id, kind: "shift", round: evt.new_opinion?.round_number ?? round, actorId: evt.agent_id, actor: evt.agent_name, stanceId: evt.new_opinion?.candidate, town: evt.town });
        break;
      case "news_injected":
        out.push({ id, kind: "news", round: evt.round, target: evt.headline });
        break;
      case "round_ended":
        if (town && evt.town && evt.town !== town) break;
        for (const agentId of evt.decided_agent_ids ?? []) {
          out.push({ id: id * 1000 + out.length, kind: "vote", round: evt.round, actorId: agentId, actor: lookups.agentName(agentId) ?? agentId, town: evt.town });
        }
        break;
      case "cross_town_gossip":
        if (town && evt.to_town !== town && evt.from_town !== town) break;
        out.push({ id, kind: "gossip", round, actorId: evt.from_agent, actor: lookups.agentName(evt.from_agent) ?? evt.from_agent, target: lookups.agentName(evt.to_agent) ?? evt.to_agent, town: evt.to_town });
        break;
      default:
        break;
    }
  }
  return out.slice(-limit).reverse();
}
