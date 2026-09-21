/**
 * DayPart — what a resident is *doing* once they arrive somewhere.
 *
 * The simulation only says where people are; the persona routine says why
 * ("Lunch rush at La Finca", "Volunteer shift at the reference desk"). This
 * pure helper turns routine text + landmark type + the world clock into a
 * sprite activity so the town reads differently at 08:00, 12:30 and 23:00
 * instead of every resident standing in the same idle pose all day.
 */
import type { AgentActivity } from "./AgentSprite";
import type { RoutineEntry } from "./Routine";
import type { LandmarkData } from "../types/messages";
import type { PartOfDay } from "./WorldClock";

const HOME_RE = /housing|residential|home|apartment|cul-de-sac|subdivision|row$|estates|village green/i;
const WORSHIP_RE = /church|temple|mosque|synagogue|baptist|chapel|parish|cathedral/i;
const FOOD_RE = /restaurant|diner|bodega|caf[eé]|grocery|deli|pizza|slice|coffee|bakery|market|kitchen|tavern|pub/i;
const EAT_RE = /lunch|dinner|breakfast|brunch|\beat|meal|coffee|snack|arepa|bandeja|takeout|table/i;
const WORK_RE = /\bwork|shift|opens?\b|clinic|office|prep\b|class|teach|desk|patrol|meeting|volunteer|practice|inventory|calls?\b|supplier|clients?|patients?|studio|lab\b|register|orders|paperwork|commute/i;
const PRAY_RE = /mass|prayer|pray|service|worship|shabbat|puja|sermon|vespers/i;

/** Resting-at-home hours (a resident at a housing landmark is "home", and
 *  visibly asleep late at night). */
export function isRestingHour(hour: number): boolean {
  return hour >= 21 || hour < 6.5;
}
export function isSleepingHour(hour: number): boolean {
  return hour >= 22 || hour < 6;
}

/**
 * Derive the arrival activity for a resident at `landmark` given the routine
 * entry that sent them there (if any), the part of day, and the hour.
 */
export function deriveActivity(
  entry: RoutineEntry | undefined,
  landmark: LandmarkData | undefined,
  part: PartOfDay,
  hour: number,
): AgentActivity {
  const type = landmark?.type ?? "";
  const name = landmark?.name ?? "";
  const activity = entry?.activity ?? "";
  const homeLike = /housing/i.test(type) || HOME_RE.test(name);
  if (homeLike) {
    if (isSleepingHour(hour)) return "sleeping";
    if (isRestingHour(hour)) return "home";
    return WORK_RE.test(activity) ? "working" : "idle";
  }
  if (/church/i.test(type) || WORSHIP_RE.test(name) || PRAY_RE.test(activity)) return "praying";
  if (FOOD_RE.test(name) || FOOD_RE.test(activity)) {
    if (EAT_RE.test(activity) || part === "midday" || part === "evening") return "eating";
    if (WORK_RE.test(activity)) return "working";
    return "idle";
  }
  if (WORK_RE.test(activity) && !/park|water/i.test(type)) return "working";
  return "idle";
}

/** Doors face the road: arriving at a building you turn to face it; in the
 *  open you turn toward the camera. */
export function arrivalFacing(landmark: LandmarkData | undefined): "up" | "down" | undefined {
  if (!landmark) return undefined;
  if (/park|water|road|green|garden|field|lake|river|plaza|square|commons/i.test(landmark.type)) return "down";
  return "up";
}
