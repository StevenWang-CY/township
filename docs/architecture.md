# Architecture

Township is a pipeline with one direction of truth: a **scenario package** (data) drives a **simulation engine** (Python), which emits a **typed event stream** that a **React + Phaser frontend** renders. Nothing about any particular election lives in code — swap the scenario directory and the same engine deliberates a town budget instead of a congressional race. Everything below is grounded in the actual modules; file paths are given so you can read the source next to this page.

```mermaid
flowchart TB
    subgraph pkg["scenarios/&lt;id&gt;/ — the scenario package"]
        SJ["scenario.json<br/>towns/ · options/ · agents/ · context/"]
    end

    SJ -->|"load_scenario()<br/>backend/core/scenario.py"| ORCH

    subgraph backend["Backend — FastAPI (backend/main.py)"]
        ORCH["SimulationOrchestrator<br/>backend/simulation/orchestrator.py<br/>(all towns in parallel)"]
        RM["RoundManager per town<br/>backend/simulation/round_manager.py<br/>seed → converse → news → opinion → decide"]
        TOOLS["Tool-calling agents<br/>Discuss · FormOpinion · ReactToNews<br/>backend/tools/schemas.py"]
        PROV["Provider layer — backend/providers/<br/>bedrock | anthropic | openai-compat | mock"]
        EV["Typed SimulationEvent union<br/>backend/core/types.py"]
        BUS["EventBus<br/>backend/core/event_bus.py"]
        RUNS[("Event logs<br/>data/simulation_cache.json<br/>runs/&lt;run_id&gt;/ · scenarios/&lt;id&gt;/demo/")]
        REPLAY["replay()<br/>backend/simulation/replay.py"]
    end

    ORCH --> RM
    RM --> TOOLS
    TOOLS <--> PROV
    RM --> EV
    ORCH --> EV
    EV --> BUS
    BUS --> RUNS
    RUNS --> REPLAY
    REPLAY --> BUS

    BUS -->|"WebSocket /ws<br/>JSON, one event per message"| RED

    subgraph frontend["Frontend — React + Vite"]
        RED["useWebSocket reducer<br/>frontend/src/hooks/useWebSocket.ts"]
        PHASER["Phaser town<br/>frontend/src/game/TownScene.ts"]
        DASH["Dashboards · chat · God's View<br/>frontend/src/components/"]
    end

    RED --> PHASER
    RED --> DASH
```

Two things to notice. First, the frontend has **no privileged channel** into the simulation — it sees exactly what the event log sees, which is why a replayed run is indistinguishable from a live one. Second, the arrows into `EventBus` are the *only* way simulation state becomes visible; every module that wants to show something publishes an event.

## Component tour

**Scenario loader — `backend/core/scenario.py`.** Validates `scenario.json` against the Pydantic `ScenarioConfig`, loads towns, per-option rich data, `context/` extras, and the persona roster, and cross-checks everything (contiguous round plan, known news ids, every persona's `initial_lean` on the stance roster). The runtime `Scenario` object is the single source of truth the rest of the engine queries — stance ids, colors, labels, prompt context blocks, and `build_full_context()`, the seed-round briefing. `validate_stance()` coerces any model-produced stance string onto the roster so one hallucinated candidate can never corrupt a summary or the wire. The full package spec is in [scenario-format.md](scenario-format.md).

**Orchestrator — `backend/simulation/orchestrator.py`.** `SimulationOrchestrator` owns runtime state: one `AgentState` list per town, built from the scenario's persona definitions. `run_full_simulation()` announces the roster (`simulation_started`), runs every town in parallel via `asyncio.gather` (one `RoundManager` each), and drives the district-wide atmosphere from a background task — the scenario's `weather_schedule` plus cross-town gossip at its `gossip_rounds`. When the towns finish it aggregates a `DistrictSummary` (prediction percentages, consensus zones, fault lines, total cost), emits `simulation_ended`, writes the replay cache, and persists the run (see [Runs, recap, replay](#runs-recap-and-replay)). It also implements God's View: inject a development into every agent, collect `ReactToNews` responses, and re-run `FormOpinion` for anyone actually moved.

**RoundManager — `backend/simulation/round_manager.py`.** The core loop, one instance per town. It walks the scenario's `round_plan` and dispatches each declared phase in order: `seed` (full briefing → initial opinion), `converse` (random in-town pairs, 3-exchange conversations at a random landmark), `news` (inject beats, collect reactions), `opinion` (reflect on the 10 most recent memories, re-form opinion), `decide` (mark agents decided — no LLM call). Every phase both mutates agent state (memories, opinions) and publishes events. A provider error marks the agent `ERROR` rather than minting a confident fake opinion.

**Tool schemas — `backend/tools/schemas.py`.** Agents never free-associate their decisions; they call typed tools. `build_tools(scenario)` produces the per-scenario registry: `Discuss` (response, sentiment, key takeaway, gesture), `FormOpinion` (whose `candidate` enum *is* the scenario's stance roster), `ReactToNews` (emotional response, impact on stance), and the scenario-independent `ClassifyInteraction` used by player chat to adjust trust.

**Provider layer — `backend/providers/`.** `base.py` defines the narrow `LLMProvider` protocol every backend satisfies: `call_agent(system_prompt, messages, tools, max_tokens, model) -> {text, tool_use, tokens, cost, stop_reason}`, plus usage reporting. `factory.py` selects the implementation: explicit `LLM_PROVIDER` wins; otherwise auto-detect from whichever credential is present (`ANTHROPIC_API_KEY` → anthropic, `AWS_BEARER_TOKEN_BEDROCK` → bedrock, `OPENAI_API_KEY` → openai, `OPENROUTER_API_KEY` → openrouter); with zero credentials it falls back — loudly — to the deterministic mock, so a fresh clone runs the whole pipeline offline. Errors come back as a `stop_reason: "error"` dict, never an exception, so one flaky call degrades one agent instead of a run.

**EventBus — `backend/core/event_bus.py`.** A small async pub/sub hub. `publish()` appends to a capped in-memory log (5,000 events — the replay/persistence source), notifies typed and wildcard subscribers, and forwards the JSON-serialized event to every registered WebSocket. Dead sockets are pruned on send failure. The `/ws` endpoint in `backend/main.py` is just `register_ws` + a ping/pong keepalive loop.

**Wire DTOs — `backend/core/wire.py`.** Converters from internal Pydantic models to the exact dict shapes the frontend's TypeScript interfaces expect (`agent_state_to_wire`, `town_summary_to_wire`, `district_summary_to_wire`, ...). This is the single place the wire shape is defined on the backend; if the frontend interface changes, these converters change — not the internal types.

**Routes — `backend/routes/`.** `scenario.py` (the bootstrap payload: question, options, towns, colors), `simulation.py` (start/status/results/agents, replay, latest recap), `runs.py` (list/inspect/export persisted runs), `towns.py` (town JSON served verbatim so backend and Phaser never disagree about coordinates), `chat.py` (live in-character player chat with trust tracking), `gods_view.py` (injections + curated presets), `journal.py`, `transcribe.py`, `tts.py`. `backend/main.py` wires them up, owns the singletons (`EventBus`, provider, `Scenario`, orchestrator) on `app.state`, and serves the built frontend at `/` when `frontend/dist` exists.

**CLI — `backend/cli.py`.** The `township` command (installed by `make install` via `pyproject.toml`): `serve` (uvicorn with `SCENARIO`/`LLM_PROVIDER` set for you), `run` (headless simulation with per-round progress, prediction, recap, and the run directory printed), `replay` (a persisted run or a scenario's demo cache, rendered to the terminal), `scenarios` (list and health-check every package), and the `new-scenario` / `new-agent` scaffolds.

**Frontend.** `frontend/src/hooks/useWebSocket.ts` opens `/ws` (auto-reconnect, 3 s backoff) and folds every event into one `useReducer` store: agent map, conversations, town summaries, world clock, weather, relationships, and a rolling 500-event buffer. `frontend/src/context/ScenarioContext.tsx` fetches `GET /api/scenario` once and provides option colors/labels and `decision_kind`-aware wording to every component. `frontend/src/game/TownScene.ts` renders the town — landmarks from `GET /api/towns`, agent sprites that tween to `agent_moved` coordinates, speech bubbles, opinion rings that ripple on `opinion_changed`. React components (`TownView`, `Dashboard`, `GodsView`, `ChatPanel`) render the same store as charts and panels.

## The wire contract

Every event is a Pydantic model in `backend/core/types.py` with a `Literal` `type` field, unioned as `SimulationEvent`. The frontend mirrors the union in `frontend/src/types/messages.ts` and consumes it in the `useWebSocket` reducer. All events flow backend → frontend over `/ws`, one JSON object per message.

| Event `type` | Published by | One line |
|---|---|---|
| `simulation_started` | orchestrator | A run begins — carries the full agent roster (wire `AgentState` dicts) and town list; the reducer rebuilds its agent map from it |
| `round_started` | RoundManager | A town enters round *N* of *M* |
| `world_clock_tick` | RoundManager | The round's in-game `clock` (`HH:MM`) — cosmetic day/night on the frontend |
| `agent_moved` | RoundManager | An agent walks to a landmark; `x`/`y` drive the Phaser tween |
| `conversation_started` | RoundManager | A 3-exchange conversation opens — carries the wire `Conversation` (participants, location, topic) |
| `agent_speech` | RoundManager | One utterance (truncated to 150 chars) with sentiment and an optional gesture — becomes a speech bubble |
| `conversation_ended` | RoundManager | Closes a conversation with the joined key-takeaway summary |
| `news_injected` | RoundManager | A scenario news beat lands (headline + description) |
| `news_reaction` | RoundManager | One agent's structured reaction (emotion, impact on stance, reasoning) — feeds the dashboard/news ticker |
| `opinion_changed` | RoundManager, orchestrator | Old vs. new `Opinion` — drives opinion rings, ripples, and every chart |
| `cross_town_gossip` | RoundManager | A takeaway crossing towns (emitted in both directions) — the gossip toast in the receiving town |
| `round_ended` | RoundManager | Round complete — carries wire `TownSummary` dicts for the HUD/timeline |
| `weather_changed` | orchestrator | District-wide weather from the scenario's `weather_schedule` (`clear`/`cloudy`/`rain`/`snow`/`fog`) |
| `god_view_injection` | orchestrator | A God's View development was announced to all agents |
| `gods_view_result` | `routes/gods_view.py` | The batch of wire-format reactions after an injection |
| `relationship_update` | `routes/chat.py` | Player↔agent trust changed after a chat exchange (trust, delta, classification) |
| `simulation_ended` | orchestrator | The run is over — carries the wire `DistrictSummary` |

**The guard: `tests/test_wire_contract.py`.** Renaming an event field "just on the backend" is the classic way this architecture rots, so the contract is tested from both sides: every backend `type` literal (extracted from the `SimulationEvent` union at runtime) must be declared in `messages.ts`; every user-visible event must have an explicit `case` in the `useWebSocket` reducer (not just the catch-all); and the legacy pre-rename event names (`agent_move`, `speech_bubble`, ...) must never reappear. It runs in `make test` with no API keys. The rule it enforces: **change both sides together, then run the test** — never one side casually.

`backend/simulation/replay.py` keeps a third copy of the type list (`EVENT_TYPE_MAP`, string → model class) so persisted event dicts can be deserialized back into typed events; a new event type isn't replayable until it's added there too.

## Prompt assembly

Every simulation call to an agent uses the same system prompt, composed fresh each time by `RoundManager._build_agent_system_prompt`:

1. **Persona body** — the markdown below the frontmatter in `agents/<town>/<slug>.md`, verbatim. This is the bulk of the prompt and the part that stays identical across calls (which is what makes caching pay — see below).
2. **`--- CONTEXT ---`** — the scenario's `context_md` framing block.
3. **`--- YOUR RECENT EXPERIENCES ---`** — the agent's 10 most recent memories: one-line records of conversations, news reactions, and opinion updates written by earlier phases.
4. **`--- YOUR CURRENT STANCE ---`** — the latest `Opinion` (stance, confidence, reasoning, top issues, dealbreaker), when one exists.
5. **`--- YOUR GOAL THIS ROUND ---`** — the persona's `goals["round_<n>"]` entry, when the frontmatter declares one.
6. **`--- INSTRUCTIONS ---`** — a fixed stay-in-character block ("You can change your mind if you hear compelling arguments. Be authentic — if you're confused or torn, say so.").

The user message supplies the phase-specific task — the seed round additionally packs `Scenario.build_full_context()` (every option's positions, endorsements, debate excerpts, logistics) into it. Chat and God's View use a shorter variant (`orchestrator._build_god_view_prompt`) built on `context_short_md` and 5 memories.

## Cost and caching

**Prompt caching on the system block.** The shared Anthropic-family implementation (`backend/providers/base.py::_AnthropicFamilyProvider`, used by both the Bedrock and Anthropic API providers) wraps the system prompt as a content block with `cache_control: {type: "ephemeral"}`. Since the persona body dominates the prompt and repeats across an agent's many calls per round, most input tokens land as cache reads at a tenth of the fresh-input price. Disable per provider (`BEDROCK_CACHE_SYSTEM=0` / `ANTHROPIC_CACHE_SYSTEM=0`) if the tradeoff doesn't fit your call pattern.

**UsageTracker.** Every provider funnels token counts (input, output, cache reads, cache writes) and per-call cost into a shared `UsageTracker` (`backend/providers/base.py`). Costs come from the `MODEL_COSTS` catalog (with `COST_ALIASES` mapping Bedrock inference-profile ids and dated API ids onto canonical keys); unknown models — local Ollama, LM Studio — cost 0.0. The report surfaces everywhere you'd look for it: `GET /api/health`, `GET /api/simulation/status`, the `total_cost` field on the `DistrictSummary`, the `usage` block of every persisted run's `summary.json`, and the cost line `township run` prints at the end.

## Runs, recap, and replay

Pre-compute + replay is a first-class path, not a demo hack. Three artifacts share the same `{"events": [...]}` shape:

- **`data/simulation_cache.json`** — the latest run's event log, written (atomically, via `backend/core/storage.py::save_json_atomic`) after every completed simulation.
- **`runs/<YYYYMMDD-HHMMSS>-<scenario-slug>/`** — the permanent record, persisted best-effort by `orchestrator._finalize_run()`: `events.json`, `summary.json` (district summary, usage, counts), and `recap.md`. Browse them via `GET /api/runs`, fetch one with `GET /api/runs/{run_id}`, or download a self-contained shareable bundle with `GET /api/runs/{run_id}/export`.
- **`scenarios/<id>/demo/simulation_cache.json`** — a scenario's shipped demo replay (see [scenario-format.md](scenario-format.md#demo-replay-cache-demosimulation_cachejson--optional)).

`POST /api/simulation/replay` resolves its source in that order of explicitness — `cache_path` (project-root-anchored, traversal-rejected) > `run_id` > the active scenario's demo — then `backend/simulation/replay.py` deserializes each event and re-publishes it through the EventBus with per-type pacing (`speed` is a multiplier). Because replay re-enters the exact pipeline live events use, the frontend cannot tell the difference.

The **recap** (`backend/simulation/recap.py`) is the run's narrative: after each simulation, one provider call turns the real data — final distribution per town, the biggest stance swings mined from `opinion_changed` events, the meatiest conversation takeaways — into a 250–350-word markdown story with a headline. On the mock provider, or any provider trouble, a deterministic template with the same real numbers takes over; a finished simulation is never failed by its own paperwork. Read it via `GET /api/simulation/recap`, in `runs/<id>/recap.md`, or at the end of `township run` output.

## Design decisions

| Decision | Choice | Why |
|---|---|---|
| Backend | Python + FastAPI | Native async for parallel towns and fan-out agent calls; Pydantic validation from scenario manifest to wire event |
| LLM access | Provider abstraction (`backend/providers/`) — Bedrock, Anthropic API, OpenAI-compatible (OpenAI/OpenRouter/Ollama/LM Studio), deterministic mock | One narrow `call_agent` contract; credential auto-detection; a zero-key clone runs end to end on the mock, and CI never needs a secret |
| Scenario content | Data packages under `scenarios/`, never code | The engine is scenario-agnostic; a new deliberation is a directory, not a fork |
| Agent personas | Markdown + YAML frontmatter | Git-trackable, reviewable in a diff, editable with no code; the body *is* the system prompt |
| Memory | Plain chronological list, no embeddings | For a 5-round arc, the 10 most recent memories fit in the prompt; a vector store would add infrastructure to approximate what recency already gives |
| Simulation delivery | Pre-compute + replay alongside live runs | Demo reliability and shareable runs; replay re-enters the same EventBus, so the frontend code path is identical. Chat and God's View stay live |
| Frontend state | One `useReducer` fed by the WebSocket | The discriminated event union is the single state driver; there is no second data path to drift |
| Persistence | Plain JSON files, atomic writes (`backend/core/storage.py`) | Runs are append-only artifacts and mutable state is small; a database would buy nothing but operations |

One caveat worth quoting alongside any architectural pride: the pipeline faithfully renders whatever the models produce, and per [RESPONSIBLE_USE.md](../RESPONSIBLE_USE.md) —

> **Township is a simulation, not a poll.** Its outputs do not measure real public opinion and must never be presented as if they do.
> **The residents are fictional composites**, informed by public demographic data. No real resident is depicted.
> **The candidates are real public figures**; their positions are quoted from cited public sources, not invented.
> **Every output is an LLM artifact**, shaped by who wrote the personas and by the model's own biases.
