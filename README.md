# Township

**A civic swarm intelligence engine for NJ-11's 2026 special election.**

Built for the CBC × Wharton AI × Anthropic hackathon — "Machines of Loving Grace" track: Democratic Governance & Collaboration.

---

## What It Is

Township is a living digital twin of NJ-11's electorate. Four New Jersey towns — Dover, Montclair, Parsippany, and Randolph — are each populated by AI residents who deliberate about a real congressional election happening April 16, 2026. Users walk through Phaser-rendered towns, talk directly to residents, watch opinions shift in real time, and inject variables via a "God's View" panel to see how events reshape the district.

The core insight is that swarm intelligence — emergent collective behavior from many independent agents reasoning and talking to each other — can simulate the democratic deliberation process that this election's broken information infrastructure failed to provide. NJ-11 had one debate (April 1, virtual), one candidate excluded entirely, and a Thursday election with 203,543 unaffiliated voters who have almost nowhere to turn for reasoned perspective. Township creates that space.

---

## The Election

**Race:** Special election for NJ's 11th Congressional District (U.S. House)  
**Reason:** Mikie Sherrill (D) vacated after winning the 2025 NJ gubernatorial race  
**Election Day:** Thursday, April 16, 2026  
**Early voting:** April 6–14, 2026 — *happening now*

**Voter registration:** 229,561 D / 164,954 R / 203,543 Unaffiliated  
**Cook PVI:** D+5

### Candidates

| | Analilia Mejia (D) | Joe Hathaway (R) | Alan Bond (Ind.) |
|---|---|---|---|
| Background | Co-exec dir, Center for Popular Democracy. Daughter of Colombian/Dominican immigrants. Won upset primary over Tom Malinowski. | Randolph councilman/former mayor. Yale '09. Former Christie aide. | Dartmouth/Harvard MBA. Former Wall Street fund manager. Served 6 years federal prison (fraud). |
| Key positions | Medicare for All, $25 min wage, abolish ICE, free public college, PRO Act, condition Israel aid | Lower taxes, tax freeze for first-time homebuyers, unconditional Israel support, One Big Beautiful Bill, Gateway Tunnel | Affordability, education, healthcare, community safety |
| Endorsements | Sanders, Warren, AOC, Jayapal, Ro Khanna | — | — |

---

## The Four Towns

| Town | Pop. | Median Income | Character | Agents |
|---|---|---|---|---|
| **Dover** | 18,435 | $70,519 | 75% Hispanic, 51.5% foreign-born, working-class heart | 6 (2D / 0R / 4U) |
| **Montclair** | 40,341 | $151,075 | Progressive hub, arts/culture, racially diverse | 7 (4D / 1R / 2U) |
| **Parsippany** | 56,397 | $112,327 | 35–38% Asian (primarily South Asian), swing-voter suburban | 7 (2D / 2R / 3U) |
| **Randolph** | 26,604 | $175,000 | Hathaway's home base, affluent, lean Republican | 6 (1D / 3R / 2U) |
| **District total** | | | | **26 (9D / 6R / 11U)** |

These four towns span the district's full spectrum: income ($70k–$175k), race (14% to 75% Hispanic), immigrant share (9% to 51% foreign-born), and political lean (deep blue to lean red).

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                   FRONTEND (React + Vite)                 │
│                                                           │
│   NJ-11 SVG Map → Town View (Phaser 3) → Chat Panel      │
│                   District Dashboard → God's View         │
└───────────────────────┬──────────────────────────────────┘
                        │ WebSocket (discriminated union msgs)
┌───────────────────────┴──────────────────────────────────┐
│                  BACKEND (Python / FastAPI)                │
│                                                           │
│   Simulation Orchestrator (asyncio.gather, 4 towns)       │
│   ├── RoundManager  (5-round deliberation loop)           │
│   ├── EventBus      (async pub/sub + WS forwarding)       │
│   ├── AgentLoader   (.md frontmatter → AgentDefinition)   │
│   └── AzureOpenAI   (gpt-5-mini, rate limiting, costs)    │
│                                                           │
│   Routes: /api/simulation/* · /api/chat/{id} · /api/gods-view
└──────────────────────────────────────────────────────────┘
```

**Key design decisions:**

| Decision | Choice | Why |
|---|---|---|
| Backend | Python + FastAPI | Native async, Pydantic validation |
| LLM | Azure OpenAI gpt-5-mini | Reasoning model with function calling; `max_completion_tokens` not `max_tokens` |
| Frontend | React + Vite + Phaser 3 | Tilemap + animated character sprites |
| Agent personas | Markdown + YAML frontmatter | Git-trackable, no-code editing, hot-reloadable |
| Memory | Simple chronological list | All memories fit in prompt context for 3–5 rounds |
| Simulation | Pre-compute + replay | Demo reliability; chat and God's View are live API calls |
| State | useReducer + WebSocket | Discriminated union messages drive all frontend state |

---

## Simulation Engine

Five rounds of deliberation per run:

```
Round 0 — Seed injection
  All agents receive candidate positions, debate excerpts, election logistics.
  Each processes through personal lens → initial FormOpinion.

Round 1 — Local conversations
  Agents move to landmarks in their town. 2–3 Discuss tool calls per agent.
  Memories update after each conversation.

Round 2 — News reaction
  EventBus publishes debate clips, endorsement news, cost-of-living data.
  ReactToNews tool. Reflections trigger for agents with high memory importance.

Round 3 — Cross-town gossip
  Select agents "hear from a contact in another town."
  Dover's Carlos hears from Parsippany's Raj about healthcare costs.
  Montclair's Sarah hears from Randolph's Mike about tax burden.

Round 4 — Deepening
  More local conversations, now cross-informed. Undecided agents begin
  crystallizing — or staying authentically conflicted.

Round 5 — Election eve
  Final FormOpinion from all 26 agents.
  Some remain undecided. ReportAgent generates district-wide analysis.
```

All four towns run in parallel via `asyncio.gather`. A shared EventBus carries cross-town events in Round 3.

---

## Agent System

### Persona format

Each of the 26 agents is a Markdown file with YAML frontmatter that becomes the system prompt. No code changes needed to add or edit agents.

```yaml
---
name: Carlos Restrepo
town: dover
occupation: Owner, La Finca Restaurant
age: 51
political_registration: unaffiliated
initial_lean: undecided
top_concerns:
  - healthcare costs (ACA marketplace, no employer plan)
  - immigration enforcement (employees, community fear)
  - property taxes on commercial lease
  - son's college affordability
tools: [Discuss, FormOpinion, ReactToNews]
---

You are Carlos Restrepo, age 51. You own La Finca, a Colombian restaurant on
Blackwell Street in Dover, NJ...
```

### Agent tools (schema-validated)

- **Discuss** — conversation with another agent at a location; captures stance, dialogue, key takeaway
- **FormOpinion** — crystallize election stance: candidate, confidence 0–100, reasoning, top issues, dealbreaker
- **ReactToNews** — process a news event: emotional response, impact on vote, reasoning

### Cognitive architecture

Adapted from Park et al. (2023) "Generative Agents" ([arXiv:2304.03442](https://arxiv.org/abs/2304.03442)):

- **Memory stream** — chronological list of observations, conversations, reflections; pre-seeded from persona
- **Reflection** — triggered when accumulated memory importance exceeds threshold; synthesizes patterns into higher-level insight
- **Planning** — each round, agent decides where to go, who to talk to, what to raise

---

## Frontend

### NJ-11 District Map (`DistrictMap.tsx`)
SVG map of the four towns with animated pins, hover cards showing demographics, election banner, and click-through to each town.

### Town View (`TownView.tsx` + `TownScene.ts`)
Phaser 3 game scene wrapping a real ai-town tilemap (rpg-tileset, 40×40 tiles). Per-town landmarks are overlaid as named zones. Agent sidebar shows all residents with live opinion indicators.

### Animated agent characters (`AgentSprite.ts` + `TownScene.ts`)

Each of the 26 agents is rendered as a Smallville-format character spritesheet (96×128 px, 3 cols × 4 rows = 12 frames):

| Row | Frames | Animation |
|---|---|---|
| 0 | 0–2 | Walk down |
| 1 | 3–5 | Walk left |
| 2 | 6–8 | Walk right |
| 3 | 9–11 | Walk up |

**Movement:** Agents wander autonomously between town landmarks and waypoints (4–13 second idle intervals, staggered so they don't all leave at once). `moveToPosition()` computes dx/dy to select the correct directional walk animation, then uses a Phaser tween with `Sine.easeInOut` easing. Duration scales with distance (3.8 ms/px, clamped 600–2800 ms).

**Idle:** Gentle 2.5px Y-bob tween + ground shadow pulse. Phase-randomized per agent so each feels independent. Slow 1.6 fps "breathe" idle cycle on spritesheet.

**Ground shadow:** Ellipse squishes 1.45× wider while walking, restores on arrival.

**Y-depth sorting:** `syncDepth()` called every frame — agents further down the screen render in front, creating isometric-style layering.

**Speech bubbles:** Drop shadow, white rounded body, styled border, downward tail pointer. Pop-in with `Back.easeOut` scale + alpha, fade-out with `Quad.easeIn`. Show on simulation events and randomly during wandering (idle election thoughts, 28% chance on arrival).

**Opinion rings:** Three-layer concentric rings (halo / mid / crisp) color-coded by candidate lean. Ripple burst on opinion change.

**Ambient life:** 4 background NPC passers-by (0.65 alpha) wander independently. Birds fly across the sky with wing-flap scale tweens.

### Chat Panel (`ChatPanel.tsx`)
Slide-in panel for live in-character conversation with any agent. Typed via `/api/chat/{agent_id}` — full persona + memory context passed to the LLM.

### District Dashboard (`Dashboard.tsx`)
4-column cross-town opinion comparison with SVG donut charts, consensus patterns, and fault lines.

### God's View (`GodsView.tsx`)
Inject variables (news events, policy announcements, hypothetical scenarios) and see before/after opinion shifts across all 26 agents.

---

## Running Locally

**Backend**

```bash
cd township
pip install -r backend/requirements.txt

AZURE_OPENAI_API_KEY=<your-key> \
AZURE_OPENAI_ENDPOINT=https://<your-endpoint>.openai.azure.com/ \
AZURE_OPENAI_API_VERSION=2025-01-01-preview \
AZURE_OPENAI_DEPLOYMENT_NAME=gpt-5-mini \
python -m uvicorn backend.main:app --reload --port 8001
```

**Frontend**

```bash
cd frontend
npm install
npm run dev   # Vite dev server on :5173, proxies /api and /ws to :8001
```

---

## File Structure

```
township/
├── backend/
│   ├── main.py                     # FastAPI app, WebSocket /ws
│   ├── core/
│   │   ├── types.py                # Pydantic models (AgentDefinition, Opinion, events)
│   │   ├── agent_loader.py         # .md frontmatter → AgentDefinition
│   │   └── event_bus.py            # Async pub/sub + WebSocket forwarding
│   ├── providers/
│   │   └── anthropic_client.py     # Azure OpenAI wrapper (named for backward compat)
│   ├── simulation/
│   │   ├── orchestrator.py         # Multi-town parallel runner, DistrictSummary
│   │   ├── round_manager.py        # 5-round simulation loop (673 lines)
│   │   └── replay.py               # Cached simulation playback
│   ├── routes/
│   │   ├── simulation.py           # POST /start, GET /status, /results, POST /replay
│   │   ├── chat.py                 # POST /api/chat/{agent_id}
│   │   └── gods_view.py            # POST /api/gods-view
│   └── tools/
│       └── schemas.py              # Discuss, FormOpinion, ReactToNews schemas
├── frontend/
│   └── src/
│       ├── game/
│       │   ├── TownScene.ts        # Phaser scene: tilemap, landmarks, autonomous NPCs, birds
│       │   ├── AgentSprite.ts      # Character class: 4-dir walk anims, speech bubbles, depth
│       │   └── config.ts           # Landmark coordinates, town accents, voice mapping
│       ├── components/
│       │   ├── DistrictMap.tsx     # SVG NJ-11 entry map
│       │   ├── TownView.tsx        # Phaser wrapper + agent sidebar
│       │   ├── ChatPanel.tsx       # In-character agent chat
│       │   ├── Dashboard.tsx       # Cross-town opinion dashboard
│       │   ├── OpinionChart.tsx    # SVG donut charts
│       │   └── GodsView.tsx        # Variable injection panel
│       ├── hooks/
│       │   ├── useWebSocket.ts     # WS connection, auto-reconnect, useReducer state
│       │   └── useSimulation.ts    # REST API hooks
│       └── types/
│           └── messages.ts         # Discriminated union message types
├── agents/
│   ├── dover/       (6 agents)
│   ├── montclair/   (7 agents)
│   ├── parsippany/  (7 agents)
│   └── randolph/    (6 agents)
└── data/
    ├── candidates/  (mejia, hathaway, bond)
    ├── towns/       (demographics, landmarks)
    ├── debate-excerpts.json
    └── election-logistics.json
```

---

## Inspiration

**[Stanford Generative Agents (Smallville)](https://github.com/joonspk-research/generative_agents)**  
Park et al., "Generative Agents: Interactive Simulacra of Human Behavior" (arXiv:2304.03442). The cognitive architecture — memory stream, reflection, planning — is directly adapted from this work. Character spritesheets (32×32, 4-directional walk cycles) are sourced from the Smallville asset library. The simulation structure (agent plans, conversations, daily rounds) follows the Smallville pattern.

**[a16z ai-town](https://github.com/a16z-infra/ai-town)**  
Open-source TypeScript agent simulation framework. We use the `rpg-tileset.png` + `tilemap.json` tile assets directly. The React-wrapping-Phaser approach in `TownView.tsx` follows ai-town's frontend pattern. The ambient NPC wandering system and speech bubble design are also informed by ai-town's implementation.

**Key divergences from both:**  
Township runs server-side Python simulation (not client-side JS), uses Azure OpenAI instead of Claude/GPT-4, is grounded in a real election with verified demographic data, and is designed for public demo reliability via pre-compute + replay rather than purely live inference.

---

## Cost Estimates

| Activity | Est. Cost |
|---|---|
| Dev testing (Dover, 3 rounds) | ~$0.50 |
| Full simulation (26 agents, 5 rounds) | ~$3.50 |
| Demo chat (~20 exchanges) | ~$0.50 |
| God's View (3 injections) | ~$1.00 |
| **Total demo budget** | **~$7.50** |

*gpt-5-mini uses `max_completion_tokens` (not `max_tokens`) and consumes reasoning tokens internally. All token budgets set to 1200–1600 to account for ~256 reasoning tokens per call.*
