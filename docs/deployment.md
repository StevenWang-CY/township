# Deployment

Township runs three ways: bare-metal for development, a single Docker container for
demos and small deployments, and docker-compose for containerized development. All
three work with **zero API keys** thanks to the deterministic mock provider — add
credentials only when you want real LLM deliberation. (The two Docker paths
currently need a one-line Dockerfile fix first — see the known gap under
[Docker](#docker--single-container).)

## Local development

```bash
make install   # pip install -e ".[dev]" + frontend npm install
make dev       # backend on :8001 + Vite on :5173; Ctrl-C stops both
```

Open http://localhost:5173. The Vite dev server proxies `/api` to
`http://localhost:8001` and `/ws` to `ws://localhost:8001` (see
`frontend/vite.config.ts`), so the browser only ever talks to :5173.

One side at a time: `make dev-backend` (uvicorn with auto-reload; `PORT=9000 make
dev-backend` to move it) or `make dev-frontend`. The zero-key path is `make demo`
(mock provider; serves `frontend/dist` at `/` if you've run `make build`), then
`make sim` to kick off a run — `TOWN=dover make sim` for a single town.

There's also a console script, installed by `make install`:

```bash
township serve --port 8001 --provider mock   # same server, CLI flags for SCENARIO/LLM_PROVIDER
township run --scenario millbrook-budget --provider mock   # headless run, prints the recap
```

## Environment variables

Copy `.env.example` to `.env` and fill in what you need. Everything is
**server-side** — never prefix these with `VITE_`; the frontend never sees them.

| Variable | Default | Purpose |
|---|---|---|
| `LLM_PROVIDER` | auto-detect | Force a provider: `bedrock`, `anthropic`, `openai`, `openrouter`, `ollama`, `lmstudio`, `mock`. Unset, the factory picks from whichever key is present and falls back to mock — loudly |
| `SCENARIO` | `nj11-2026` | Which scenario package under `scenarios/` to load (`millbrook-budget` also ships) |
| `AWS_BEARER_TOKEN_BEDROCK` | — | Bedrock API key (bearer-token auth); the standard AWS credential chain (SigV4) is the fallback |
| `AWS_REGION` | `us-east-2` | Region hosting the Bedrock cross-region inference profile |
| `BEDROCK_MODEL_ID` | `us.anthropic.claude-sonnet-4-5-20250929-v1:0` | Bedrock model override |
| `BEDROCK_CACHE_SYSTEM` | `1` | Prompt caching on the persona system block (~85% cheaper repeated input); `0` disables |
| `ELEVENLABS_API_KEY` | — | Server-side TTS proxy for `POST /api/tts`; absent → 503 `tts_unavailable` |
| `OPENAI_API_KEY` | — | Whisper speech-to-text for `POST /api/transcribe`; also auto-selects the `openai` chat provider if it's the only key set |
| `ALLOWED_ORIGINS` | `http://localhost:5173,http://localhost:4173,http://localhost:3000` | Comma-separated CORS allow-list for browser clients |

### Provider matrix

Auto-detection order when `LLM_PROVIDER` is unset: `ANTHROPIC_API_KEY` → anthropic,
`AWS_BEARER_TOKEN_BEDROCK` → bedrock, `OPENAI_API_KEY` → openai,
`OPENROUTER_API_KEY` → openrouter, else **mock** (with a loud log warning).

| `LLM_PROVIDER` | Credentials | Model env (default) | Extra knobs |
|---|---|---|---|
| `bedrock` | `AWS_BEARER_TOKEN_BEDROCK` or AWS credential chain | `BEDROCK_MODEL_ID` (Claude Sonnet 4.5) | `AWS_REGION`, `BEDROCK_CACHE_SYSTEM` |
| `anthropic` | `ANTHROPIC_API_KEY` | `ANTHROPIC_MODEL` (`claude-sonnet-4-5`) | prompt caching on the system block |
| `openai` | `OPENAI_API_KEY` | `OPENAI_MODEL` (`gpt-4.1-mini`) | `OPENAI_BASE_URL` for any OpenAI-compatible host |
| `openrouter` | `OPENROUTER_API_KEY` | `OPENROUTER_MODEL` (`anthropic/claude-sonnet-4.5`) | `OPENROUTER_BASE_URL` |
| `ollama` | none | `OLLAMA_MODEL` (`llama3.1`) | `OLLAMA_BASE_URL` (`http://localhost:11434/v1`) |
| `lmstudio` | none | `LMSTUDIO_MODEL` (`local-model`) | `LMSTUDIO_BASE_URL` (`http://localhost:1234/v1`) |
| `mock` | none | — | `MOCK_DELAY_S` per-call pacing (default `0.05`; `0` for headless speed) |

**Ollama recipe** — fully local, fully free:

```bash
ollama pull llama3.1
LLM_PROVIDER=ollama OLLAMA_MODEL=llama3.1 make dev-backend
# Ollama on another machine? Point at it:
LLM_PROVIDER=ollama OLLAMA_BASE_URL=http://192.168.1.20:11434/v1 make dev-backend
```

## Docker — single container

The `Dockerfile` is a two-stage build: stage 1 compiles the React/Phaser frontend,
stage 2 installs the FastAPI backend and copies `frontend/dist` in next to it. At
runtime one process serves everything — the API under `/api`, the WebSocket at `/ws`,
and the built frontend at `/` (FastAPI mounts `frontend/dist` with an SPA fallback
whenever the directory exists).

```bash
docker build -t township .          # or: make docker
docker run -p 8000:8000 -e LLM_PROVIDER=mock township
```

Open http://localhost:8000 — the whole app, one container, zero keys. For a real
provider, pass the credentials through:

```bash
docker run -p 8000:8000 \
  -e AWS_BEARER_TOKEN_BEDROCK=... -e AWS_REGION=us-east-2 township
```

**What's baked in:** the installed backend package, the built frontend, and the
runtime content the image copies (`agents/` and `data/`; `tests/` is deliberately
excluded).

> **Known gap:** the Dockerfile predates the scenario engine. It still runs
> `COPY agents/ agents/`, and a current checkout has no top-level `agents/`
> directory anymore — so `docker build` **fails as-is**. To build today, replace
> the legacy `COPY agents/` line with `COPY scenarios/ scenarios/` (the comment
> inside the Dockerfile marks exactly where it goes).

## docker-compose — containerized dev

```bash
docker compose up                          # mock provider, zero keys
LLM_PROVIDER=bedrock docker compose up     # real LLM (export creds first)
```

Compose builds the same image, so the Dockerfile known gap above applies here
too — apply the one-line `COPY` fix first. What you get (`docker-compose.yml`):

- **backend** — the production image, but running `uvicorn --reload` on :8001 with
  `./backend` and `./data` live-mounted, so edits hot-reload inside the container.
  `LLM_PROVIDER` defaults to `mock`; `AWS_BEARER_TOKEN_BEDROCK`, `AWS_REGION`, and
  `BEDROCK_MODEL_ID` pass through from your shell.
- **frontend** — a plain `node:20` container running `npm install && npm run dev
  --host`. It shares the backend's network namespace (`network_mode:
  "service:backend"`), which is why *both* :8001 and :5173 are published on the
  backend service and why Vite's proxy target `http://localhost:8001` resolves
  correctly. Its `node_modules` live in a named volume so Linux binaries never
  clobber a macOS host install.

Open http://localhost:5173 for the dev UI, :8001 for the raw API.

## Static demo (GitHub Pages)

A keyless, backend-free build of the frontend that replays the recorded demo
caches — no server, no API keys:

```bash
make demo-build     # npm run demo:build → frontend/dist-demo
make demo-preview   # serve it locally
```

`demo:build` first runs `frontend/scripts/stage-demo.mjs`, which stages every
`scenarios/<id>/demo/simulation_cache.json` (plus a `GET /api/scenario`-shaped
bootstrap payload per scenario and a `manifest.json`) into `frontend/public/demo/`,
then builds with `VITE_DEMO_MODE=1`. In demo mode the WebSocket provider is swapped
for the recorded event feed and backend-only affordances (chat, mic, TTS, God's
View injection) become pointers at the local install; `?scenario=<id>` switches
between staged scenarios at runtime. `.github/workflows/pages.yml` deploys
`frontend/dist-demo` to GitHub Pages on every push to `main`.

For a zero-key walkthrough with the live backend features intact, use
`make build && make demo` instead: the mock-provider server plus
`POST /api/simulation/replay` on any machine.

## Reverse proxy

If you put nginx/Caddy/Traefik in front of Township, remember the WebSocket:
`/ws` needs the HTTP Upgrade headers forwarded or the live event stream silently
dies while REST keeps working. nginx example:

```nginx
location /ws {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;   # simulations stream for a while
}
location / {
    proxy_pass http://127.0.0.1:8000;
}
```

Also set `ALLOWED_ORIGINS` to your public origin (e.g.
`ALLOWED_ORIGINS=https://township.example.org`) — the default list only allows
localhost dev ports. And remember: the API itself has no auth. If the instance is
reachable beyond your machine, put your proxy's auth (basic auth, OAuth proxy,
VPN) in front of it, or anyone can start simulations and chat on your API bill.

## Cost guardrails

- **Concurrency cap.** Every provider wraps its calls in an
  `asyncio.Semaphore(max_concurrent)`; the app builds its provider with
  `max_concurrent=10` (`backend/main.py`), so no matter how many towns run in
  parallel, at most 10 LLM calls are in flight.
- **Live usage accounting.** Every provider tracks tokens and dollars via a shared
  `UsageTracker` priced from the `MODEL_COSTS` catalog in
  `backend/providers/base.py`. The running report — total tokens, cache hits, cost,
  call count — is exposed on `GET /api/health` and `GET /api/simulation/status`, and
  persists into each run's `summary.json`. Watch it mid-run:

  ```bash
  curl -s localhost:8001/api/simulation/status | python3 -c \
    "import json,sys; print(json.load(sys.stdin)['usage'])"
  ```

- **Prompt caching.** On Bedrock and the Anthropic API, the persona system block is
  cached (`BEDROCK_CACHE_SYSTEM=1` by default), cutting repeated-call input cost by
  roughly 85%.
- **Replay is free.** Demos should replay cached runs (`POST /api/simulation/replay`,
  `township replay`) — zero LLM calls, identical event stream. Save the live calls
  for chat and God's View, which are the genuinely interactive parts.
