# Township — Definitive Implementation Plan

## A Civic Swarm Intelligence Engine for NJ-11

**Hackathon:** CBC × Wharton AI × Anthropic — "Machines of Loving Grace"
**Track:** Democratic Governance & Collaboration
**Election:** NJ 11th Congressional District Special General Election, April 16, 2026
**Date:** April 6, 2026

---

## Table of Contents

1. [Concept & Thesis](#1-concept--thesis)
2. [The Election (Verified Facts)](#2-the-election-verified-facts)
3. [The Four Towns (Sourced Demographics)](#3-the-four-towns-sourced-demographics)
4. [System Architecture](#4-system-architecture)
5. [Agent Persona System](#5-agent-persona-system)
6. [Agent Cognitive Architecture](#6-agent-cognitive-architecture)
7. [Simulation Engine](#7-simulation-engine)
8. [Cross-Town Intelligence Layer](#8-cross-town-intelligence-layer)
9. [Frontend & Visualization](#9-frontend--visualization)
10. [Data Sources & Verification Protocol](#10-data-sources--verification-protocol)
11. [Reference Repositories](#11-reference-repositories)
12. [Hackathon Timeline](#12-hackathon-timeline)
13. [Demo Script](#13-demo-script)
14. [Why This Wins](#14-why-this-wins)

---

## 1. Concept & Thesis

**One sentence:** A living digital twin of NJ-11's electorate — 4 representative towns, each populated by AI residents who deliberate about a real election happening in 10 days — where real voters can walk in, talk to residents, and experience the democratic conversation their district never got to have.

**The problem:** NJ-11's special election has suffered total information infrastructure collapse. One debate happened (April 1, virtual). One candidate (Bond) was excluded entirely. The League of Women Voters debate was cancelled. The election is on a Thursday. 203,543 unaffiliated voters — the largest voting bloc — have almost no resources to make an informed decision.

**The thesis:** Swarm intelligence — emergent collective behavior from many agents with independent reasoning interacting freely — can simulate the democratic deliberation process that this election's broken infrastructure failed to provide. The insight comes not from any single agent but from the patterns that emerge when a diverse population processes the same information through different lived experiences.

**"Machines of Loving Grace" alignment:** The AI doesn't replace democratic participation. It creates a space where the full diversity of a community's reasoning becomes visible, accessible, and explorable. Democracy amplified, not automated.

---

## 2. The Election (Verified Facts)

### What's Happening

**Race:** Special election for NJ's 11th Congressional District (U.S. House of Representatives)
**Reason:** Mikie Sherrill (D) vacated the seat after winning the 2025 NJ gubernatorial election
**Election Day:** Thursday, April 16, 2026, 6:00 AM – 8:00 PM
**Early Voting:** April 6–14, 2026 (Mon–Sat 10 AM – 8 PM, Sun 10 AM – 6 PM) — *happening right now*
**Mail Ballot Deadline:** Apply by April 9 (mail) / April 15 3:00 PM (in-person)
*Source: NJ Division of Elections, nj.gov/state/elections/special-election.shtml*

### The Candidates

**Analilia Mejia (Democrat)**
- Co-executive director, Center for Popular Democracy. Daughter of Colombian/Dominican immigrants. Glen Ridge resident.
- Former national political director, Bernie Sanders 2020 campaign. Former deputy director, U.S. Women's Bureau (Biden admin).
- Won upset primary over former Rep. Tom Malinowski (Feb 5, 2026) with ~$600k vs. Malinowski's $1.2M.
- **Key positions:** Medicare for All, $25 minimum wage, free public college, student loan cancellation, PRO Act, abolish ICE, Supreme Court reform, called Netanyahu a war criminal.
- **Endorsements:** Sanders, Warren, AOC, Pressley, Jayapal, Ro Khanna.
*Sources: Wikipedia (en.wikipedia.org/wiki/Analilia_Mejia), Ballotpedia, analiliafornj.com/economy-for-everyone*

**Joe Hathaway (Republican)**
- Randolph Township councilman and former mayor. Yale '09 (Political Science). Former aide to Gov. Chris Christie.
- Ran unopposed in Republican primary.
- **Key positions:** Lower taxes, tax freeze for first-time homebuyers, cap student loan interest rates, supports One Big Beautiful Bill, pro-Gateway Tunnel, unconditional Israel support, workforce training investment. Self-described "new generation Republican."
- Acknowledged Biden won 2020. Would oppose Trump third term.
*Sources: joehathawayforcongress.com/platform, Morristown Green (March 30, 2026), The Setonian (April 3, 2026)*

**Alan Bond (Independent — "Hope for Tomorrow!" party)**
- Montclair resident. Dartmouth BA, Harvard MBA. Former Wall Street fund manager.
- Served 6 years in federal prison (2003–2008) after conviction on 6 counts of fraud for a $6.9M pension fund "cherry-picking" scheme.
- **Key positions:** Affordability, education, healthcare, community safety. Excluded from the only debate.
*Sources: Ballotpedia (ballotpedia.org/Alan_Bond), Patch.com Montclair (March 28, 2026)*

### The District

**Voter Registration (as of April 1, 2026):** 229,561 Democrats / 164,954 Republicans / 203,543 Unaffiliated
*Source: Patch.com Livingston, "NJ-11 Debate Between Mejia, Hathaway: 5 Things To Know," April 2, 2026*

**Cook PVI:** D+5
*Source: Ballotpedia, citing 2024 and 2020 presidential results*

**Population:** 779,403
**Median HH Income:** $137,244
**Foreign-born:** 21.6% (168k people)
**Non-English households:** 29.6% — Spanish (92,826 HH / 12.6%), Chinese incl. Mandarin/Cantonese (18,046 HH / 2.45%), Gujarati (8,962 HH / 1.22%)
*Source: DataUSA, ACS 2024 5-year (datausa.io/profile/geo/congressional-district-11-nj)*

### The Debate (April 1, 2026)

Only one debate occurred — virtual, hosted by NJ Globe + Rider University's Rebovich Institute. Mejia initially refused the League of Women Voters debate (cancelled March 20). Bond was excluded.

**Key issues debated:** Affordability / cost of living, healthcare (ACA subsidy removal), immigration / ICE, Israel / Gaza, taxes / SALT deduction, Gateway Tunnel, war with Iran, Trump relationship.

**Key exchanges:**
- Hathaway called Mejia "radical socialist," attacked her as antisemitic for calling Netanyahu a war criminal
- Mejia called Hathaway "wolf in sheep's clothing," a "rubber stamp for Trump"
- Hathaway supports One Big Beautiful Bill; Mejia opposes it
- Hathaway: unconditional aid to Israel. Mejia: condition aid on human rights.
- Both agree Gateway Tunnel is critical (rare common ground)
*Sources: Montclair Local, NJ Monitor, Morristown Green, Jewish Insider, Patch.com — all dated April 1–3, 2026*

---

## 3. The Four Towns (Sourced Demographics)

### Selection Rationale

We select 4 municipalities that together capture the district's full spectrum: income ($70k–$175k median), race (14% White to 75% Hispanic), political lean (deep blue to lean red), immigrant share (9% to 51% foreign-born). A voter from anywhere in NJ-11 can find a town that mirrors their community.

---

### Town 1: MONTCLAIR (Essex County) — "The Progressive Hub"

| Metric | Value | Source |
|---|---|---|
| Population | 40,341 | Census Reporter, ACS 2024 5-year |
| Median age | 39.9 | Census Reporter, ACS 2024 5-year |
| Median HH income | $151,075 | Census Reporter, ACS 2024 5-year |
| Per capita income | $91,351 | Census Reporter, ACS 2024 5-year |
| Poverty rate | 7.5% | Census Reporter, ACS 2024 5-year |
| White (non-Hispanic) | ~57–59% | Point2Homes, ACS 2019-2023 |
| Black/African American | ~18–19% | Point2Homes, ACS 2019-2023 |
| Asian | ~5–6% | Point2Homes, ACS 2019-2023 |
| Hispanic/Latino | ~10–11% | Point2Homes, ACS 2019-2023 |
| Foreign-born | ~16–17% | Point2Homes, ACS 2019-2023 |

**Character:** Progressive, racially diverse, affluent, arts/culture hub. Alan Bond lives here; Mejia in neighboring Glen Ridge. Strong progressive lean.

**Tilemap landmarks:** Bloomfield Ave commercial strip, Bay Street NJ Transit Station, Montclair Art Museum, Town Hall, Public Library, Anderson Park, Upper Montclair vs. South End residential, St. Paul Baptist Church.

**Agents (7):** Progressive professional couple (white, dual-income), retired Black educator, young artist/renter, Latinx family, Jewish community member, Bloomfield Ave shop owner, elderly widow near Bay Street.

---

### Town 2: PARSIPPANY-TROY HILLS (Morris County) — "The Suburban Melting Pot"

| Metric | Value | Source |
|---|---|---|
| Population | 56,397 | Census Reporter, ACS 2024 5-year |
| Median age | 42.5 | Census Reporter, ACS 2024 5-year |
| Median HH income | $112,327 | Census Reporter, ACS 2024 5-year |
| Per capita income | $61,016 | Census Reporter, ACS 2024 5-year |
| Poverty rate | 4.8% | World Population Review, ACS 2024 |
| White | ~47–50% | Point2Homes, ACS 2019-2023 |
| Asian | ~35–38% | Point2Homes / World Population Review, ACS 2019-2023 |
| Black/African American | ~3.5% | Point2Homes, ACS 2019-2023 |
| Hispanic/Latino | ~8% | Point2Homes, ACS 2019-2023 |
| Foreign-born | ~37% | Point2Homes, ACS 2019-2023 |

**Character:** District's largest town, dramatically Asian-American (primarily Indian/South Asian). Corporate hub, swing-voter territory.

**Tilemap landmarks:** Corporate office park, Lake Parsippany Clubhouse, Route 46 Indian restaurant/grocery corridor, Hindu temple, residential subdivisions, NJ Transit bus stop, public library.

**Agents (7):** Indian-American IT professional family, Gujarati-speaking grandparent, white middle-manager NYC commuter, young South Asian couple renting, motel/restaurant owner, retired corporate executive, Filipino healthcare worker.

---

### Town 3: DOVER (Morris County) — "The Working-Class Heart"

| Metric | Value | Source |
|---|---|---|
| Population | 18,435 | BiggestUSCities.com, Census 2024 estimates |
| Median age | 41.0 | newjersey-demographics.com, ACS 2023 |
| Median HH income | $70,519 | DataUSA, ACS 2023 |
| Per capita income | $38,130 | World Population Review, ACS 2023 |
| Poverty rate | 11.6% | DataUSA, ACS 2023 |
| Hispanic/Latino | ~69–75% | Wikipedia (69.4% 2010 Census) / newjersey-demographics.com (75.0% ACS 2023) |
| White (non-Hispanic) | ~14% | newjersey-demographics.com, ACS 2023 |
| Black/African American | ~6–9% | Various, ACS 2019-2023 |
| Foreign-born | ~51.5% | DataUSA, ACS 2023 |
| US citizens | 67.3% | DataUSA, ACS 2023 |
| Non-English at home | 68.9% (66.0% Spanish) | BiggestUSCities.com, ACS data |
| Top ancestry | Colombian (15.2%), Mexican (14.9%), Puerto Rican (11.1%), Ecuadorian (5.6%) | Wikipedia, 2010 Census |

**Character:** Majority-Hispanic working-class town. 51.5% foreign-born. Median income less than half of Randolph's. The community most directly affected by ICE enforcement and healthcare affordability. Profoundly underrepresented in NJ-11 political coverage.

**Tilemap landmarks:** Blackwell Street (historic main street), Dover NJ Transit station, St. Mary's Catholic Church, Latino businesses (bodegas, taquerias, barber shops), public housing, Dover Public Library, factory/warehouse.

**Agents (6):** Colombian-American restaurant owner, Mexican construction worker (ICE fears), Puerto Rican single mother (healthcare), elderly Dominican on Social Security, young DACA recipient, white longtime Dover resident.

---

### Town 4: RANDOLPH (Morris County) — "The Republican Suburb"

| Metric | Value | Source |
|---|---|---|
| Population | 26,604 | Census Reporter, ACS 2024 5-year |
| Median age | 39.1 | Census Reporter, ACS 2024 5-year |
| Median HH income | $175,000 | Census Reporter, ACS 2024 5-year |
| Per capita income | $75,883 | Census Reporter, ACS 2024 5-year |
| Poverty rate | 5.4% | Census Reporter, ACS 2024 5-year |
| White | ~67–75% | Randolph Twp official (75% 2020 Census) / World Population Review (67.4% ACS 2024) |
| Asian | ~9–13% | Randolph Twp (13.3% 2020) / World Population Review (9.0% ACS 2024) |
| Hispanic/Latino | ~7–12% | Randolph Twp (11.6% 2020) / World Population Review (7.1% ACS 2024) |
| Black/African American | ~3–4% | Randolph Twp (3.7% 2020) / World Population Review (3.0% ACS 2024) |
| Bachelor's degree+ | 68.4% | Randolph Township official website |
| Homeownership | 76.2% | Randolph Township official website |

**Character:** Hathaway's literal home base. Affluent, family-oriented, predominantly white but diversifying. Highest median income of the four towns. Republican-leaning but not monolithically so.

**Tilemap landmarks:** Randolph Town Hall, Randolph High School, commercial strip, large-lot residential cul-de-sacs, youth sports fields, Hedden Park entrance, church, Randolph Diner.

**Agents (6):** Finance professional/NYC commuter, stay-at-home mom (schools, taxes), retired military veteran, young couple with first mortgage, Indian-American software engineer (moved for schools), local business owner who knows Hathaway.

---

## 4. System Architecture

### High-Level Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    FRONTEND (React)                       │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ NJ-11 Map    │  │ Town View    │  │ District     │   │
│  │ (Entry)      │→ │ (Phaser/     │  │ Dashboard    │   │
│  │              │  │  Canvas)     │  │ (Cross-town) │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
│                    ┌──────────────┐  ┌──────────────┐   │
│                    │ Chat Panel   │  │ God's View   │   │
│                    │ (+ElevenLabs)│  │ (Inject vars)│   │
│                    └──────────────┘  └──────────────┘   │
└──────────────────────┬───────────────────────────────────┘
                       │ WebSocket (discriminated union messages)
┌──────────────────────┴───────────────────────────────────┐
│                  BACKEND (Python / FastAPI)                │
│                                                          │
│  ┌─────────────────────────────────────────────────┐     │
│  │           Simulation Orchestrator                │     │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌───────┐ │     │
│  │  │Montclair│ │Parsipp. │ │ Dover   │ │Randol.│ │     │
│  │  │ Runner  │ │ Runner  │ │ Runner  │ │Runner │ │     │
│  │  └────┬────┘ └────┬────┘ └────┬────┘ └───┬───┘ │     │
│  │       └───────────┴──────────┴───────────┘     │     │
│  │                    EventBus                     │     │
│  └─────────────────────────────────────────────────┘     │
│                                                          │
│  ┌──────────────────┐  ┌──────────────────┐              │
│  │ Agent Loader     │  │ Claude API Layer │              │
│  │ (.md → persona)  │  │ (async batch,    │              │
│  │                  │  │  cost tracking)  │              │
│  └──────────────────┘  └──────────────────┘              │
│                                                          │
│  ┌──────────────────┐  ┌──────────────────┐              │
│  │ Memory Store     │  │ Report Agent     │              │
│  │ (per-agent       │  │ (post-sim        │              │
│  │  SQLite/JSON)    │  │  analysis)       │              │
│  └──────────────────┘  └──────────────────┘              │
└──────────────────────────────────────────────────────────┘
```

### Core Design Principles

1. **Agents-as-data, not agents-as-code.** Every persona is a markdown file with YAML frontmatter. No code changes needed to add, edit, or remove agents — just edit `.md` files.
2. **Towns run in parallel.** Each town's simulation is an independent worker. The orchestrator distributes rounds across 4 parallel runners and collects results.
3. **Communication via EventBus.** All agent-to-agent interaction, cross-town gossip, news injection, and round advancement flow through a typed event bus. No direct coupling between agents.
4. **Typed everything.** Agent actions use schema-validated tools. UI messages use discriminated unions. State transitions follow an explicit state machine. No stringly-typed interfaces.
5. **Cost-aware by default.** Every Claude API call tracks input/output tokens and cost. A real-time cost dashboard shows spend-per-town and spend-per-round.

---

## 5. Agent Persona System

### Agent Definition Format

Each agent is a markdown file with YAML frontmatter + a body that becomes the system prompt:

```
agents/dover/colombian-restaurant-owner.md
```

```yaml
---
name: Carlos Restrepo
town: dover
description: Colombian-American restaurant owner on Blackwell St, Dover. 22 years in the US.
age: 51
occupation: Owner, La Finca Restaurant
household: Married, 3 children (19, 16, 12). Wife works as dental hygienist.
income_bracket: ~$85k household
language: Spanish primary, functional English
political_registration: unaffiliated
initial_lean: undecided
top_concerns:
  - healthcare costs (no employer insurance, ACA marketplace)
  - immigration enforcement (employees, community fear)
  - property taxes on commercial lease
  - son's college affordability
tools: [Discuss, FormOpinion, ReactToNews]
model: claude-sonnet-4-6
---

You are Carlos Restrepo, age 51. You own La Finca, a Colombian restaurant on
Blackwell Street in Dover, NJ that you started 14 years ago. You came from
Bogotá in 2004. You are a naturalized US citizen (2012) but many of your
employees and neighbors are not. You are proud of your business but exhausted
by rising costs...

[Full persona continues: personality traits, speaking style, specific memories,
 knowledge of candidates, relationships with other agents in Dover]
```

### Agent Loader

The loader parses these `.md` files at startup:

```typescript
interface AgentDefinition {
  name: string;
  town: string;
  description: string;
  age: number;
  occupation: string;
  household: string;
  income_bracket: string;
  language: string;
  political_registration: "democrat" | "republican" | "unaffiliated";
  initial_lean: "mejia" | "hathaway" | "bond" | "undecided";
  top_concerns: string[];
  tools: string[];
  model: string;
  systemPrompt: string; // The markdown body
}
```

**Benefits:**
- Team members can write/edit personas without touching code
- Hot-reload: edit a `.md` file → agent updates without restarting simulation
- Git-trackable: persona iterations show up as clean diffs
- Pre-hackathon prep: write all 26 `.md` files before the hackathon (data, not code)

### Agent Distribution

| Town | Agents | Political Mix | Key Demographic Coverage |
|---|---|---|---|
| Montclair | 7 | 4D / 1R / 2U | Black, white, Latino, Asian, young renter, retiree, small biz |
| Parsippany | 7 | 2D / 2R / 3U | Indian, Gujarati elder, white, Filipino, South Asian young couple |
| Dover | 6 | 2D / 0R / 4U | Colombian, Mexican, Puerto Rican, Dominican, DACA, white long-timer |
| Randolph | 6 | 1D / 3R / 2U | Finance commuter, stay-at-home mom, veteran, young buyers, tech worker |
| **Total** | **26** | **9D / 6R / 11U** | Mirrors district: 38% D / 28% R / 34% U |

---

## 6. Agent Cognitive Architecture

Adapted from Park et al. (2023) "Generative Agents" (arXiv:2304.03442):

### Three Cognitive Modules

**1. Memory Stream**
- Chronological list of observations, conversations, and reflections
- Each memory: `{ description, timestamp, importance (1-10), embedding }`
- Pre-seeded with background memories from persona definition
- Updated after every round with new observations

**2. Reflection**
- Triggered when accumulated importance of recent memories exceeds a threshold
- Synthesizes patterns: "I've talked to three neighbors and they're all worried about healthcare costs. Maybe this is the biggest issue."
- Reflections become high-importance memories that inform future behavior

**3. Planning**
- Each round: agent decides where to go, who to talk to, what topic to raise
- Influenced by: recent memories, reflections, personality, current opinion state

### Agent Actions (Schema-Validated Tools)

Each action is a typed tool with schema validation:

```typescript
// Base pattern: all tools validate input against a schema
abstract class AgentTool<T extends ZodType> {
  abstract name: string;
  abstract description: string;
  abstract schema: T;
  abstract run(input: z.infer<T>): Promise<ToolResult>;
}
```

**Discuss** — Conversation with another agent at a location:
```typescript
const DiscussSchema = z.object({
  otherAgent: z.string(),
  location: z.string(),
  topic: z.string(),
  myStance: z.enum(["agree", "disagree", "undecided", "persuaded"]),
  dialogue: z.string(), // The generated conversation
  keyTakeaway: z.string(), // What I learned/felt
});
```

**FormOpinion** — Crystallize election stance:
```typescript
const FormOpinionSchema = z.object({
  candidate: z.enum(["mejia", "hathaway", "bond", "undecided"]),
  confidence: z.number().min(0).max(100),
  reasoning: z.string(),
  topIssues: z.array(z.string()),
  dealbreaker: z.string().optional(), // "I can't vote for X because..."
});
```

**ReactToNews** — Process a news event or debate clip:
```typescript
const ReactToNewsSchema = z.object({
  event: z.string(),
  emotionalResponse: z.enum(["angry", "hopeful", "anxious", "indifferent", "confused"]),
  impactOnVote: z.enum(["strengthens_current", "weakens_current", "changes_mind", "no_effect"]),
  reasoning: z.string(),
});
```

### Agent State Machine

Agents cycle through explicit lifecycle states within each round:

```typescript
type CivicAgentState =
  | "idle"        // Between rounds
  | "observing"   // Receiving new info (debate clip, news)
  | "discussing"  // In conversation with another agent
  | "reflecting"  // Synthesizing memories into higher-level insight
  | "decided"     // Final opinion formed (terminal for simulation)
  | "error";      // Recovery state

const validTransitions: Record<CivicAgentState, CivicAgentState[]> = {
  idle:       ["observing"],
  observing:  ["discussing", "reflecting"],
  discussing: ["reflecting", "discussing"], // Can chain conversations
  reflecting: ["idle", "decided"],
  decided:    [],
  error:      ["idle"],
};
```

---

## 7. Simulation Engine

### Round-Based Orchestration

```
ROUND 0 — SEED INJECTION
  All agents receive: candidate positions, key debate excerpts, election logistics
  Each processes through personal lens → initial opinion (FormOpinion tool)

ROUND 1 — LOCAL CONVERSATIONS
  Agents move to locations in their town
  Random encounters: 2-3 conversations per agent (Discuss tool)
  Memory updates after each conversation

ROUND 2 — NEWS REACTION
  EventBus publishes: debate clips, endorsement news, cost-of-living data
  Each agent processes via ReactToNews tool
  Reflections triggered for agents with high accumulated importance

ROUND 3 — CROSS-TOWN GOSSIP
  Select agents "hear from a friend/relative in another town"
  EventBus carries cross-town messages
  Dover's Carlos hears from Parsippany's Raj about healthcare costs
  Montclair's Sarah hears from Randolph's Mike about tax burden

ROUND 4 — DEEPENING OPINIONS
  More local conversations, now informed by cross-town perspectives
  Agents who were "undecided" begin to crystallize (or stay conflicted)
  Reflections synthesize multi-round experience

ROUND 5 — ELECTION EVE
  Final FormOpinion from all agents
  Some remain undecided (authentic — not everyone decides)
  ReportAgent generates cross-town analysis
```

### Parallel Town Execution

Each town runs as an independent worker, orchestrated in parallel:

```typescript
interface TownSimulationResult {
  town: string;
  agentStates: AgentState[];
  conversations: Conversation[];
  opinionTrajectories: OpinionTrajectory[];
  usage: { inputTokens: number; outputTokens: number };
  cost: number;
}

// District orchestrator runs all 4 towns in parallel
const results = await Promise.all(
  towns.map(town => runTownSimulation({
    town,
    agents: town.agents,
    rounds: 5,
    eventBus, // shared for cross-town events in Round 3
  }))
);

const districtSummary = aggregateResults(results);
```

### Cost Tracking

Every Claude API call is wrapped with token counting:

```typescript
function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  if (text.length > 100_000) return Math.ceil(text.length / 3.5);
  return encode(text).length;
}

// After each agent turn:
const turnCost =
  (usage.inputTokens * MODEL_COST.input +
   usage.outputTokens * MODEL_COST.output) / 1_000_000;

simulationCost.total += turnCost;
simulationCost.byTown[agent.town] += turnCost;
simulationCost.byRound[currentRound] += turnCost;
```

**Estimated total cost:**
~26 agents × ~5 actions/round × 5 rounds × ~400 tokens avg = ~260k tokens
Claude Sonnet ($3/M input, $15/M output) ≈ **$5–8 for the full pre-computed simulation**
Interactive chat at demo ≈ additional $2–3. Well within hackathon credits.

---

## 8. Cross-Town Intelligence Layer

### EventBus

All inter-agent and system-level communication flows through a typed event bus:

```typescript
type SimulationEvent =
  | { type: "debate_clip"; topic: string; content: string }
  | { type: "news_event"; headline: string; impact: string }
  | { type: "cross_town_gossip"; fromTown: string; toTown: string;
      fromAgent: string; opinion: string }
  | { type: "round_advance"; round: number }
  | { type: "god_view_injection"; variable: string; description: string };

class EventBus {
  subscribe(name: string, filter: (e: SimulationEvent) => boolean,
            handler: (e: SimulationEvent) => Promise<void>): () => void;
  async publish(event: SimulationEvent): Promise<void>;
}

// Agent subscribes to events relevant to them:
eventBus.subscribe(
  agent.name,
  (e) => e.type === "round_advance" ||
         (e.type === "news_event") ||
         (e.type === "cross_town_gossip" && e.toTown === agent.town),
  async (e) => agent.processEvent(e)
);
```

### God's View (Variable Injection)

Inspired by MiroFish: users inject events into the simulation and watch the swarm respond.

```typescript
// User types: "Healthcare premiums in NJ increase 20%"
eventBus.publish({
  type: "god_view_injection",
  variable: "healthcare_cost_shock",
  description: "Breaking: NJ healthcare premiums to increase 20% next quarter"
});

// All agents receive this as a news event and re-process via ReactToNews
// Opinion distributions shift visibly on the dashboard
```

### Cross-Town Summary Statistics

After simulation completes, aggregate with bucketed statistics:

```typescript
interface DistrictSummary {
  byTown: Record<string, TownSummary>;
  byIssue: Record<string, { mentions: number; sentiment: number }>;
  consensusZones: string[];   // Issues where 70%+ agents across towns agree
  faultLines: string[];       // Issues with highest inter-town disagreement
  prediction: { mejia: number; hathaway: number; bond: number; undecided: number };
}

interface TownSummary {
  opinionDistribution: Record<string, number>;
  topIssues: Array<{ issue: string; importance: number }>;
  stats: { min: number; max: number; mean: number; median: number; p95: number };
  // Stats computed over agent confidence scores
}
```

---

## 9. Frontend & Visualization

### Entry: NJ-11 District Map

An SVG map of NJ-11 showing Essex, Morris, and Passaic county boundaries with 4 clickable town pins. Each pin shows name, descriptor, and a mini demographic badge.

Below the map: "Where are you from? Click the community closest to yours."

For voters not near any of the four, provide a mapping: Livingston → Parsippany profile. Bloomfield → Montclair profile. Rockaway → Randolph profile. Morristown → split Montclair/Parsippany.

### Town View: 2D Tile-Based Map

**Ambitious path (Phaser.js):** Fork the Smallville environment from `joonspk-research/generative_agents`. Re-skin tiles to match each NJ town. Agent sprites walk between labeled locations, speech bubbles appear during conversations, click any agent to chat.

**Practical path (React Canvas/SVG):** A stylized bird's-eye map with labeled location nodes and agent avatar bubbles. Agents animate between locations. Click any agent → chat panel opens. Still visually distinctive, much faster to build.

**Pre-build tilemap assets** in Tiled (`mapeditor/tiled`) before the hackathon — 4 maps, ~20×20 tiles each, ~10 labeled locations per town.

### Streaming UI Messages

All simulation activity streams to the frontend via WebSocket using discriminated union types:

```typescript
type SimulationMessage =
  | { type: "agent_move"; agentId: string; town: string;
      location: string; x: number; y: number }
  | { type: "conversation_start"; agents: string[];
      topic: string; location: string }
  | { type: "speech_bubble"; agentId: string; text: string;
      sentiment: "positive" | "negative" | "neutral" }
  | { type: "opinion_change"; agentId: string;
      before: CandidatePreference; after: CandidatePreference }
  | { type: "round_complete"; round: number; townId: string;
      summary: TownSummary }
  | { type: "simulation_complete"; districtSummary: DistrictSummary };
```

The React frontend consumes this with a `useReducer` pattern — each message type triggers a specific UI update without any message type ambiguity.

### District Dashboard

Shows all 4 towns side-by-side:
- Opinion distribution pie chart per town
- Top issues bar chart per town
- Consensus zones highlighted across towns (where surprising agreement emerges)
- Fault lines (where towns diverge most)
- Per-agent cards sortable by: confidence, town, political registration, undecided-first

Each agent card shows: avatar/sprite preview, name, town badge, status (discussing/reflecting/decided), latest conversation snippet, confidence level.

### Chat Panel + ElevenLabs

Click any agent → right panel opens with chat interface. Agent responds in character drawing on full memory stream + reflections. ElevenLabs gives each agent a contextual voice — Rosa Chen (retired Taiwanese-American teacher) sounds different from Carlos Restrepo (Colombian restaurant owner).

---

## 10. Data Sources & Verification Protocol

### Authoritative Sources (Use These First)

| Source | URL | Data | Freshness |
|---|---|---|---|
| Census Reporter | censusreporter.org/profiles/06000US34{fips} | Population, income, age, race, poverty, housing | ACS 2024 5-year |
| Census QuickFacts | census.gov/quickfacts | Official Census per municipality | ACS 2024 5-year |
| DataUSA | datausa.io/profile/geo/ | District-level: language, occupation, industry, foreign-born | ACS 2024 5-year |
| NJ Div. of Elections | nj.gov/state/elections/special-election.shtml | Voting logistics, registration, early voting locations | Real-time (2026) |
| Ballotpedia | ballotpedia.org (NJ-11 special election page) | Candidate bios, endorsements, election timeline | Updated continuously |
| Morris County Municipal Profiles | morriscountynj.gov (PDF profiles) | Per-municipality data combining Census, DCA, DOL | 2024 profiles |
| Randolph Township Official | randolphnj.org/452/Demographics | Official township demographics | 2020 Census |

### Candidate Information (Primary Sources Only)

| Candidate | Official Source | Backup Sources |
|---|---|---|
| Mejia | analiliafornj.com | Wikipedia, Ballotpedia, Montclair Local, NJ Monitor |
| Hathaway | joehathawayforcongress.com/platform | Morristown Green, The Setonian, Patch.com, Village Green NJ |
| Bond | Ballotpedia (Alan Bond page) | Patch.com Montclair |

### Verification Rules for Coding Agent

1. **NEVER fabricate demographic numbers.** Every stat must trace to a Census Bureau source (ACS 2024 5-year preferred, ACS 2023 5-year acceptable).
2. **Cross-reference when sources disagree.** Racial composition numbers vary between 2020 Decennial Census and ACS 5-year estimates. Note both with dates. Prefer ACS 2024 for recency.
3. **For candidate positions:** Pull directly from official campaign websites. Do NOT rely on secondhand summaries or opponent characterizations.
4. **For voter registration:** The figure 229,561 D / 164,954 R / 203,543 U is from Patch.com (April 2, 2026 article) citing NJ election records. Verify against nj.gov if possible.
5. **For debate content:** Cross-reference at least 2 news sources for any quoted position. The April 1 debate was covered by: Montclair Local, NJ Monitor, Morristown Green, Insider NJ, Jewish Insider, Patch.com.

---

## 11. Reference Repositories

| Repo | What We Use | URL |
|---|---|---|
| **Stanford Generative Agents (Smallville)** | Town visual UX (Phaser.js tiles, sprites, click-to-chat), agent cognitive architecture (observation → planning → reflection), proven 25-agent scale | `github.com/joonspk-research/generative_agents` — Paper: arXiv:2304.03442 |
| **MiroFish** | Swarm intelligence workflow (seed → persona → simulation → report → interaction), God's View variable injection, ReportAgent pattern | `github.com/666ghj/MiroFish` |
| **OASIS (CAMEL-AI)** | Scalable multi-agent simulation engine, async batch inference, time-step engine, social action spaces | `github.com/camel-ai/oasis` — Paper: arXiv:2411.11581 |
| **CAMEL Framework** | Multi-agent framework OASIS builds on. Agent communication patterns, role-playing prompts | `github.com/camel-ai/camel` |
| **Phaser.js** | 2D game framework for tile-based town rendering, sprite movement, camera | `github.com/phaserjs/phaser` |
| **Tiled Map Editor** | Create tile maps for each town, export JSON for Phaser | `github.com/mapeditor/tiled` |

---

## 12. Hackathon Timeline (12 Hours)

### Pre-Hackathon Prep (Before Event)
- [ ] Write 26 agent persona `.md` files (full demographic + personality + system prompt)
- [ ] Build 4 town tilemaps in Tiled (20×20 each, ~10 locations)
- [ ] Compile candidate knowledge base JSON (all 3 candidates, all major issues, debate quotes)
- [ ] Set up repo: FastAPI + React scaffold, file structure, TypeScript types
- [ ] Collect sprite tilesets (free assets from itch.io / OpenGameArt)
- [ ] Draft EventBus message types and agent tool schemas

### Hours 0–2: Foundation
- **Person 1:** Agent loader (parse `.md` → AgentDefinition), simulation round loop skeleton
- **Person 2:** React app + NJ-11 SVG entry map + town view container (Phaser or Canvas)
- **Person 3:** Claude API async batch wrapper with cost tracking, persona loading pipeline

### Hours 2–5: Core Simulation
- **Person 1:** Agent cognitive modules (memory stream, planning, reflection), EventBus
- **Person 2:** Chat panel UI, agent sprite rendering, speech bubbles
- **Person 3:** Tool implementations (Discuss, FormOpinion, ReactToNews), opinion tracking

### Hours 5–8: Integration + Features
- **Person 1:** Connect sim → frontend via WebSocket, round orchestration across 4 towns
- **Person 2:** District Dashboard (cross-town charts), God's View UI, agent cards
- **Person 3:** ElevenLabs voice integration, "Find Your Neighbors" feature, ReportAgent

### Hours 8–10: Pre-compute + Polish
- Run full 5-round simulation, cache results for reliable demo
- Polish animations, transitions, map aesthetics
- Ensure real-time chat-with-any-agent works smoothly
- Test God's View injection with 2–3 scenario variables

### Hours 10–12: Demo Prep
- Script the 3-minute demo (see below)
- Record backup video
- Write GitHub README
- Final bug fixes

---

## 13. Demo Script (3 Minutes)

### Opening — "The Problem" (15 sec)
*[NJ-11 map on screen, 4 town pins glowing]*

"NJ-11 is voting right now. 203,000 unaffiliated voters. One debate happened. One candidate was excluded. We built Township — 4 digital twin communities where 26 AI residents deliberate about this election the way real neighbors would."

### Act 1 — "Walk Into Dover" (40 sec)
*[Click Dover pin. Enter the 2D town. Agent sprites walking around Blackwell Street.]*

"This is Dover — 75% Hispanic, median income $70,000, half the residents born outside the US. Watch Carlos and Maria at the bodega. Carlos owns a restaurant, he's worried about ICE. Maria is a single mom terrified about losing her ACA coverage."

*[Show their generated conversation in speech bubbles]*

"Nobody scripted this. It emerged from the simulation."

### Act 2 — "Talk to a Resident" (40 sec)
*[Click Carlos. Chat panel opens. Type: "Carlos, what matters to you in this election?"]*

*[Carlos responds in character, in voice via ElevenLabs — Colombian-accented English, referencing his conversations with Maria and his memory of the ACA subsidy removal]*

"Every resident has a full memory of every conversation. Carlos references what Maria told him yesterday and why he disagreed."

### Act 3 — "Cross the District" (40 sec)
*[Click "District Dashboard." Show all 4 towns side-by-side.]*

"Now look across the district. Montclair and Dover are politically opposite — but 78% of agents in both towns rank healthcare affordability as their #1 issue. That's hidden consensus the campaign missed."

*[Point to fault line]* "The real split isn't partisan — it's whether affordability is best solved by expanding government programs or cutting taxes. Unaffiliated voters in Parsippany are genuinely torn because they agree with Mejia on healthcare AND Hathaway on property taxes."

### Act 4 — "God's View" (30 sec)
*[Type into God's View: "ICE conducts enforcement operation in Dover"]*

"Inject any variable and watch the swarm respond."

*[Dover opinion map shifts dramatically. 4 of 6 Dover agents move hard toward Mejia. But in Randolph, the effect is opposite — 2 agents move toward Hathaway on "law and order."]*

"That's predictive intelligence. No poll captures that asymmetric reaction."

### Close (15 sec)
"Township doesn't tell anyone how to vote. It simulates the conversation their democracy failed to provide. Early voting is happening right now. The election is April 16."

---

## 14. Why This Wins

| Criterion | How Township Delivers |
|---|---|
| **Claude integration depth** | 26 persistent Claude personas × 5 simulation rounds × interactive chat = hundreds of API calls where Claude IS the population intelligence |
| **Multi-agent swarm (genuine)** | Intelligence emerges from agent INTERACTION across 4 towns. No single agent has the answer. Cross-town patterns are genuinely emergent. Directly built on MiroFish/OASIS/Smallville architecture. |
| **Visual impact** | Clickable NJ-11 map → walkable 2D towns where you see AI residents living, working, arguing. The Smallville aesthetic is a proven crowd-pleaser. |
| **Real-world impact** | The election is in 10 days. Early voting is happening NOW. 203k unaffiliated voters with almost no information resources. |
| **Theme alignment** | "Machines of Loving Grace" — AI amplifying democratic participation by creating the deliberation space that broken civic infrastructure couldn't |
| **ElevenLabs** | Each of 26 agents has a contextual voice. Carlos from Dover sounds different from Mike from Randolph. Empathy layer, not gimmick. |
| **Impact Award** | Addresses democratic participation collapse in special elections. The 4-town structure captures the full diversity of a congressional district — generalizable to ANY election, ANYWHERE. |
| **Technical rigor** | Schema-validated agent tools, explicit state machines, typed event bus, discriminated union UI messages, cost-tracking, parallel town execution with aggregate statistics |
| **Innovation** | No existing tool combines: generative agent town simulation + real election data + multi-town swarm deliberation + interactive exploration + predictive variable injection + cross-community consensus discovery |

---

## File Structure

```
township/
├── agents/                          # Markdown persona definitions
│   ├── montclair/
│   │   ├── progressive-couple.md
│   │   ├── retired-educator.md
│   │   ├── young-artist.md
│   │   ├── latinx-family.md
│   │   ├── jewish-community.md
│   │   ├── shop-owner.md
│   │   └── elderly-widow.md
│   ├── parsippany/
│   │   ├── it-professional-family.md
│   │   ├── gujarati-grandparent.md
│   │   ├── white-commuter.md
│   │   ├── south-asian-couple.md
│   │   ├── restaurant-owner.md
│   │   ├── retired-executive.md
│   │   └── healthcare-worker.md
│   ├── dover/
│   │   ├── colombian-restaurant-owner.md
│   │   ├── mexican-construction-worker.md
│   │   ├── puerto-rican-single-mother.md
│   │   ├── dominican-retiree.md
│   │   ├── daca-recipient.md
│   │   └── white-longtime-resident.md
│   └── randolph/
│       ├── finance-commuter.md
│       ├── stay-at-home-mom.md
│       ├── retired-veteran.md
│       ├── young-homebuyers.md
│       ├── indian-engineer.md
│       └── local-business-owner.md
├── data/
│   ├── candidates/
│   │   ├── mejia.json               # Verified positions + quotes
│   │   ├── hathaway.json
│   │   └── bond.json
│   ├── towns/
│   │   ├── montclair.json            # Demographics, landmarks, map config
│   │   ├── parsippany.json
│   │   ├── dover.json
│   │   └── randolph.json
│   ├── election-logistics.json       # Dates, locations, deadlines
│   └── debate-excerpts.json          # Key exchanges from April 1 debate
├── maps/                             # Tiled map exports (JSON + tilesets)
│   ├── montclair.json
│   ├── parsippany.json
│   ├── dover.json
│   └── randolph.json
├── src/
│   ├── core/
│   │   ├── agent-loader.ts           # Parse .md frontmatter + body
│   │   ├── simulation-engine.ts      # Round orchestration
│   │   ├── event-bus.ts              # Typed pub/sub
│   │   ├── town-runner.ts            # Per-town parallel worker
│   │   └── token-counter.ts          # Cost tracking
│   ├── providers/
│   │   ├── types.ts                  # Unified LLM types + ModelCost
│   │   └── anthropic.ts              # Claude Sonnet async batch
│   ├── tools/
│   │   ├── base.ts                   # ZodTool abstract class
│   │   ├── discuss.ts
│   │   ├── form-opinion.ts
│   │   └── react-to-news.ts
│   ├── memory/
│   │   ├── memory-stream.ts          # Per-agent memory store
│   │   ├── reflection.ts             # Memory → higher-level insight
│   │   └── retrieval.ts              # Relevance-based memory recall
│   ├── simulation/
│   │   ├── orchestrator.ts           # 4-town parallel runner
│   │   ├── round-manager.ts          # 5-round flow with cross-town
│   │   ├── report-agent.ts           # Post-sim analysis
│   │   └── summary.ts               # Cross-town aggregation + stats
│   └── ui/
│       ├── hooks/
│       │   ├── useSimulationStream.ts # Discriminated union reducer
│       │   └── useTownState.ts
│       ├── components/
│       │   ├── DistrictMap.tsx         # NJ-11 SVG entry point
│       │   ├── TownView.tsx           # Phaser.js / Canvas wrapper
│       │   ├── AgentCard.tsx          # Per-agent status card
│       │   ├── ChatPanel.tsx          # Talk-to-agent interface
│       │   ├── DistrictDashboard.tsx  # Cross-town comparison
│       │   ├── OpinionChart.tsx       # Pie/bar visualizations
│       │   └── GodsView.tsx           # Variable injection UI
│       └── types/
│           └── messages.ts            # SimulationMessage union
├── server/
│   ├── main.py                        # FastAPI + WebSocket
│   └── routes/
│       ├── simulation.py              # Start/pause/advance sim
│       ├── chat.py                    # Real-time agent chat
│       └── report.py                  # District summary endpoint
└── README.md
```

---

*This is the definitive Township implementation plan. All demographic data sourced from Census Bureau ACS 2024/2023 5-year estimates. All candidate information sourced from official campaign websites, Ballotpedia, and cross-referenced news coverage. Last updated April 6, 2026.*