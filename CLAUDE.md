# CLAUDE.md — Township

Township is a civic deliberation engine: AI residents deliberate elections and policy
questions in a living pixel town. A FastAPI backend runs multi-round simulations
(phases: seed → converse → news → opinion → decide) and streams events over WebSocket
to a React + Phaser 3 frontend. Everything domain-specific — towns, personas, options,
news beats — lives in a *scenario package* under `scenarios/<id>/`, never in code.
LLM calls go through a provider abstraction (`backend/providers/`) that includes a
deterministic zero-key mock, so a fresh clone runs end to end with no credentials.
After a simulation finishes, the engine best-effort persists a versioned public
event log and summary under `runs/<run_id>/` (gitignored), plus a narrative recap
when recap generation succeeds; completed artifacts are served via `/api/runs`.

## Key directories

| Path | What lives there |
|------|------------------|
| `backend/core/` | Pydantic types, scenario loader (`scenario.py`), persona loader, event bus, wire DTOs (`wire.py`), atomic JSON persistence (`storage.py`) |
| `backend/simulation/` | `round_manager.py` (the beat loop), `orchestrator.py` (multi-town parallel, the presence table, checkpoints + resume, run persistence), `calendar.py` (campaign → beats), `influence.py` (the deterministic influence ledger every opinion change cites), `attribution.py` (reflection digests + citation validation), `budget.py`, `recap.py`, `replay.py` |
| `backend/community/` | The neighbors tier: `neighbors.py` generates each town's background residents (`township new-neighbors`, output committed as `scenarios/<id>/agents/<town>/_neighbors.json`, never generated at load), `grammar.py` voices their templated lines, `defaults.json` holds the generic pools |
| `backend/providers/` | `base.py` interface, `factory.py` selection, bedrock / anthropic / openai-compat / mock backends |
| `backend/routes/` | REST + WS routers: simulation, chat, gods_view, scenario, towns, journal, runs, transcribe, tts |
| `backend/cli.py` | The `township` CLI (Typer): serve, run, replay, scenarios, new-scenario, new-agent |
| `scenarios/<id>/` | `scenario.json`, `towns/*.json`, `options/*.json`, `agents/<town>/*.md` (voices) + `agents/<town>/_neighbors.json` (generated neighbors), `community.json` (per-town lean/name mixes), `context/*.json`, `god-scenarios.json` |
| `frontend/src/game/` | Phaser: `TownScene.ts`, `AgentSprite.ts`, `NavGrid.ts` (4-way A* paths), `Spots.ts` (where residents stand), `Conversations.ts` (choreography), `DayPart.ts`, `CivicLayer.ts` (election dressing), `TrafficLayer.ts`, `seasonPalette.ts`, `SceneAmbience.ts`, world clock, weather |
| `frontend/src/components/`, `hooks/`, `lib/`, `demo/` | React UI (TownView, Dashboard, GodsView, ChatPanel, LiveTransport, DaySummaryCard), the WS/REST hooks (`useWebSocket` keeps opinion history, influence edges, presence), pure helpers (`lib/stance.ts` tiers, `lib/election.ts` phases/results, `lib/calendar.ts` day strings, `lib/attribution.ts` derived causes, `lib/selectors.ts` causal feed), and the replay player (`demo/seek.ts` checkpoints, `demoMode.ts` feeds) |
| `scripts/mapgen/` | Named-GID tile registry + validators for the vendored ai-town tileset |
| `tests/` | Backend contract tests — the whole suite runs offline, no credentials needed |

## Commands

- `make install` — `pip install -e ".[dev]"` + frontend `npm install`; also installs the `township` CLI
- `make dev` — backend on :8001 + Vite on :5173; `make dev-backend` / `make dev-frontend` for one side
- `make test` — `pytest -q` plus `npx tsc --noEmit`; no API keys needed
- `make lint` / `make format` — ruff over `backend` and `tests`
- `make maps` — regenerate the custom tileset, every town `.tmj` + preview, the atlases, and the frontend tile metadata (`windowGids.json`, `stampDefs.json`, `roadGids.json`) after touching `scripts/mapgen/` or a town's landmarks
- `make demo` — zero-key server via the mock provider; then `make sim` starts a run (`TOWN=dover` for one town)
- `township run --provider mock` — headless simulation, printing the recap and run directory when available; `--preset campaign --days 21` runs the calendar (`--until-election`, `--budget`, `--resume <run_id>`, `--demo-out <file>` to record a demo feed); `township replay --run-id <id>` replays a persisted run; `township new-scenario <id>` / `new-agent` scaffold packages and personas; `township new-neighbors <id>` regenerates a scenario's committed neighbors
- `make demo-cache SCENARIO=… DAYS=… PROVIDER=claude-cli` — record a campaign as a demo feed; `TOWNSHIP_BEAT_PAUSE_S` paces API-started runs (6 s at 1×; the CLI and tests use 0)
- `LLM_PROVIDER=mock` forces the deterministic mock anywhere (valid values: bedrock, anthropic, claude-cli, openai, openrouter, ollama, lmstudio, mock); unset, the factory auto-detects from whichever API key is present, then from an installed `claude` CLI (`claude-cli` — your Claude subscription, the project's real provider; `TOWNSHIP_NO_CLI_AUTODETECT=1` skips it, as the test suite does), and falls back to mock — loudly
- `SCENARIO=<id>` selects the scenario package (default `nj11-2026`; `millbrook-budget` also ships)

## Invariants — do not break

1. **Wire contract.** Event `type` literals in `backend/core/types.py` and the DTO shapes in `backend/core/wire.py` must match `frontend/src/types/messages.ts` and the `useWebSocket` reducer. `tests/test_wire_contract.py` guards this — never rename an event field casually; change both sides together and run the test.
2. **Scenario data lives in `scenarios/`, not code.** If you find yourself hardcoding a candidate, town, or news beat inside `backend/`, stop and put it in the scenario package instead.
3. **Secrets only via env** (`ANTHROPIC_API_KEY`, `AWS_BEARER_TOKEN_BEDROCK`, `OPENAI_API_KEY`, …). Never commit a key or write one into a tracked file.

## More docs

`docs/README.md` indexes the documentation; `docs/scenario-format.md` specifies the
scenario package format. Read `RESPONSIBLE_USE.md` before changing anything
election-facing — the simulation-not-a-poll disclaimer ships with the product.
