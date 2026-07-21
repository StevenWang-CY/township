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
    { a: "Have you heard how the new rules affect families?",  b: "People need clear answers, not rumors." },
    { a: "The paperwork keeps changing.",                       b: "And every change lands on real people." },
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
    { a: "Rents are ridiculous around here.",                   b: "We're looking farther out every week." },
    { a: "You hear about that affordable housing proposal?",    b: "I want to see the actual numbers." },
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
    { a: "Did you see how warm it was yesterday?",              b: "The seasons feel different now." },
  ],
  education: [
    { a: "Kids' reading scores came back.",                      b: "And?" },
    { a: "We need real teachers, not aides.",                    b: "Try telling Trenton that." },
  ],
};

/** Generic fallback exchanges if no concern matches. */
export const FALLBACK_EXCHANGES: ExchangeLines[] = [
  { a: "Did you catch the public meeting?",                      b: "Half of it. I still have questions." },
  { a: "Have you made up your mind?",                            b: "I'm still reading through it all." },
  { a: "I keep going back and forth.",                           b: "Same. There are real tradeoffs." },
  { a: "Long winter, huh.",                                       b: "Felt like it. Spring's a relief." },
  { a: "What matters most to you in this decision?",             b: "Tell me what you think first." },
  { a: "A lot of notices around town lately.",                    b: "More than I remember." },
];

/** Relationship-flavored lines, keyed by relationship type. */
export const RELATIONSHIP_EXCHANGES: Record<string, ExchangeLines[]> = {
  friend: [
    { a: "How's the family?",            b: "Loud. The usual." },
    { a: "We need to grab coffee.",     b: "Soon. I mean it this time." },
  ],
  neighbor: [
    { a: "I saw your light on late.",   b: "Couldn't sleep. Too much on my mind." },
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
