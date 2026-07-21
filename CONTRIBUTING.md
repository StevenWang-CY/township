# Contributing to Township

Thanks for being here. Township runs on three kinds of contributions — personas,
scenarios, and engine/frontend work — and the first one needs no Python at all.
Everything below assumes a fresh clone and zero API keys: the deterministic mock
provider means the whole project runs end to end without credentials.

One document outranks this one: [`RESPONSIBLE_USE.md`](RESPONSIBLE_USE.md). Read
it before touching anything election-facing, and know its bright line — residents
are fictional composites, never real private individuals.

## Dev setup

You need Python ≥ 3.11 and Node 20 (CI runs Python 3.11/3.12, Node 20).

```bash
make install    # pip install -e ".[dev]" + frontend npm install
make dev        # backend on :8001 + Vite on :5173 together
make test       # pytest (offline, mock provider) + npx tsc --noEmit
make lint       # ruff over backend/ and tests/
```

`make dev-backend` / `make dev-frontend` run one side alone, and `make format`
auto-fixes what `make lint` complains about. `make install` also puts the
`township` CLI on your path (`township --help` lists
`serve | run | replay | scenarios | new-scenario | new-agent`).

Two environment variables steer everything: `LLM_PROVIDER=mock` forces the
zero-key deterministic provider (unset, the factory auto-detects from whichever
API key is present and falls back to mock — loudly), and `SCENARIO=<id>` picks
the scenario package (default `nj11-2026`; `millbrook-budget` also ships).

## Your first PR: add a persona

Adding a resident is the golden path — it's a single Markdown file, the tests
tell you when you're done, and every town has room for one more voice.

1. **Pitch first.** Open a
   [new persona issue](.github/ISSUE_TEMPLATE/new_persona.yml) — one paragraph on
   who they are and what tension they carry. You'll get feedback on what gap the
   town actually needs filled before you've invested an evening.

2. **Scaffold the file.** Either:

   ```bash
   township new-agent millbrook-budget harlow-crossing --name "Priya Nair"
   ```

   which creates `scenarios/millbrook-budget/agents/harlow-crossing/priya-nair.md`
   with valid frontmatter and prints the legal `initial_lean` values — or copy
   the fully annotated example from
   [`docs/persona-template.md`](docs/persona-template.md).

3. **Write the resident.** [`docs/persona-authoring.md`](docs/persona-authoring.md)
   is the guide: every frontmatter field, how the engine uses routines,
   relationships, idle thoughts, and per-round goals, and the craft that
   separates a neighbor from a demographic. The short version: distinct voice,
   genuine ambivalence, concrete local anchors, bidirectional relationships.

4. **Run the lint.** The persona lint checks every scenario's agents — parseable
   frontmatter, `initial_lean` on the stance roster, relationship targets that
   resolve, routine locations that name real landmarks:

   ```bash
   python3 -m pytest tests/test_persona_lint.py -q
   ```

5. **Watch them live.** No keys needed:

   ```bash
   township serve --scenario millbrook-budget --provider mock
   make sim        # in another shell — or: township run --scenario millbrook-budget --provider mock
   ```

   If your resident sounds like their neighbor, you'll hear it immediately.

6. **Open the PR.** The template's persona checklist is the review bar:
   `make test` passes, relationships are bidirectional, the voice survives the
   swap test, and the resident is a fictional composite written with empathy.

## Scenario contributions

Everything domain-specific — the question, options, towns, personas, news beats,
round plan — lives in a scenario package under `scenarios/<id>/`, never in code.
[`docs/scenario-format.md`](docs/scenario-format.md) documents the whole format,
with the two shipped packages as reference implementations.
`township new-scenario <id>` scaffolds a minimal package that loads and lints out
of the box, and `township scenarios` lists what's installed. Pitch bigger ideas
with the [new scenario issue template](.github/ISSUE_TEMPLATE/new_scenario.yml).
If you catch yourself hardcoding a candidate, town, or news beat inside
`backend/`, stop — it belongs in the package.

## Engine and frontend PRs

Run `make lint` and `make test` before pushing; CI runs the same ruff, pytest,
and `tsc --noEmit` you have locally, plus a zero-key smoke run. All backend tests
run offline against the mock provider — new tests should too.

The one contract to respect: the backend and frontend share a WebSocket wire
format. Event `type` literals live in `backend/core/types.py` and their DTO
shapes in `backend/core/wire.py`; the frontend mirrors both in
`frontend/src/types/messages.ts` and the `useWebSocket` reducer.
`tests/test_wire_contract.py` guards the pairing, so never rename an event field
casually — change both sides in the same PR and run the test. UI changes get a
screenshot or short clip in the PR (before/after if you're replacing something).

Secrets only ever travel via environment variables (`ANTHROPIC_API_KEY`,
`AWS_BEARER_TOKEN_BEDROCK`, `OPENAI_API_KEY`, …) — never commit a key or write
one into a tracked file.

## Commit style

Match the history: a short, plain-language subject line, capitalized, no trailing
period, often with an area prefix —

```
Scenario engine: any election or civic question, NJ-11 becomes a data package
Township: stop Phaser from eating WASD when typing in chat
```

Say what changed and why it matters in the subject; put the how in the body if it
needs one. Branch from `main`; PRs target `main`.

## Where to ask questions

- **Bugs and ideas** — [GitHub issues](https://github.com/StevenWang-CY/township/issues);
  there are templates for bug reports, feature requests, personas, and scenarios.
- **Security** — privately, per [`SECURITY.md`](SECURITY.md). Never in a public issue.
- **Misuse of Township** — see the reporting section of
  [`RESPONSIBLE_USE.md`](RESPONSIBLE_USE.md).
- **Conduct** — [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) covers community
  standards, including how political topics are handled in this repo.

Not sure where something fits? Open an issue and ask — a wrong guess in an issue
costs nothing.
