# API reference

Township's backend is a FastAPI app (`backend/main.py`) that exposes a REST API under
`/api/*` and a WebSocket event stream at `/ws`. Every example below is a real response,
captured from a live server running the deterministic mock provider:

```bash
LLM_PROVIDER=mock python3 -m uvicorn backend.main:app --port 8093
```

FastAPI also serves interactive OpenAPI docs at `/docs` (and the raw schema at
`/openapi.json`) on any running instance — the fastest way to poke at request shapes.

## Auth model

There is none. Township is a local tool: the API has no accounts, tokens, or sessions.
The only browser-facing control is CORS — origins come from the `ALLOWED_ORIGINS`
environment variable (comma-separated; default
`http://localhost:5173,http://localhost:4173,http://localhost:3000`), with credentials
disabled so the explicit origin list is honored. If you expose a Township instance
beyond localhost, put your own auth in front of it (see
[deployment.md](deployment.md)).

Fields like `user_id` on chat and journal endpoints are client-chosen labels for
separating one player's state from another's, not authentication.

## Health

### `GET /api/health`

Server status, agent counts per town, and the cumulative LLM usage report.

```json
{
  "name": "Township",
  "status": "idle",
  "towns": ["dover", "montclair", "parsippany", "randolph"],
  "agent_counts": { "dover": 6, "montclair": 7, "parsippany": 7, "randolph": 6 },
  "total_agents": 26,
  "usage": {
    "total_input_tokens": 0,
    "total_output_tokens": 0,
    "total_cache_read_tokens": 0,
    "total_cache_write_tokens": 0,
    "total_tokens": 0,
    "total_cost": 0.0,
    "total_calls": 0,
    "default_model": "mock",
    "provider": "mock"
  }
}
```

`GET /` returns the same payload when no frontend build exists; once `frontend/dist`
is present, `/` serves the built app instead and `/api/health` remains the JSON
health check.

## Scenario — `/api/scenario`

### `GET /api/scenario`

The bootstrap payload the frontend fetches at startup: the question, the options
(ids, labels, colors), the towns, and the round count. Everything the UI knows about
the active scenario comes from here — nothing is hardcoded.

```json
{
  "id": "nj11-2026",
  "title": "The NJ-11 Special Election",
  "question": "Who should represent New Jersey's 11th Congressional District — Analilia Mejia (D), Joe Hathaway (R), or Alan B. Bond (I)?",
  "decision_kind": "election",
  "options": [
    { "id": "mejia", "name": "Analilia Mejia", "label": "Mejia", "color": "#4A8FBF", "group": "Democrat" },
    { "id": "hathaway", "name": "Joe Hathaway", "label": "Hathaway", "color": "#C0792A", "group": "Republican" },
    { "id": "bond", "name": "Alan B. Bond", "label": "Bond", "color": "#9A8E80", "group": "Independent" }
  ],
  "undecided": { "id": "undecided", "label": "Undecided", "color": "#D1D5DB" },
  "towns": [
    { "id": "dover", "name": "Dover", "tagline": "The Working-Class Heart", "color": "#E8763B", "county": "Morris County", "population": 18435 }
  ],
  "total_rounds": 5,
  "dates": {
    "decision_day": "2026-04-16",
    "prose": "Early voting runs April 6-14. Election Day is Thursday, April 16, 2026, with polls open 6:00 AM to 8:00 PM."
  }
}
```

(`towns` truncated to one entry here; the real response lists all four.)

## Towns — `/api/towns`

### `GET /api/towns`

Full content of every town's JSON file from the active scenario, keyed by town id:
`{"towns": {"dover": {...}, "montclair": {...}, ...}}`. This is the single source of
truth for landmark coordinates, accent colors, weather schedules, and ambient sound —
the Phaser scene renders whatever this returns.

### `GET /api/towns/{town_id}`

One town's JSON, or `404 {"detail": "Unknown town 'nowhere'"}`.

```json
{
  "name": "Dover",
  "county": "Morris County",
  "tagline": "The Working-Class Heart",
  "accent_color": "#E8763B",
  "ambient_sound": "dover_ambient.ogg",
  "weather_schedule": ["clear", "cloudy", "rain", "clear", "snow"],
  "demographics": { "population": 18435, "median_hh_income": 70519 },
  "landmarks": [
    { "name": "Blackwell Street", "x": 200, "y": 380, "width": 800, "height": 30,
      "color": "#D4A574", "type": "road", "description": "Historic main street" }
  ]
}
```

(Trimmed — Dover ships 9 landmarks plus `character`, `color_theme`, and `sources`.)

## Simulation — `/api/simulation`

### `POST /api/simulation/start`

Start a simulation as a background task; returns immediately. Body fields, all
optional:

| Field | Type | Meaning |
|---|---|---|
| `town` | string | Run one town only; omit to run the whole district in parallel |
| `rounds` (alias `num_rounds`) | int ≥ 1 | Cap the run at the first N rounds of the scenario's round plan; omit for the full plan |

```bash
curl -X POST http://localhost:8093/api/simulation/start \
  -H 'Content-Type: application/json' -d '{"rounds": 3}'
```

```json
{ "status": "started", "towns": ["dover", "montclair", "parsippany", "randolph"], "num_rounds": 3, "total_agents": 26 }
```

Errors: `409 {"status": "error", "message": "Simulation already running"}` if a run is
in flight; `404` with the list of valid towns for an unknown `town`:

```json
{ "status": "error", "message": "Unknown town: gotham. Available: ['dover', 'montclair', 'parsippany', 'randolph']" }
```

### `GET /api/simulation/status`

Poll-friendly snapshot: run state, per-agent summaries, and live usage/cost.

```json
{
  "is_running": false,
  "towns": ["dover", "montclair", "parsippany", "randolph"],
  "agents": {
    "dover": [
      { "agent_id": "carlos-restrepo", "name": "Carlos Restrepo", "state": "idle",
        "location": "Dover Station", "current_candidate": "undecided",
        "current_confidence": 48, "memories_count": 9, "conversations_count": 2 }
    ]
  },
  "has_results": true,
  "usage": { "total_input_tokens": 430378, "total_output_tokens": 16668, "total_cost": 0.0, "total_calls": 251, "provider": "mock" },
  "status": "completed",
  "current_round": 0,
  "total_rounds": 3,
  "agents_loaded": 26
}
```

`status` is one of `idle` / `running` / `completed` (matching the frontend's
`SimulationStatus` type). `agents` is truncated above — the real response lists all 26.

### `GET /api/simulation/results`

The completed run's `DistrictSummary` in frontend wire format — the response body *is*
the summary, no envelope. `404 {"error": "no_results", ...}` before any run completes.

```json
{
  "round": 3,
  "town_summaries": [
    { "town": "dover", "round": 3,
      "opinions": { "mejia": 0, "hathaway": 0, "bond": 3, "undecided": 3 },
      "top_issues": ["taxes", "rent", "property taxes", "healthcare"],
      "consensus_points": [], "fault_lines": [], "notable_conversations": [], "failed_agents": 0 }
  ],
  "overall_opinions": { "mejia": 5, "hathaway": 5, "bond": 8, "undecided": 8 },
  "cross_town_themes": [],
  "consensus_zones": ["taxes", "rent", "property taxes", "healthcare"],
  "fault_lines": ["healthcare", "rent", "schools", "immigration", "property taxes"],
  "prediction": "..."
}
```

### `GET /api/simulation/agents?town=dover`

Roster of agent definitions, grouped by town (`town` query param filters to one).

```json
{
  "agents": {
    "dover": [
      { "agent_id": "carlos-restrepo", "name": "Carlos Restrepo",
        "description": "Colombian-American restaurant owner on Blackwell St, Dover. 22 years in the US.",
        "occupation": "Owner, La Finca Restaurant", "age": 51,
        "political_registration": "unaffiliated", "initial_lean": "undecided",
        "top_concerns": ["healthcare costs (no employer insurance, ACA marketplace)", "immigration enforcement (employees, community fear)"],
        "language": "Spanish primary, functional English" }
    ]
  }
}
```

### `GET /api/simulation/agent/{agent_id}`

Rich single-agent detail: recent memories (last 20) and full opinion history.
`404 {"error": "not_found", "agent_id": ...}` for unknown ids.

```json
{
  "id": "carlos-restrepo",
  "name": "Carlos Restrepo",
  "town": "dover",
  "occupation": "Owner, La Finca Restaurant",
  "memories": ["Round 0: Learned about The NJ-11 Special Election and where the options stand."],
  "opinions": [
    { "candidate": "undecided", "confidence": 48,
      "reasoning": "After everything I've heard, I'm still not settled on anyone. Taxes is still my number one issue and that's what I'm voting on.",
      "top_issues": ["property taxes", "taxes", "college"], "dealbreaker": null, "round_number": 0 }
  ],
  "location": "Dover Station",
  "state": "idle"
}
```

### `POST /api/simulation/replay`

Replay a cached simulation through the WebSocket — the zero-cost way to drive the full
UI. Source resolution order: explicit `cache_path` (resolved against the project root;
paths escaping it are rejected with a 400) → `run_id` (a persisted `runs/` directory)
→ the active scenario's shipped demo cache (`scenarios/<id>/demo/simulation_cache.json`).

```bash
curl -X POST http://localhost:8093/api/simulation/replay \
  -H 'Content-Type: application/json' \
  -d '{"run_id": "20260721-051945-nj11-2026", "speed": 10}'
```

```json
{ "status": "replaying", "total_events": 576, "speed": 10.0 }
```

`speed` is a playback multiplier (default `1.0`). Unknown sources return
`404 {"status": "error", "message": ...}`.

### `GET /api/simulation/replay/available`

Every replay source this deployment can serve right now — the scenario's demo cache
(if shipped) plus every persisted run that still has its event log.

```json
{
  "sources": [
    { "kind": "run", "run_id": "20260721-051945-nj11-2026", "scenario_id": "nj11-2026",
      "ended_at": "2026-07-21T05:19:53.376377+00:00", "events": 576 }
  ]
}
```

### `GET /api/simulation/recap`

The most recent narrative recap in Markdown — from the in-memory run if one just
finished, otherwise from the newest persisted run. `404 {"error": "no_recap", ...}`
when none exists.

```json
{
  "recap_markdown": "# Bond Leads at 30.8% as The NJ-11 Special Election Comes to a Head\n\n26 residents across 4 towns spent the simulation wrestling with one question: ...",
  "headline": "Bond Leads at 30.8% as The NJ-11 Special Election Comes to a Head",
  "run_id": "20260721-051945-nj11-2026"
}
```

## Runs — `/api/runs`

Every completed simulation persists a `runs/<run_id>/` directory (`summary.json` +
`events.json` + `recap.md`). Run ids are strictly `YYYYMMDD-HHMMSS-<scenario-slug>`;
anything else is rejected before touching the filesystem.

### `GET /api/runs`

List persisted runs, newest first — metadata only.

```json
{
  "runs": [
    { "run_id": "20260721-051945-nj11-2026", "scenario_id": "nj11-2026",
      "scenario_title": "The NJ-11 Special Election",
      "started_at": "2026-07-21T05:19:45.319511+00:00",
      "ended_at": "2026-07-21T05:19:53.376377+00:00",
      "counts": { "events": 576, "towns": 4, "agents": 26, "conversations": 24 },
      "headline": "Bond Leads at 30.8% as The NJ-11 Special Election Comes to a Head",
      "has_events": true }
  ]
}
```

### `GET /api/runs/{run_id}`

One run's full `summary.json` — the district summary, the usage report, the counts,
and the complete `recap_markdown`. `404 {"error": "run_not_found", "run_id": ...}`
for bad ids, `404 {"error": "summary_missing", ...}` if the directory lost its summary.

### `GET /api/runs/{run_id}/export`

The whole run as one self-contained JSON download
(`Content-Disposition: attachment; filename="<run_id>.json"`):

```json
{ "run_id": "20260721-051945-nj11-2026", "summary": { "...": "..." }, "events": ["576 events"], "recap_markdown": "# Bond Leads..." }
```

The `events` array is the same shape `POST /api/simulation/replay` consumes, so an
exported run is directly shareable and replayable on another Township instance via
`cache_path`.

## Chat — `/api/chat`

### `POST /api/chat/{agent_id}`

Talk to an agent in character. The agent answers from its full persona, current
opinion, and recent memories; each exchange also triggers two best-effort follow-up
LLM calls — a trust classification (which can publish a `relationship_update` WS
event) and an opinion re-evaluation (which can publish `opinion_changed`).

Request: `{"message": "...", "user_id": "...", "user_profile": {...}}` — only
`message` is required. `user_profile` (name, town, top_concerns, political_leaning)
enriches the prompt and is remembered on the relationship.

```bash
curl -X POST http://localhost:8093/api/chat/carlos-restrepo \
  -H 'Content-Type: application/json' \
  -d '{"message": "What matters most to you in this election?", "user_id": "docs-demo",
       "user_profile": {"name": "Sam", "town": "dover", "top_concerns": ["property taxes"]}}'
```

```json
{
  "response": "Good of you to ask. For me it all comes down to property taxes — that's what I'm weighing before I vote. What about you?",
  "agent_id": "carlos-restrepo",
  "agent_name": "Carlos Restrepo",
  "opinion": { "candidate": "undecided", "confidence": 55, "reasoning": "...", "top_issues": ["property taxes", "taxes", "college"], "dealbreaker": null, "round_number": 2 },
  "opinion_changed": false,
  "trust": -10,
  "trust_band": "guarded"
}
```

`trust` runs −100…100; `trust_band` is `distrust` / `guarded` / `warming` / `friend`
and changes how open the agent is with you. Errors: `404 {"error": "agent_not_found"}`,
`503 {"error": "llm_unavailable"}` when the provider call fails.

### `POST /api/chat/auto/{agent_id}`

Auto-agent mode: the server generates *both* sides of the exchange — an AI persona
built from `user_profile` speaks for the player, then the agent replies. Request:
`{"user_profile": {...}, "conversation_history": [{"role": "user"|"agent", "content": "..."}], "user_id": "..."}`
(`user_profile` required).

```json
{
  "user_message": "I'll be straight with you: property taxes is the thing I need people to get serious about. So far I'm still listening.",
  "agent_response": "Things are steady, thanks. Though property taxes is never far from my mind these days — this decision feels like it matters more than most.",
  "agent_id": "carlos-restrepo",
  "agent_name": "Carlos Restrepo",
  "should_end": false,
  "opinion": { "candidate": "undecided", "confidence": 55, "...": "..." },
  "opinion_changed": false,
  "trust": -7,
  "trust_band": "guarded"
}
```

`should_end` flips true after four exchanges so the UI can wind the conversation down.

### `GET /api/chat/relationships/{user_id}`

Everything each agent remembers about this player — persisted to
`data/state/relationships.json` across restarts.

```json
{
  "user_id": "docs-demo",
  "relationships": {
    "carlos-restrepo": {
      "trust": -7,
      "encounters": 2,
      "topics_discussed": ["What matters most to you", "I'll be straight with you:"],
      "last_chat_at": "2026-07-21T05:20:25.303039+00:00",
      "last_message_at": "2026-07-21T05:20:25.303039+00:00",
      "last_classification": "agreeable",
      "player_revealed_to_them": { "name": "Sam", "town": "dover", "concerns": ["property taxes"], "leaning": "undecided" }
    }
  }
}
```

### `POST /api/chat/relationships/reset`

Body `{"user_id": "...", "agent_id": "..."}` — omit `agent_id` to clear every
relationship for that user. Returns `{"status": "ok", "cleared": 1}`.

## God's View — `/api/gods-view`

### `GET /api/gods-view/scenarios`

The curated injection presets shipped with the active scenario
(`scenarios/<id>/god-scenarios.json`). NJ-11 ships 8.

```json
{
  "scenarios": [
    { "id": "ice-dover", "name": "ICE Enforcement in Dover",
      "description": "ICE conducts a workplace enforcement operation at a Dover restaurant, detaining 3 undocumented workers. ...",
      "category": "immigration",
      "expected_impact": "Dover agents shift strongly toward Mejia on immigration. ...",
      "affected_towns": ["dover", "parsippany", "randolph", "montclair"] }
  ]
}
```

### `POST /api/gods-view`

Inject a free-text event into the simulation and collect every agent's reaction.
This is a live call — all 26 agents react, so on a real provider it costs real money.
Body: `{"description": "..."}`.

```bash
curl -X POST http://localhost:8093/api/gods-view \
  -H 'Content-Type: application/json' \
  -d '{"description": "A major local employer announces a shutdown, displacing hundreds of workers"}'
```

```json
{
  "status": "complete",
  "description": "A major local employer announces a shutdown, displacing hundreds of workers",
  "total_agents_reacted": 26,
  "reactions": [
    { "agent_id": "carlos-restrepo", "agent_name": "Carlos Restrepo", "town": "dover",
      "headline": "A major local employer announces a shutdown, displacing hundreds of workers",
      "emotional_response": "hopeful", "impact_on_vote": "changes_mind",
      "reasoning": "I read this twice. Anything touching property taxes touches my household, so I can't just shrug it off." }
  ],
  "impact_summary": { "strengthens_current": 7, "weakens_current": 9, "changes_mind": 6, "no_effect": 4 },
  "emotional_summary": { "angry": 8, "hopeful": 4, "anxious": 6, "indifferent": 4, "confused": 4 },
  "opinion_shifts": [],
  "usage": { "total_cost": 0.0, "total_calls": 305, "provider": "mock" }
}
```

The same reaction set is also broadcast as a `gods_view_result` WebSocket event, so
open clients see it without polling.

## Journal — `/api/journal`

Per-player conversation log, persisted to `data/state/journal.json`.

### `POST /api/journal/entry`

Append an entry. Required: `user_id`, `agent_id`. Optional: `agent_name`, `town`
(back-filled from the live agent when omitted), `transcript`
(`[{role, content, ts?}]`), `opinion_before/after`, `trust_before/after`.
Returns `{"status": "ok", "total_entries": 1}`.

### `GET /api/journal/{user_id}`

```json
{
  "user_id": "docs-demo",
  "entries": [
    { "agent_id": "carlos-restrepo", "agent_name": "Carlos Restrepo", "town": "dover",
      "transcript": [
        { "role": "user", "content": "What matters most to you?", "ts": null },
        { "role": "agent", "content": "Property taxes, mostly.", "ts": null }
      ],
      "opinion_before": null, "opinion_after": null,
      "trust_before": 0, "trust_after": -10,
      "created_at": "2026-07-21T05:20:33.675252+00:00" }
  ]
}
```

### `DELETE /api/journal/{user_id}`

Clear a user's journal: `{"status": "ok", "cleared": 1}`.

## Voice — `/api/transcribe` and `/api/tts`

Both are server-side proxies so the browser never holds a key, and both degrade
gracefully: **without the relevant key they return `503` with a parseable JSON body**,
and the frontend simply hides the voice features.

### `POST /api/transcribe`

Multipart upload (`audio` file field) → OpenAI Whisper (`whisper-1`) via the
server's `OPENAI_API_KEY`. Success: `{"transcript": "..."}`. Without a key:

```json
{ "transcript": "", "error": "transcription_unavailable", "message": "OPENAI_API_KEY is not configured on the server." }
```

The same `503` shape covers missing/empty uploads and upstream Whisper failures.

### `POST /api/tts`

Body `{"text": "...", "voice_id": "..."}` (`voice_id` optional; defaults to
ElevenLabs' "Rachel") → streams back `audio/mpeg` using the server's
`ELEVENLABS_API_KEY`. Without a key:

```json
{ "error": "tts_unavailable", "message": "ELEVENLABS_API_KEY is not configured on the server." }
```

## WebSocket — `/ws`

Connect to `ws://<host>/ws` (the Vite dev server proxies it to the backend). The
server accepts the connection, registers it with the event bus, and pushes every
simulation event as one JSON message. Send the literal text `ping` to receive
`{"type":"pong"}` as a keepalive.

Every message is a discriminated union on `type` — the authoritative definitions live
in `frontend/src/types/messages.ts` (`SimulationEvent`), mirrored by
`backend/core/types.py` and guarded by `tests/test_wire_contract.py`.

| `type` | When it's emitted |
|---|---|
| `simulation_started` | A run (or replay) begins — carries the full `AgentState[]` roster and town list; the UI resets from this |
| `round_started` | Each round of the plan opens (`round`, `total_rounds`) |
| `world_clock_tick` | The round's scripted clock time (`hour`, `minute`) — drives the in-game day/night cycle |
| `weather_changed` | The scenario's per-round `weather_schedule` advances (`clear`/`cloudy`/`rain`/`snow`/`fog`) |
| `agent_moved` | An agent heads to a landmark during the converse phase (optional exact `x`/`y` target) |
| `conversation_started` | Two agents begin talking — full `Conversation` object (participants, location, topic) |
| `agent_speech` | A dialogue line within a conversation, plus idle chatter; includes an optional `gesture` |
| `conversation_ended` | The conversation wraps with its `summary` |
| `news_injected` | The news phase publishes a scenario news beat (`headline`, `description`, `round`) |
| `news_reaction` | One agent's `NewsReaction` to that beat (emotional response, impact on vote, reasoning) |
| `opinion_changed` | An agent's stance or confidence moved — after opinion phases, news, gossip, chats, or God's View (old vs. new `Opinion`) |
| `cross_town_gossip` | A gossip round relays a message between agents in different towns |
| `round_ended` | The round closes with per-town `TownSummary[]` |
| `simulation_ended` | The run completes — carries the final `DistrictSummary` |
| `god_view_injection` | A God's View injection lands in the world (the narrative moment) |
| `gods_view_result` | The full reaction set from `POST /api/gods-view` (same wire shape as the HTTP body) |
| `relationship_update` | A chat exchange changed the player's trust with an agent (`trust`, `delta`, `classification`) |

Replays (`POST /api/simulation/replay`) push the identical event stream, so a client
can't — and needn't — tell a cached run from a live one.
