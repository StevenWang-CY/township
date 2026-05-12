/**
 * Pre-baked encounter conversation lines.
 *
 * Used by TownScene when two routine-driven agents end up at the same
 * landmark. Each (concern -> line pair) is a 2-line exchange; the first
 * speaker fires the question, the second responds. Falls back to the
 * generic pool if nothing matches.
 *
 * No LLM calls — this is purely flavor.
 */

export interface ExchangeLines {
  /** Speaker A says this first. */
  a: string;
  /** Speaker B replies. */
  b: string;
}

/** Generic exchanges keyed by issue. */
export const CONCERN_EXCHANGES: Record<string, ExchangeLines[]> = {
  immigration: [
    { a: "Did you hear about the ICE thing on Dickerson?",     b: "I haven't slept right since." },
    { a: "11 days till the election, and what about DACA?",    b: "I keep hoping. That's all you can do." },
  ],
  healthcare: [
    { a: "The ACA premium went up again, did you see?",        b: "Brutal. Every year, brutal." },
    { a: "My doctor doesn't take my insurance anymore.",        b: "Wait — since when?" },
  ],
  taxes: [
    { a: "How are property taxes treating you?",                b: "Don't even start." },
    { a: "They're talking another reassessment.",               b: "I might have to sell, honestly." },
  ],
  schools: [
    { a: "Did you go to the school board meeting?",             b: "Couldn't. Kid had a soccer thing." },
    { a: "The PTA's pushing back on the budget.",                b: "Good. About time." },
  ],
  housing: [
    { a: "Rents are ridiculous around here.",                   b: "We're looking at Bayonne now. Bayonne." },
    { a: "You hear about that affordable housing thing?",       b: "Smoke and mirrors, I bet." },
  ],
  economy: [
    { a: "Gas is back up over four bucks.",                     b: "And bread. Have you seen bread?" },
    { a: "Work's been slow at the shop.",                        b: "Tell me about it." },
  ],
  safety: [
    { a: "I saw flashing lights on Main again last night.",     b: "Third time this month." },
    { a: "We need more lighting on that block.",                b: "I've been saying that for a year." },
  ],
  environment: [
    { a: "The creek smells off again.",                          b: "I called the township. Crickets." },
    { a: "Did you see how warm it was yesterday?",              b: "In April? In Jersey?" },
  ],
  education: [
    { a: "Kids' reading scores came back.",                      b: "And?" },
    { a: "We need real teachers, not aides.",                    b: "Try telling Trenton that." },
  ],
};

/** Generic fallback exchanges if no concern matches. */
export const FALLBACK_EXCHANGES: ExchangeLines[] = [
  { a: "Did you catch the debate?",                              b: "Half of it. Lost the thread." },
  { a: "Are you voting early or election day?",                  b: "Trying to figure that out myself." },
  { a: "I keep going back and forth.",                           b: "Same. It's a lot." },
  { a: "Long winter, huh.",                                       b: "Felt like it. Spring's a relief." },
  { a: "Where are you on Mejia?",                                b: "Tell me where you're at first." },
  { a: "Lot of yard signs this year.",                            b: "More than I remember." },
];

/** Relationship-flavored lines, keyed by relationship type. */
export const RELATIONSHIP_EXCHANGES: Record<string, ExchangeLines[]> = {
  friend: [
    { a: "How's the family?",            b: "Loud. The usual." },
    { a: "We need to grab coffee.",     b: "Soon. I mean it this time." },
  ],
  neighbor: [
    { a: "I saw your light on late.",   b: "Couldn't sleep. The election." },
    { a: "Need anything from the store?", b: "You're a saint." },
  ],
  acquaintance: [
    { a: "How's the weather treating you?", b: "Could be worse. Always could." },
  ],
};

/** Pick a line set, preferring concern → relationship → fallback. */
export function pickExchange(
  sharedConcern: string | undefined,
  relationship?: string | undefined,
): ExchangeLines {
  if (sharedConcern && CONCERN_EXCHANGES[sharedConcern]) {
    const pool = CONCERN_EXCHANGES[sharedConcern];
    return pool[Math.floor(Math.random() * pool.length)];
  }
  if (relationship && RELATIONSHIP_EXCHANGES[relationship]) {
    const pool = RELATIONSHIP_EXCHANGES[relationship];
    return pool[Math.floor(Math.random() * pool.length)];
  }
  return FALLBACK_EXCHANGES[Math.floor(Math.random() * FALLBACK_EXCHANGES.length)];
}
