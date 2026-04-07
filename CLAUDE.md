# Township — Development Notes

## Project Overview
Civic swarm intelligence engine for NJ-11 special election (April 16, 2026).  
26 AI agents across 4 NJ towns deliberate about the election. Users explore Phaser.js-rendered towns, chat with agents, see cross-town opinion patterns, and inject variables via "God's View."

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Backend | Python + FastAPI | Native async, Pydantic validation, Azure OpenAI SDK |
| LLM | Azure OpenAI gpt-5-mini | Reasoning model with function calling; max_completion_tokens instead of max_tokens |
| Frontend | React + Vite + Phaser 3 | Tilemap + character sprites from Smallville/ai-town repos |
| Agent personas | Markdown + YAML frontmatter | Git-trackable, no-code editing, hot-reloadable |
| Memory | Simple list (not embeddings) | Sufficient for 3-5 rounds; all memories fit in prompt context |
| Simulation | Pre-compute + replay | Demo reliability; only chat and God's View are live API calls |
| State mgmt | useReducer + WebSocket | Discriminated union messages drive all frontend state |

## Stanford Generative Agents (Smallville) — Research Findings

Key details from our research of the Smallville repo:
- **Phaser version:** 3.55.2 (CDN-loaded) — we use latest Phaser 3 via npm
- **Game config:** 1500x800px, Phaser.AUTO, Arcade Physics, 0.8x zoom
- **Maps:** Tiled editor exports → JSON, 32x32px tiles, multi-layer
- **World size:** 140x100 tiles (4480x3200px) in original; ours is 1200x800px per town
- **Architecture:** Pure Phaser in Smallville — we wrap Phaser scene in React component via TownView.tsx
- **Movement:** Frame-interpolated tile-to-tile; we use Phaser tweens for smooth movement
- **Speech bubbles:** They use PNG overlays; we use Phaser Graphics + Text

**Our adaptation:** Programmatic Phaser Graphics (buildings with shadows/windows, roads with lane markings, parks with trees, churches with crosses) instead of tileset sprites. See FUTURE_WORK.md for tileset asset creation.

## Current Progress — ALL COMPLETE

### Backend (12 Python files)
- [x] `backend/core/types.py` — All Pydantic models (AgentDefinition, AgentState, Opinion, SimulationEvent union, TownSummary, DistrictSummary)
- [x] `backend/core/agent_loader.py` — Parses .md frontmatter → AgentDefinition, auto-discovers towns
- [x] `backend/core/event_bus.py` — Async pub/sub with WebSocket forwarding + event log
- [x] `backend/providers/anthropic_client.py` — AsyncAnthropic wrapper, rate limiting (Semaphore(10)), cost tracking
- [x] `backend/tools/schemas.py` — Discuss, FormOpinion, ReactToNews tool schemas + registry
- [x] `backend/simulation/round_manager.py` — THE core: 5-round simulation loop (seed → conversations → news → opinion → final)
- [x] `backend/simulation/orchestrator.py` — Multi-town parallel runner with asyncio.gather, DistrictSummary aggregation
- [x] `backend/simulation/replay.py` — Cached simulation playback via EventBus
- [x] `backend/main.py` — FastAPI app, WebSocket /ws, CORS, startup/shutdown hooks
- [x] `backend/routes/simulation.py` — POST /api/simulation/start, GET /status, /results, POST /replay
- [x] `backend/routes/chat.py` — POST /api/chat/{agent_id} with in-character response
- [x] `backend/routes/gods_view.py` — POST /api/gods-view with before/after opinion tracking

### Frontend (16 TypeScript/TSX/CSS files)
- [x] `frontend/src/types/messages.ts` — Full discriminated union types, TOWN_META, CANDIDATE_COLORS
- [x] `frontend/src/hooks/useWebSocket.ts` — WS connection, auto-reconnect, useReducer state management
- [x] `frontend/src/hooks/useSimulation.ts` — REST API hooks for simulation control
- [x] `frontend/src/game/config.ts` — Phaser config, TOWN_LANDMARKS for all 4 towns
- [x] `frontend/src/game/TownScene.ts` — Phaser scene with programmatic town drawing (buildings, roads, parks, trees, churches)
- [x] `frontend/src/game/AgentSprite.ts` — Agent circles with initials, idle animation, speech bubbles, movement tweens
- [x] `frontend/src/App.tsx` — React Router (/, /town/:id, /dashboard, /gods-view)
- [x] `frontend/src/components/DistrictMap.tsx` — Beautiful SVG NJ-11 map with animated pins, hover cards, election banner
- [x] `frontend/src/components/TownView.tsx` — Phaser wrapper + agent sidebar + chat integration
- [x] `frontend/src/components/ChatPanel.tsx` — Slide-in agent chat panel with typing indicator
- [x] `frontend/src/components/Dashboard.tsx` — 4-column cross-town comparison with charts and consensus/fault lines
- [x] `frontend/src/components/AgentCard.tsx` — Compact agent status card with opinion indicator
- [x] `frontend/src/components/OpinionChart.tsx` — SVG donut chart with animated transitions
- [x] `frontend/src/components/GodsView.tsx` — Variable injection with preset scenarios and before/after comparison
- [x] `frontend/src/styles/index.css` — Tailwind + custom Township design system (CSS variables, animations)
- [x] `frontend/src/main.tsx` — React entry point

### Agent Personas (26 markdown files)
- [x] Dover: 6 agents (2D / 0R / 4U)
- [x] Montclair: 7 agents (4D / 1R / 2U)
- [x] Parsippany: 7 agents (2D / 2R / 3U)
- [x] Randolph: 6 agents (1D / 3R / 2U)

### Data Files (9 JSON files)
- [x] 3 candidate profiles (Mejia, Hathaway, Bond)
- [x] 4 town profiles (demographics, landmarks, coordinates)
- [x] 1 debate excerpts (8 exchanges from April 1 debate)
- [x] 1 election logistics

### Documentation
- [x] CLAUDE.md (this file)
- [x] FUTURE_WORK.md (team collaboration items)
- [x] README.md (full spec)

## Verified Working

- **Frontend TypeScript:** `npx tsc --noEmit` passes clean (0 errors)
- **Frontend build:** `npx vite build` succeeds (2.29s, 1.49MB bundle including Phaser)
- **Backend imports:** All modules import correctly
- **Agent loader:** All 26 agents load from .md files with correct political distributions
- **Orchestrator:** Initializes with all 4 towns, 3 candidates, 8 debate excerpts

## How to Run

```bash
# Backend
cd /Users/chuyuewang/Desktop/anthropichackathon-njtownship
pip install -r backend/requirements.txt
pip install openai
AZURE_OPENAI_API_KEY=<your-key> \
AZURE_OPENAI_ENDPOINT=https://franklink-openai.openai.azure.com/ \
AZURE_OPENAI_API_VERSION=2025-01-01-preview \
AZURE_OPENAI_DEPLOYMENT_NAME=gpt-5-mini \
python -m uvicorn backend.main:app --reload --port 8001

# Frontend (vite.config.ts proxies /api and /ws to port 8001)
cd frontend
npm install
npm run dev  # Vite dev server on port 5173
```

## File Structure

```
township/
├── CLAUDE.md                        # This file — dev notes
├── README.md                        # Full spec document (46KB)
├── FUTURE_WORK.md                   # Team collaboration items
├── backend/
│   ├── requirements.txt             # Python deps
│   ├── main.py                      # FastAPI entry + WebSocket
│   ├── core/
│   │   ├── types.py                 # Pydantic models (170 lines)
│   │   ├── agent_loader.py          # .md → AgentDefinition
│   │   └── event_bus.py             # Async pub/sub
│   ├── providers/
│   │   └── anthropic_client.py      # Claude API + cost tracking
│   ├── simulation/
│   │   ├── orchestrator.py          # Multi-town parallel runner
│   │   ├── round_manager.py         # THE core simulation loop (673 lines)
│   │   └── replay.py               # Cached playback
│   ├── routes/
│   │   ├── simulation.py            # Start/status/results
│   │   ├── chat.py                  # Agent chat
│   │   └── gods_view.py             # Variable injection
│   └── tools/
│       └── schemas.py               # Discuss, FormOpinion, ReactToNews
├── frontend/
│   ├── package.json                 # React, Phaser, Tailwind
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── src/
│       ├── App.tsx                   # Router
│       ├── main.tsx                  # Entry
│       ├── game/
│       │   ├── TownScene.ts          # Phaser scene (300 lines)
│       │   ├── AgentSprite.ts        # Agent character class
│       │   └── config.ts             # Landmarks for all 4 towns
│       ├── components/
│       │   ├── DistrictMap.tsx        # SVG map entry (259 lines)
│       │   ├── TownView.tsx          # Phaser wrapper
│       │   ├── ChatPanel.tsx         # Agent chat panel
│       │   ├── Dashboard.tsx         # Cross-town dashboard
│       │   ├── AgentCard.tsx         # Agent status card
│       │   ├── OpinionChart.tsx      # Donut charts
│       │   └── GodsView.tsx          # Variable injection
│       ├── hooks/
│       │   ├── useWebSocket.ts       # WS + useReducer
│       │   └── useSimulation.ts      # REST API hooks
│       ├── types/
│       │   └── messages.ts           # Discriminated union types (252 lines)
│       └── styles/
│           └── index.css             # Tailwind + Township design system
├── agents/
│   ├── dover/       (6 agents) ✓
│   ├── montclair/   (7 agents) ✓
│   ├── parsippany/  (7 agents) ✓
│   └── randolph/    (6 agents) ✓
└── data/
    ├── candidates/  (3 files) ✓
    ├── towns/       (4 files) ✓
    ├── debate-excerpts.json ✓
    └── election-logistics.json ✓
```

## Agent Distribution (Verified)

| Town | Agents | Political Mix | Status |
|------|--------|---------------|--------|
| Dover | 6 | 2D / 0R / 4U | Done |
| Montclair | 7 | 4D / 1R / 2U | Done |
| Parsippany | 7 | 2D / 2R / 3U | Done |
| Randolph | 6 | 1D / 3R / 2U | Done |
| **Total** | **26** | **9D / 6R / 11U** | **Matches spec** |

## API Cost Estimates

| Activity | Est. Cost |
|----------|-----------|
| Dev testing (Dover, 3 rounds) | ~$0.50 |
| Full sim (26 agents, 5 rounds) | ~$3.50 |
| Demo chat (~20 exchanges) | ~$0.50 |
| God's View (3 injections) | ~$1.00 |
| Buffer | ~$2.00 |
| **Total** | **~$7.50** |

## Azure OpenAI Migration

Switched from Anthropic Claude to Azure OpenAI (gpt-5-mini) on April 6, 2026:
- **Client:** `backend/providers/anthropic_client.py` — rewrote to use `openai.AsyncAzureOpenAI`
- **Class name:** Kept as `AnthropicClient` for backward compatibility (all import sites unchanged)
- **Tool format:** Auto-converts Anthropic `input_schema` → OpenAI `function.parameters`
- **Model mapping:** `claude-sonnet-4-6` → `gpt-5-mini` via MODEL_MAP dict
- **Key difference:** gpt-5-mini uses `max_completion_tokens` (not `max_tokens`) and consumes reasoning tokens internally
- **Token budget:** Increased all max_tokens to 1200-1600 to account for reasoning tokens (~256 per call)
- **Env vars:** `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_VERSION`, `AZURE_OPENAI_DEPLOYMENT_NAME`

## Game Assets Integration

Downloaded 50+ assets from Stanford Generative Agents + a16z ai-town repos:
- **Tilemap:** ai-town's `rpg-tileset.png` (100x100 grid, 16px tiles) + `tilemap.json` (40x40 map)
- **Characters:** 25 Smallville character PNGs (32x32 spritesheets) mapped to 26 Township agents
- **Speech bubbles:** Smallville v1/v2/v3.png + ai-town bubble SVGs
- **Animated sprites:** campfire, sparkle, waterfall, windmill (32x32 animated)
- **UI:** ai-town SVG elements (box, frame, buttons, chat bubbles)
- **Agent→Sprite mapping** in TownScene.ts: Carlos→Carlos_Gomez, Maria→Maria_Lopez, Raj→Rajiv_Patel, etc.

## Mistakes / Lessons
- `python-frontmatter` package imports as `frontmatter`, not `python_frontmatter`
- Need to install deps with `python3 -m pip` to match the correct Python binary
- Phaser.js adds ~1.4MB to bundle — acceptable for a game engine, but chunk splitting recommended for production
- gpt-5-mini returns empty `content` if `max_completion_tokens` too low — reasoning tokens consume the budget
- Port 8000 was already in use — switched to 8001 for backend

## Key Data Points
- **Voter registration:** 229,561 D / 164,954 R / 203,543 U
- **Cook PVI:** D+5
- **Election Day:** Thursday, April 16, 2026
- **Early voting:** April 6-14 (happening NOW)
- **Only one debate occurred** (April 1, virtual, Bond excluded)
- **Dover:** 75% Hispanic, 51.5% foreign-born, $70,519 median income
- **Montclair:** $151,075 median income, progressive hub
- **Parsippany:** 35-38% Asian, largest town (56,397)
- **Randolph:** $175,000 median income, Hathaway's home base
