/**
 * Stance model shared by the canvas (opinion rings) and React (portrait
 * rings, cards): one vocabulary for "how sure is this resident, and did
 * anything just change?"
 */

export type StanceTier = "undecided" | "leaning" | "likely" | "firm" | "certain";

export interface StanceState {
  /** Scenario option id ("" when unknown). */
  optionId: string;
  /** Option color the scene renders with. */
  color: string;
  /** 0-100 confidence from the opinion event. */
  confidence: number;
  undecided: boolean;
}

/** What an opinion event means visually. */
export type StanceChange =
  | "silent" // nothing legible changed
  | "tick" // same stance, a confidence tier moved — ring pulse only
  | "settle" // first stance, or drifting back to undecided — ring morph + ballot
  | "flip"; // a different option — the full beat (morph, confetti, ballot)

export const STANCE_TIER_LABEL: Record<StanceTier, string> = {
  undecided: "Undecided",
  leaning: "Leaning",
  likely: "Likely",
  firm: "Firm",
  certain: "Certain",
};

/** Confidence tiers: thresholds fit both the recorded runs (35-75) and the
 *  deterministic mock (38-95). */
export function stanceTier(s: Pick<StanceState, "confidence" | "undecided">): StanceTier {
  if (s.undecided) return "undecided";
  const c = Number.isFinite(s.confidence) ? s.confidence : 0;
  if (c < 45) return "leaning";
  if (c < 65) return "likely";
  if (c < 85) return "firm";
  return "certain";
}

export function stanceChangeKind(prev: StanceState | null | undefined, next: StanceState): StanceChange {
  if (!prev) return next.undecided ? "silent" : "settle";
  if (prev.optionId !== next.optionId || prev.undecided !== next.undecided) {
    return next.undecided ? "settle" : "flip";
  }
  return stanceTier(prev) !== stanceTier(next) ? "tick" : "silent";
}

/** CSS ring for portraits/cards, mirroring the canvas ring tiers. */
export function ringStyleForTier(tier: StanceTier, color: string): {
  borderWidth: number;
  borderStyle: "solid" | "dotted";
  borderColor: string;
  opacity: number;
} {
  switch (tier) {
    case "undecided":
      return { borderWidth: 2, borderStyle: "dotted", borderColor: "#9A8E80", opacity: 0.9 };
    case "leaning":
      return { borderWidth: 2, borderStyle: "solid", borderColor: color, opacity: 0.55 };
    case "likely":
      return { borderWidth: 2, borderStyle: "solid", borderColor: color, opacity: 0.9 };
    case "firm":
      return { borderWidth: 3, borderStyle: "solid", borderColor: color, opacity: 1 };
    case "certain":
      return { borderWidth: 3, borderStyle: "solid", borderColor: color, opacity: 1 };
  }
}
