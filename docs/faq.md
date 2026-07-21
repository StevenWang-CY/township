# FAQ

### Is this a poll?

No. This is the one answer that matters most, so here is the disclaimer that ships
with Township — in the UI, in exported outputs, and in every scenario — quoted
verbatim from [RESPONSIBLE_USE.md](../RESPONSIBLE_USE.md):

> **Township is a simulation, not a poll.** Its outputs do not measure real public opinion and must never be presented as if they do.
> **The residents are fictional composites**, informed by public demographic data. No real resident is depicted.
> **The candidates are real public figures**; their positions are quoted from cited public sources, not invented.
> **Every output is an LLM artifact**, shaped by who wrote the personas and by the model's own biases.

If you fork or deploy Township, keep it visible. Read the rest of
[RESPONSIBLE_USE.md](../RESPONSIBLE_USE.md) for intended uses, prohibited uses, and
the project's design commitments.

### How much does a simulation cost?

With the default setup (Claude Sonnet 4.5 — $3/M input, $15/M output tokens, the
same pricing in the `MODEL_COSTS` catalog in `backend/providers/base.py`), the
README's estimates:

| Activity | Est. cost |
|---|---|
| Dev testing (Dover only, 3 rounds) | ~$0.50 |
| Full simulation (26 agents, 5 rounds) | ~$3.50 |
| Demo chat (~20 exchanges) | ~$0.50 |
| God's View (3 injections) | ~$1.00 |
| **Full demo session** | **~$7.50** |

Prompt caching on the persona system block is on by default and cuts repeated-call
input cost by roughly 85% — the full-simulation figure assumes it. You never have to
guess: `GET /api/simulation/status` reports live token counts and dollars mid-run,
and `township run` prints the final cost when it finishes.

### Can I run it completely free?

Yes, three ways:

1. **Mock provider** — `make demo` (or `LLM_PROVIDER=mock` anywhere) runs the whole
   pipeline on a deterministic zero-key mock. Conversations are canned but every
   phase, event, and chart works. All backend tests run this way.
2. **Replay** — `POST /api/simulation/replay` (or `township replay --run-id ...`)
   streams a cached run through the WebSocket. Zero LLM calls, identical UI.
3. **Local models** — `LLM_PROVIDER=ollama` (default model `llama3.1`, base URL
   `http://localhost:11434/v1`) or `LLM_PROVIDER=lmstudio` run against your own
   hardware. Local models are priced at $0.00 in the cost catalog because that's
   what they cost.

### Does it need AWS?

No. Bedrock is one of seven providers. `LLM_PROVIDER` accepts `bedrock`,
`anthropic`, `openai`, `openrouter`, `ollama`, `lmstudio`, and `mock`; left unset,
the factory auto-detects from whichever API key is present (`ANTHROPIC_API_KEY`,
`AWS_BEARER_TOKEN_BEDROCK`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`) and falls back
to the mock. See the provider matrix in [deployment.md](deployment.md).

### What happens if I have no API keys at all?

It runs. The provider factory falls back to the deterministic mock — loudly, with a
log warning telling you exactly which env vars would change that. A fresh clone goes
end to end with zero credentials; this is a deliberate invariant, enforced nightly
by CI (`.github/workflows/smoke.yml`).

### What models work?

Anything your chosen provider serves. The cost catalog knows Claude Sonnet 4.5,
Opus 4.1, and Haiku 4.5, plus the GPT-4.1 and GPT-4o families; unknown models simply
cost $0.00 in the report (that's how local models are handled). Each provider has a
model env override (`BEDROCK_MODEL_ID`, `ANTHROPIC_MODEL`, `OPENAI_MODEL`,
`OPENROUTER_MODEL`, `OLLAMA_MODEL`, `LMSTUDIO_MODEL`), and each persona can pin its
own model with a `model:` key in its frontmatter (default `claude-sonnet-4-5`) — so
one town could deliberate on Haiku while another runs Sonnet.

### How long does a simulation take?

On the mock provider: seconds. A full 26-agent district run capped at 3 rounds
completed in about 8 seconds and made 251 LLM calls — which is the number that
matters, because on a real provider wall time is just call count × model latency ÷
concurrency (calls are capped at 10 in flight by the provider semaphore). With a
hosted Claude model expect a full 5-round NJ-11 run to take on the order of tens of
minutes. Demos should replay a cached run instead — instant start, zero cost.

### Do agents remember talking to me?

Yes, in three layers. Chats are appended to the agent's in-memory stream, so later
conversations and opinion checks can reference them (this layer resets on server
restart). The *relationship* — a trust score from −100 to 100, encounter count,
topics discussed, and whatever you've revealed about yourself — persists to
`data/state/relationships.json` across restarts, and trust changes how the agent
treats you, from terse and guarded to warm and personal. Finally, the journal
(`/api/journal`) keeps full transcripts per player. Chats can genuinely move an
agent's opinion: each exchange triggers a re-evaluation, and a changed stance is
published as an `opinion_changed` event for every connected client to see.

### How accurate was the NJ-11 simulation?

The flagship scenario revisits New Jersey's April 2026 special election — and it was
published only after the results were certified, as a retrospective, per the
project's responsible-use commitments. The interesting part isn't a single
headline number but *where* the simulated deliberation tracked reality and where it
diverged — which towns it read well, which dynamics (sycophancy, consensus drift,
turnout blindness) pulled it off course, and what that says about LLM agents as a
lens on deliberation. The full written error analysis against the certified
results is [nj11-retrospective.md](nj11-retrospective.md) — a town-by-town
side-by-side of the shipped demo run and the official numbers.

### Why are personas Markdown files?

Because a persona is prose, and prose belongs in a text file, not a database. Each
resident is one `.md` file — YAML frontmatter for structured facts (age, occupation,
registration, initial lean, concerns, daily routine, relationships), Markdown body
for the voice: history, worries, and what would change their mind. That makes
personas git-trackable and diffable, editable without touching code, reviewable by
non-programmers, and honest — you can read exactly who the author decided this
person is. The richer the file, the better the deliberation.

### How do I add a town or a whole new scenario?

Everything domain-specific lives in a scenario package under `scenarios/<id>/` —
towns, personas, options, news beats, God's View presets. Never in code. Scaffold
one:

```bash
township new-scenario my-town-vote      # loadable package with 1 town, 2 residents
township new-agent my-town-vote townsville --name "Jane Doe"
township run --scenario my-town-vote --provider mock   # smoke it, free
SCENARIO=my-town-vote make dev                          # play it in the UI
```

Adding a town to an existing scenario is a `towns/<id>.json` file (landmarks,
demographics, accent color), a directory of personas under `agents/<town>/`, and the
town id in `scenario.json`'s `town_order`. The full format — round plans, news
beats, option files, context extras — is specified in
[scenario-format.md](scenario-format.md).

### Do I have to simulate elections?

No. The engine deliberates any civic question. The repo ships `millbrook-budget` — a
fictional two-town vote on a budget question — precisely to prove nothing about
elections is hardcoded. `scenario.json`'s `kind` field distinguishes `election` from
`vote`, and the options can be candidates, budget lines, or anything a town could
argue about.

### Can I save and share a run?

Every completed simulation persists to `runs/<run_id>/` (summary, full event log,
narrative recap). `GET /api/runs/{run_id}/export` downloads the whole thing as one
self-contained JSON bundle, and the receiving side can replay it with
`POST /api/simulation/replay` — the full pixel-town playback, no LLM calls. The
recap (`GET /api/simulation/recap`) is a Markdown story of the run, headline
included.

### Can I run just one town?

Yes — cheaper and faster for iteration. `TOWN=dover make sim`,
`township run --town dover --rounds 3`, or `POST /api/simulation/start` with
`{"town": "dover", "rounds": 3}`.

### What's the license, and whose art is this?

Township's code is MIT-licensed (see [LICENSE](../LICENSE)). The pixel art is not
ours: character spritesheets come from Stanford's Generative Agents ("Smallville")
project and the tileset from a16z's ai-town, vendored under their original licenses.
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) lists exactly which files came
from where, verified against the upstream repositories.

### I saw Township being misused. Where do I report it?

If you see a Township output presented as a real poll, an astroturfing operation, or
a persona of a real private person — the project wants to know. Report privately via
[GitHub security advisories](https://github.com/StevenWang-CY/township/security/advisories/new)
for anything sensitive, or open a
[GitHub issue](https://github.com/StevenWang-CY/township/issues) for anything
public. [RESPONSIBLE_USE.md](../RESPONSIBLE_USE.md) spells out what counts as
misuse; the project commits to responding, publicly where warranted.
