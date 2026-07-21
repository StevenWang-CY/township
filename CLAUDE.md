# CLAUDE.md — Township

Township is a civic deliberation engine: AI residents deliberate elections and policy
questions in a living pixel town. A FastAPI backend runs multi-round simulations
(phases: seed → converse → news → opinion → decide) and streams events over WebSocket
to a React + Phaser 3 frontend. Everything domain-specific — towns, personas, options,
news beats — lives in a *scenario package* under `scenarios/<id>/`, never in code.
LLM calls go through a provider abstraction (`backend/providers/`) that includes a
deterministic zero-key mock, so a fresh clone runs end to end with no credentials.

## Key directories

| Path | What lives there |
|------|------------------|
| `backend/core/` | Pydantic types, scenario loader (`scenario.py`), persona loader, event bus, wire DTOs (`wire.py`) |
| `backend/simulation/` | `round_manager.py` (the core loop), `orchestrator.py` (multi-town parallel), `replay.py` |
| `backend/providers/` | `base.py` interface, `factory.py` selection, bedrock / anthropic / openai-compat / mock backends |
| `backend/routes/` | REST + WS routers: simulation, chat, gods_view, scenario, towns, journal, transcribe, tts |
| `scenarios/<id>/` | `scenario.json`, `towns/*.json`, `options/*.json`, `agents/<town>/*.md`, `context/*.json`, `god-scenarios.json` |
| `frontend/src/game/` | Phaser: `TownScene.ts`, `AgentSprite.ts`, world clock, weather, routines |
| `frontend/src/components/`, `hooks/` | React UI (TownView, Dashboard, GodsView, ChatPanel) and the WS/REST hooks |
| `scripts/mapgen/` | Named-GID tile registry + validators for the vendored ai-town tileset |
| `tests/` | Backend contract tests — all run offline against the mock provider |

## Commands

- `make install` — `pip install -e ".[dev]"` + frontend `npm install`
- `make dev` — backend on :8001 + Vite on :5173; `make dev-backend` / `make dev-frontend` for one side
- `make test` — `pytest -q` plus `npx tsc --noEmit`; no API keys needed
- `make lint` / `make format` — ruff over `backend` and `tests`
- `make demo` — zero-key server via the mock provider; then `make sim` starts a run (`TOWN=dover` for one town)
- `LLM_PROVIDER=mock` forces the deterministic mock anywhere (valid values: bedrock, anthropic, openai, openrouter, ollama, lmstudio, mock); unset, the factory auto-detects from whichever API key is present and falls back to mock — loudly
- `SCENARIO=<id>` selects the scenario package (default `nj11-2026`; `millbrook-budget` also ships)

## Invariants — do not break

1. **Wire contract.** Event `type` literals in `backend/core/types.py` and the DTO shapes in `backend/core/wire.py` must match `frontend/src/types/messages.ts` and the `useWebSocket` reducer. `tests/test_wire_contract.py` guards this — never rename an event field casually; change both sides together and run the test.
2. **Scenario data lives in `scenarios/`, not code.** If you find yourself hardcoding a candidate, town, or news beat inside `backend/`, stop and put it in the scenario package instead.
3. **Secrets only via env** (`ANTHROPIC_API_KEY`, `AWS_BEARER_TOKEN_BEDROCK`, `OPENAI_API_KEY`, …). Never commit a key or write one into a tracked file.

## More docs

`docs/README.md` indexes the documentation. Read `RESPONSIBLE_USE.md` before changing anything election-facing — the simulation-not-a-poll disclaimer ships with the product.
