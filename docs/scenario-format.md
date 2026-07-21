# Scenario Package Format

A *scenario* is everything Township needs to stage one civic deliberation: the question a community faces, the options on the table, the towns it plays out in, the residents who argue about it, the news beats that land mid-argument, and the round-by-round plan the engine follows. It is a plain directory under `scenarios/` — JSON manifests plus markdown personas, no code.

The engine itself is scenario-agnostic. `backend/simulation/round_manager.py` and `backend/simulation/orchestrator.py` read every piece of content from the loaded scenario; nothing about NJ-11 (or any election) is hardcoded. Pick the active scenario with the `SCENARIO` environment variable:

```bash
SCENARIO=millbrook-budget python -m uvicorn backend.main:app --reload --port 8001
```

The default is `nj11-2026`. Two complete packages ship with the repo and double as reference implementations:

- `scenarios/nj11-2026/` — a retrospective congressional special election (`kind: "election"`, 4 towns, 26 agents)
- `scenarios/millbrook-budget/` — a fictional town-meeting budget vote (`kind: "vote"`, 2 towns, 8 agents)

## Directory layout

```
scenarios/<id>/
├── scenario.json          # the manifest — validated against ScenarioConfig
├── towns/
│   └── <town-id>.json     # per-town layout, demographics, accent color
├── options/
│   └── <option-id>.json   # rich per-option data (positions, background, endorsements)
├── agents/
│   └── <town-id>/
│       └── <slug>.md      # persona files: YAML frontmatter + markdown body
├── context/               # OPTIONAL extra briefing material
│   ├── debate-excerpts.json
│   └── logistics.json
└── god-scenarios.json     # OPTIONAL curated God's View injections
```

The loader is `load_scenario()` in `backend/core/scenario.py`. It validates the manifest with Pydantic, loads every town and option file, parses all personas, and fails loudly on anything inconsistent (see [Validation](#validation)).

## `scenario.json` field reference

The manifest schema is `ScenarioConfig` in `backend/core/scenario.py`. Every field, its type, and the engine component that consumes it:

| Field | Type | Required | Consumed by |
|---|---|---|---|
| `id` | `str` | yes | Everything — must match the directory name so `SCENARIO=<id>` resolves |
| `title` | `str` | yes | Prompt templating (tool descriptions, conversation openers), UI header via `GET /api/scenario` |
| `question` | `str` | yes | Seed and opinion prompts in `RoundManager`; UI |
| `kind` | `str` | no (default `"vote"`) | `"election"` or `"vote"` — served as `decision_kind` by `GET /api/scenario`; the frontend's `ScenarioContext` switches its wording accordingly |
| `options` | `list[ScenarioOption]` | yes (≥ 1, unique ids) | The stance roster. Ids become the `FormOpinion` tool's `candidate` enum (`backend/tools/schemas.py::build_tools`); colors/labels drive every chart |
| `undecided` | `UndecidedSpec` | no | The "no stance yet" bucket: `id` (default `"undecided"`), `label`, `color`. Always appended to the stance roster |
| `dates` | `DatesSpec` | yes | `decision_day` (ISO date) + `prose` (human framing). The prose goes into the seed briefing; both are served to the UI |
| `context_md` | `str` | yes | The per-agent framing block — appended to **every** agent system prompt as `--- CONTEXT ---` (`RoundManager._build_agent_system_prompt`) |
| `context_short_md` | `str` | yes | Compact context for chat and God's View prompts (`orchestrator._build_god_view_prompt`, `routes/chat.py`) |
| `round_plan` | `list[RoundSpec]` | yes (≥ 1) | THE simulation script — see [Round plan and phases](#round-plan-and-phases) |
| `news` | `list[NewsItem]` | no | `{id, headline, description}` beats referenced by `round_plan[].news_ids` |
| `cross_town_pairs` | `list[CrossTownPair]` | no | Curated gossip pairings — see [Cross-town gossip](#cross-town-gossip) |
| `cross_town_meeting_place` | `str` | no (default `"Community Event"`) | The neutral location named in cross-town conversations |
| `weather_schedule` | `list[str]` | no | One entry per round; the orchestrator publishes a district-wide `weather_changed` event for each. Valid values: `clear`, `cloudy`, `rain`, `snow`, `fog` |
| `gossip_rounds` | `list[int]` | no | Round numbers at which the orchestrator runs the cross-town gossip pass |
| `town_order` | `list[str] \| None` | no | Display/iteration order for towns (`Scenario.town_ids`). Towns not listed are appended alphabetically so nothing silently disappears |

### Options

Each entry in `options`:

```json
{
  "id": "greenway",                      // stance id — what agents "vote" with
  "name": "The Riverwalk Greenway",      // full display name
  "label": "Greenway",                   // short label for charts and pins
  "color": "#3E8E5A",                    // this option's color everywhere in the UI
  "group": "invest",                     // optional grouping (party for elections)
  "data_file": "options/greenway.json"   // optional path to rich data, relative to the scenario dir
}
```

When `data_file` is omitted the loader falls back to `options/<id>.json`; when neither exists the option simply has no rich data (fine for authoring, thin for agents).

### Round plan and phases

Each `RoundSpec`:

```json
{ "round": 2, "clock": "13:00", "phases": ["converse", "opinion"], "news_ids": [] }
```

- `round` numbers must be **0-based, unique, and contiguous** (`0..N-1`) — validated at load, so "run the first N rounds" is a plain slice everywhere (`RoundManager.run_town_simulation`, `POST /api/simulation/start`).
- `clock` is an in-game wall clock, `"HH:MM"` 24-hour (regex-validated). Emitted once per round as a `world_clock_tick` event — cosmetic on the frontend.
- `phases` run **in the order you declare them**. `RoundManager.run_town_simulation` dispatches each phase name directly:

| Phase | What the engine does |
|---|---|
| `seed` | Builds the full briefing (`Scenario.build_full_context()`: title, question, dates, every option's rich data, plus any `context/` extras) and asks every agent for an initial `FormOpinion` |
| `converse` | Pairs agents randomly within the town (`len(agents) // 2` pairs), runs 3-exchange conversations at a random landmark using the `Discuss` tool; each exchange emits an `agent_speech` event and becomes a memory |
| `news` | Publishes a `news_injected` event for each id in this round's `news_ids`, then collects a `ReactToNews` from every agent (emotional response, impact on stance, reasoning) |
| `opinion` | Every agent reflects on its 10 most recent memories and re-runs `FormOpinion`; changes publish `opinion_changed` events |
| `decide` | Marks all non-errored agents as `DECIDED` — the terminal state. No LLM call |

- `news_ids` may only reference ids that exist in the top-level `news` list — the loader rejects unknown ids.

A typical arc (both shipped scenarios use it): round 0 seeds, middle rounds interleave `converse` + `news`, the final round runs `converse` + `opinion` (NJ-11 adds `decide`).

### Cross-town gossip

`cross_town_pairs` entries name exactly two agents (display names, case-insensitive) and the backstory that explains why they know each other:

```json
{
  "agents": ["Marcus Bell", "Rocco DiSanto"],
  "connection": "Rocco has sponsored Marcus's rec league since the coach arrived two years ago..."
}
```

At each round in `gossip_rounds`, the orchestrator matches these pairs across towns and runs a 3-exchange conversation with the connection story in the prompt (`RoundManager.run_cross_town_conversation`). Agents not covered by a curated pair get randomly matched across towns with a generic "met at `cross_town_meeting_place`" connection. Each gossip conversation also emits `cross_town_gossip` events in both directions so the receiving town's UI can show the rumor arriving.

## Town JSON (`towns/<town-id>.json`)

One file per town; the filename stem is the town id and must match the agent directory name under `agents/`. The whole file is served verbatim by `GET /api/towns`, so the frontend and backend can never disagree about coordinates. From `scenarios/millbrook-budget/towns/millbrook-village.json`:

```json
{
  "name": "Millbrook Village",
  "county": "Ashford County",
  "tagline": "The Mill Village",
  "accent_color": "#7A9E7E",
  "ambient_sound": "millbrook_village_ambient.ogg",
  "demographics": { "population": 3850, "median_age": 51.2, "...": "..." },
  "character": "The old center: brick storefronts on Main Street...",
  "landmarks": [
    {
      "name": "Stillwater River",
      "x": 0, "y": 60, "width": 1200, "height": 70,
      "color": "#7FA8C9",
      "type": "water",
      "description": "The river that turned the Harrow Mill's wheels for 121 years"
    }
  ],
  "color_theme": { "primary": "#7A9E7E", "secondary": "#5C7A60" }
}
```

What the engine actually reads:

- **`accent_color`** — the town's color on the wire (`Scenario.town_color`, used by `backend/core/wire.py` for agent roster colors) and on the district map.
- **`landmarks[].name`** — conversation locations. The engine picks a random landmark for each conversation and writes it into memories ("Talked with Cass Malone at The Wheelhouse Diner...").
- **`landmarks[].x/y`** — coordinates for `agent_moved` events, which the Phaser scene animates.
- **`demographics.population`** — surfaced by `GET /api/scenario` town cards.

Everything else (`character`, `ambient_sound`, `color_theme`, landmark `width`/`height`/`color`/`type`/`description`) is consumed by the frontend. The Phaser scene (`frontend/src/game/TownScene.ts`) styles landmarks by `type`; the types used across the shipped scenarios are `building`, `church`, `housing`, `park`, `road`, `transport`, and `water` (rivers and lakes — Millbrook's Stillwater River is a full-width `water` strip). Parks get ambient animations, churches get sparkle effects, roads are excluded from agent wander points.

## Option JSON (`options/<option-id>.json`)

Rich per-option data feeding the seed-round briefing. `Scenario.build_full_context()` reads these keys:

| Key | Used as |
|---|---|
| `name` | Section header (falls back to the manifest's `name`) |
| `party` | Header suffix `(...)` — falls back to the manifest's `group` |
| `background` or `summary` | "Background:" paragraph |
| `positions` | List of `{issue, stance}` bullets — the core of what agents learn |
| `endorsements` | Comma-joined "Endorsements:" line |
| `fraud_conviction` | `{description}` rendered as a `NOTE:` line (NJ-11's Bond carries one) |

Anything else in the file (`estimated_cost`, `tradeoffs`, `label`) is currently ignored by the prompt builder — keeping it is still good practice, both for future use and because it forces you to actually think the option through. `scenarios/millbrook-budget/options/greenway.json` is the model to copy: a multi-paragraph `background` with real history and grief in it, six `positions`, five `endorsements`, and honest `tradeoffs`.

## Context extras (`context/*.json`) — optional

Every JSON file in `context/` loads into `Scenario.extras` keyed by file stem. Two stems get special rendering in the seed briefing:

- **`debate-excerpts.json`** — `{debate: {date}, exchanges: [{topic, tension_level, <speaker>_position, key_quote}]}`. Any key ending in `_position` is rendered as that speaker's line; `key_quote` becomes a "Key moment". See `scenarios/nj11-2026/context/debate-excerpts.json`.
- **`logistics.json`** — `{race, election_day: {date, day_of_week}, early_voting: {dates}}` rendered as a LOGISTICS bullet list.

Other stems load without error and sit in `extras` for custom use. Invalid JSON is skipped with a warning, not a crash.

## God's View presets (`god-scenarios.json`) — optional

A JSON array of curated injections served by `GET /api/gods-view/scenarios` and shown as one-click presets in the God's View UI:

```json
{
  "id": "mill-collapse",
  "name": "Storm Topples the Mill's East Wall",
  "description": "An overnight nor'easter drops the east wall of the Harrow Mill's weave room into the Stillwater...",
  "category": "safety",
  "expected_impact": "Greenway supporters split — 'stabilize now' versus 'the ruins are a liability'...",
  "affected_towns": ["millbrook-village", "harlow-crossing"]
}
```

`description` is what actually gets injected into every agent; `expected_impact` is your authoring hypothesis, displayed so users can compare prediction against what the agents actually do. Write injections that cut *across* your options rather than obviously boosting one — the interesting ones split a coalition.

## Personas (`agents/<town-id>/*.md`)

One markdown file per resident: YAML frontmatter (parsed by `backend/core/agent_loader.py` into an `AgentDefinition`) plus a markdown body that becomes the agent's base system prompt.

Required frontmatter keys: `name`, `town`, `description`, `age`, `occupation`, `household`, `income_bracket`, `language`, `political_registration`, `initial_lean`, `top_concerns`.

- `town` must match the directory the file sits in (lint-enforced).
- `initial_lean` must be on the scenario's stance roster — an option id or the undecided id. A typo here fails the load, not just a test.
- `top_concerns` drive conversation topic selection: two agents talk about a concern they share.

Optional keys:

- `tools` (default `["Discuss", "FormOpinion", "ReactToNews"]`) — declarative; the engine selects the tool for each phase itself.
- `model` (default `"claude-sonnet-4-5"`) — per-agent model pin, resolved through the active provider's model map.
- `routine` — `[{time, location, activity}]`; locations should name real landmarks in the agent's town (lint requires ≥ 80% to resolve).
- `relationships` — `[{agent, type, strength, context}]`; targets may be display names (`"Gordon Tibbs"`) or slugs (`"gordon-tibbs"`) and must resolve to a real agent in the scenario. Agent ids are derived as `name.lower().replace(" ", "-").replace(".", "")`.
- `idle_thoughts` — lines the sprite mutters when nothing else is happening.
- `goals` — `{"round_0": "...", "round_1": "..."}`; the matching entry is injected into the system prompt each round as `--- YOUR GOAL THIS ROUND ---`.

The **body** is the persona itself, written in second person. The strongest reference is `scenarios/millbrook-budget/agents/millbrook-village/mill-widow.md` (Adele Pruitt): specific places, a speech tic ("mind you"), an honest internal conflict between her lean and two good counter-arguments, and concrete stakes ($58 more on this year's tax bill). Agents whose personas contain real tensions produce deliberation; agents built as mouthpieces produce speeches.

## Worked example: the Millbrook manifest

`scenarios/millbrook-budget/scenario.json`, annotated section by section. (Long prose strings are trimmed here — read the real file for the full text.)

```json
{
  "id": "millbrook-budget",
  "title": "The Millbrook Surplus",
  "question": "Millbrook has a one-time $12M surplus from the sale of the old mill property. What should it fund?",
```

No `kind` field — it defaults to `"vote"`, so the UI talks about a town vote, not an election. The `question` is a genuine three-way tradeoff, which matters more than anything else in the file: a scenario with an obviously correct answer produces five rounds of agreement.

```json
  "options": [
    { "id": "greenway", "name": "The Riverwalk Greenway", "label": "Greenway",
      "color": "#3E8E5A", "group": "invest",   "data_file": "options/greenway.json" },
    { "id": "roads",    "name": "Fix It First",           "label": "Roads & Bridge",
      "color": "#B0713A", "group": "maintain", "data_file": "options/roads.json" },
    { "id": "bonds",    "name": "Pay Down Debt",          "label": "Debt & Taxes",
      "color": "#5A6FA8", "group": "retire",   "data_file": "options/bonds.json" }
  ],
  "undecided": { "id": "undecided", "label": "Undecided", "color": "#C9C2B4" },
```

These three ids — plus `undecided` — are the complete stance roster. They become the `FormOpinion` enum, the color buckets on every chart, and the values `initial_lean` must use. `group` here is a philosophy (`invest`/`maintain`/`retire`) rather than a party; it's free-form.

```json
  "dates": {
    "decision_day": "2026-11-03",
    "prose": "Special Town Meeting: Tuesday, November 3, 2026, 7:00 PM, in the Harlow Elementary School gymnasium — the only room in town that holds everybody. ..."
  },
  "context_md": "In June, Millbrook sold the 38-acre upland campus of the old Harrow Woolen Mill ... Whatever passes, the mill only gets sold once. There is no second $12 million.",
  "context_short_md": "Millbrook netted a one-time $12M from selling the old Harrow Mill property ... One room, one night, one vote — and no second windfall.",
```

`context_md` rides along on *every single agent prompt*, so it earns its length: it frames the stakes and sketches all three options in one pass. `context_short_md` is the three-sentence version used in chat and God's View, where the persona and conversation history are doing most of the work.

```json
  "round_plan": [
    { "round": 0, "phases": ["seed"],               "clock": "08:00", "news_ids": [] },
    { "round": 1, "phases": ["converse", "news"],   "clock": "10:00", "news_ids": ["bridge-estimate"] },
    { "round": 2, "phases": ["converse", "news"],   "clock": "13:00", "news_ids": ["greenway-match"] },
    { "round": 3, "phases": ["converse", "news"],   "clock": "16:00", "news_ids": ["pension-warning"] },
    { "round": 4, "phases": ["converse", "opinion"], "clock": "19:00", "news_ids": [] }
  ],
```

A deliberate dramaturgy: each middle round lets agents talk *first*, then drops one news beat — and each beat strengthens a different option (`bridge-estimate` → roads, `greenway-match` → greenway, `pension-warning` → bonds). Note that rounds 1–3 have no `opinion` phase: opinions crystallize once, at the end, after everything has landed. NJ-11 makes the opposite choice (opinion checks at rounds 2, 3, and 4) so you can watch trajectories move.

```json
  "news": [
    { "id": "bridge-estimate", "headline": "Engineering Report Doubles Main Street Bridge Repair Estimate to $6.8M", "description": "..." },
    { "id": "greenway-match",  "headline": "Anonymous Donor Pledges $2M Match for the Riverwalk Greenway",          "description": "..." },
    { "id": "pension-warning", "headline": "State Comptroller Warns Towns: Pension Fund Returns 'Overstated'",       "description": "..." }
  ],
```

Descriptions are written like wire copy with concrete numbers and named places ("Engine 2 and the school buses must now detour the Route 9 loop, adding roughly eleven minutes"). Agents react to specifics; vague news gets vague reactions.

```json
  "cross_town_pairs": [
    { "agents": ["Adele Pruitt", "Cass Malone"],  "connection": "Their husbands ... worked side by side at the Harrow Mill for eighteen years. ..." },
    { "agents": ["Marcus Bell", "Rocco DiSanto"], "connection": "Rocco has sponsored Marcus's rec league since the coach arrived two years ago ..." }
  ],
  "cross_town_meeting_place": "Millbrook Farmers Market",
  "weather_schedule": ["clear", "cloudy", "rain", "clear", "clear"],
  "gossip_rounds": [2, 3],
  "town_order": ["millbrook-village", "harlow-crossing"]
}
```

Two curated pairs across eight agents; the other four get random cross-town matches at rounds 2 and 3. Five weather entries for five rounds. `town_order` puts the Village first everywhere towns are listed.

## Creating a scenario

1. **Start from the manifest.** Copy `scenarios/millbrook-budget/scenario.json` to `scenarios/<your-id>/scenario.json` and rewrite `id`, `title`, `question`, `options`, `dates`, and both context blocks. Get the question right before writing anything else — every persona and news beat hangs off it.
2. **Write the towns.** One `towns/<town-id>.json` each. The map is a 1200×800 canvas; place 8–10 landmarks with the fields shown above, including at least the places your personas' routines will name.
3. **Write the option files.** One `options/<id>.json` per option with `background`, `positions`, `endorsements`, and `tradeoffs`. If you can't write honest tradeoffs for an option, it isn't really an option.
4. **Write the personas.** `agents/<town-id>/<slug>.md`. Give every agent an `initial_lean` on your roster, concerns that overlap with *some* neighbors (that's what they'll talk about), and at least one reason to doubt their own lean.
5. **Script the rounds.** Order phases per round; attach news ids; set `gossip_rounds` and `weather_schedule` (one entry per round).
6. **Optionally** add `god-scenarios.json` presets and `context/` extras.
7. **Run it — no API keys needed.** The mock provider runs the full pipeline deterministically:

   ```bash
   SCENARIO=<your-id> LLM_PROVIDER=mock python -m uvicorn backend.main:app --port 8001
   curl -X POST localhost:8001/api/simulation/start -H 'content-type: application/json' -d '{}'
   ```

   Then open the frontend (`cd frontend && npm run dev`) and watch it play out before spending a cent on real model calls.

## Validation

Two layers, both cheap to run.

**Load-time errors** — `load_scenario()` refuses to start on a broken package. You'll hit these immediately on server boot (or in any test that loads your scenario):

- `scenario.json not found in ...` — missing manifest
- `scenario '<id>' has no towns/*.json files`
- `unknown phases [...]; valid phases: ['seed', 'converse', 'news', 'opinion', 'decide']`
- `clock must be 'HH:MM' (24h), got ...`
- `round_plan rounds must be unique and 0-based contiguous`
- `a scenario needs at least one option` / `duplicate option ids`
- `a cross-town pair needs exactly 2 agents`
- `round N references unknown news ids [...]`
- `persona initial_lean not on the stance roster [...]` — listing every offending `town/name`

**Persona lint** — `tests/test_persona_lint.py` automatically covers every directory under `scenarios/` that has a `scenario.json` and an `agents/` dir. It checks that every persona parses, every `initial_lean` is valid, agent town directories match `towns/*.json` files, relationship targets resolve to real agents, and ≥ 80% of routine locations name real landmarks:

```bash
python -m pytest tests/test_persona_lint.py -q     # just the lint
make test                                           # full suite, no API keys needed
```

Your scenario participates the moment the directory exists — no registration step.

## A note on responsible scenario authorship

Township ships a disclaimer with every scenario, and scenario authors are the first line of its design commitments (fictional residents, sourced public figures, no live-election influence). The block below is quoted verbatim from [RESPONSIBLE_USE.md](../RESPONSIBLE_USE.md) — read the whole document before publishing a scenario about a real election:

> **Township is a simulation, not a poll.** Its outputs do not measure real public opinion and must never be presented as if they do.
> **The residents are fictional composites**, informed by public demographic data. No real resident is depicted.
> **The candidates are real public figures**; their positions are quoted from cited public sources, not invented.
> **Every output is an LLM artifact**, shaped by who wrote the personas and by the model's own biases.
