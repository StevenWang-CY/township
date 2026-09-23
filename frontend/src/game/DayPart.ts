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

// Scenario types name housing explicitly; the name rule is a fallback for
// untyped packages (a shop "Row" is commercial, so no `row$`).
const HOME_RE = /housing|residential|\bhomes?\b|apartment|cul-de-sac|subdivision|estates|village green/i;
const WORSHIP_RE = /church|temple|mosque|synagogue|baptist|chapel|parish|cathedral/i;
const FOOD_RE = /restaurant|diner|bodega|caf[eé]|grocery|\bdeli\b|pizza|slice|coffee|bakery|market|kitchen|tavern|\bpub\b|taqueria|cantina/i;
const EAT_RE = /lunch|dinner|breakfast|brunch|\beat|meal|coffee|snack|arepa|bandeja|takeout|table|empanada|cafecito|tailgate/i;
const WORK_RE = new RegExp([
  "\\bwork", "shift", "opens?\\b", "clinic", "office", "prep\\b", "preps?\\b", "class", "teach", "desk", "patrol",
  "meeting", "volunteer", "practice", "inventory", "calls?\\b", "supplier", "clients?", "patients?", "studio",
  "lab\\b", "register", "orders", "paperwork", "commute", "reports? to", "charting", "vitals", "drywall",
  "renovat", "construction", "crew\\b", "job site", "labor", "shelv", "returns", "reference", "counter\\b",
  "cashier", "stock", "deliver", "repair", "install", "paint", "haul", "load", "clean", "scrub", "cook",
  "serve", "nurse", "care center", "hardware", "till\\b", "sales", "customers?", "appointments?",
].join("|"), "i");
const PRAY_RE = /mass|prayer|pray|service|worship|shabbat|puja|sermon|vespers/i;
/** Running the place rather than visiting it. */
const STAFF_RE = /opens?\b|preps?\b|rush\b|supplier|shift\b|stocks?\b|inventory|register\b|cashier|\bworks?\b|serv(?:es|ing)|cooks?\b|kitchen|orders nonstop|till\b|closes?\b/i;
/** Said to happen outside: the curb, the stoop, the patio, a tailgate. */
const OUTDOOR_RE = /\bcurb|outside|patio|tailgate|sidewalk|porch|stoop|on the steps|corner\b|in line\b|parking lot|out front/i;

/** Resting-at-home hours (a resident at a housing landmark is "home", and
 *  visibly asleep late at night). */
export function isRestingHour(hour: number): boolean {
  return hour >= 21 || hour < 6.5;
}
export function isSleepingHour(hour: number): boolean {
  return hour >= 22 || hour < 6;
}
/** Hours in which a building with a routine stop means work, whatever the
 *  routine text says (a shift, a class, a reading room). */
function isWorkingHour(hour: number): boolean {
  return hour >= 6.5 && hour < 19;
}

/**
 * Derive the arrival activity for a resident at `landmark` given the routine
 * entry that sent them there (if any), the part of day, and the hour. The
 * place decides first (home, church, a diner), the routine text refines it
 * (a shift vs a meal), and for a plain building any working-hour stop is
 * work — the persona texts describe jobs in their own words, not keywords.
 */
export function deriveActivity(
  entry: RoutineEntry | undefined,
  landmark: LandmarkData | undefined,
  part: PartOfDay,
  hour: number,
): AgentActivity {
  const activity = entry?.activity ?? "";
  const kind = placeKind(landmark);
  if (kind === "home") {
    if (isSleepingHour(hour)) return "sleeping";
    if (isRestingHour(hour)) return "home";
    return WORK_RE.test(activity) ? "working" : "idle";
  }
  if (kind === "worship" || PRAY_RE.test(activity)) return "praying";
  if (kind === "food" || FOOD_RE.test(activity)) {
    // Staff work the room; everyone else is there to eat or linger.
    if (STAFF_RE.test(activity)) return "working";
    if (EAT_RE.test(activity) || part === "midday" || part === "evening") return "eating";
    return "idle";
  }
  if (kind === "open" || kind === "plaza" || kind === "road" || kind === "transport") {
    return EAT_RE.test(activity) ? "eating" : "idle";
  }
  // A building with a door: a meal is a meal, a job is a job, and any other
  // working-hour stop (a reading room, a class) happens inside as well.
  if (EAT_RE.test(activity)) return "eating";
  if (WORK_RE.test(activity)) return "working";
  if (entry && isWorkingHour(hour)) return "working";
  return "idle";
}

/** Doors face the road: arriving at a building you turn to face it; in the
 *  open you turn toward the camera. */
export function arrivalFacing(landmark: LandmarkData | undefined): "up" | "down" | undefined {
  if (!landmark) return undefined;
  if (/park|water|road|green|garden|field|lake|river|plaza|square|commons/i.test(landmark.type)) return "down";
  return "up";
}

/* ── Places: what kind of ground a landmark is, and who goes inside ────── */

import type { SpotRole } from "./Spots";

export type PlaceKind = "open" | "transport" | "plaza" | "food" | "worship" | "home" | "building" | "road";

const OPEN_RE = /park|water|green|garden|field|lake|river|commons|cemetery|trail/i;
const PLAZA_RE = /plaza|square|market|forecourt/i;
const TRANSPORT_RE = /station|transit|platform|depot|terminal|bus stop|rail/i;

/** Classify a landmark by type first, then by name. */
export function placeKind(landmark: LandmarkData | undefined): PlaceKind {
  if (!landmark) return "open";
  const type = landmark.type ?? "";
  const name = landmark.name ?? "";
  if (/road|street/i.test(type)) return "road";
  if (OPEN_RE.test(type)) return "open";
  if (PLAZA_RE.test(type) || PLAZA_RE.test(name)) return "plaza";
  if (TRANSPORT_RE.test(type) || TRANSPORT_RE.test(name)) return "transport";
  if (/housing|residential/i.test(type) || HOME_RE.test(name)) return "home";
  if (/church/i.test(type) || WORSHIP_RE.test(name)) return "worship";
  if (FOOD_RE.test(name) || /restaurant|diner|cafe|shop|store/i.test(type)) return "food";
  if (OPEN_RE.test(name)) return "open";
  return "building";
}

/** Buildings with a door — the places a resident can step inside. */
export function isEnterable(landmark: LandmarkData | undefined): boolean {
  const kind = placeKind(landmark);
  return kind === "home" || kind === "worship" || kind === "food" || kind === "building";
}

/**
 * Indoors when the place has a door and the resident is there to work,
 * eat, pray or rest — or whenever it is late: after 21:00 the street empties
 * and the windows carry the life instead. Parks, platforms and plazas never.
 */
export function shouldBeIndoors(
  landmark: LandmarkData | undefined,
  activity: AgentActivity,
  hour: number,
  routineText?: string,
): boolean {
  if (!isEnterable(landmark)) return false;
  // "Coffee on the curb", "tailgate lunch": the routine says outside.
  if (routineText && OUTDOOR_RE.test(routineText) && !isRestingHour(hour)) return false;
  if (activity === "working" || activity === "eating" || activity === "praying" || activity === "home" || activity === "sleeping") {
    return true;
  }
  return isRestingHour(hour);
}

/** Standing-spot roles, in priority order, for someone outdoors at a place. */
export function dwellRoles(landmark: LandmarkData | undefined, activity: AgentActivity): SpotRole[] {
  switch (placeKind(landmark)) {
    case "open": return ["lawn", "bench", "table", "stall", "platform"];
    case "transport": return ["platform", "bench", "door", "porch"];
    case "plaza": return ["stall", "table", "bench", "lawn", "porch"];
    case "food": return activity === "eating" ? ["table", "porch", "window", "bench"] : ["porch", "table", "window", "bench"];
    case "worship": return ["porch", "window", "bench", "lawn"];
    case "road": return ["bench", "porch"];
    default: return ["porch", "window", "bench", "table"];
  }
}
