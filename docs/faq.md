# FAQ

### Is this a poll?

No. This is the one answer that matters most, so here is the disclaimer that ships
with Township, quoted from [RESPONSIBLE_USE.md](../RESPONSIBLE_USE.md). The core
notice is fixed; each package supplies more precise resident, subject, and output
lines that remain visible in the UI and travel with its exported runs:

> **Township is a simulation, not a poll.** Its outputs do not measure real public opinion and must never be presented as if they do.
> **The residents are fictional composites**, informed by public demographic data. No real resident is depicted.
> **Real public figures are represented through public source material**, summarized where necessary; verify the scenario's cited sources before relying on any claim.
> **Every output is an LLM artifact**, shaped by who wrote the personas and by the model's own biases.

If you fork or deploy Township, keep it visible. Read the rest of
[RESPONSIBLE_USE.md](../RESPONSIBLE_USE.md) for intended uses, prohibited uses, and
the project's design commitments.

### How much does a simulation cost?

It depends on cast size, round plan, provider, model, output length, retries, and
whether the provider accepts a prompt-cache read. Treat a pre-run estimate as a
budget ceiling, not a quote.

There is one concrete reference point in the repository. The shipped NJ-11
retrospective ran 26 fictional residents through five rounds and produced 883
events with zero failed agents. The committed cache reports:

| Meter | Recorded value |
|---|---:|
| Model calls | 405 |
| Metered token units | 1,501,405 |
| Cache reads / writes | 0 / 1,016,470 tokens |
| Cost when the district summary finalized | $7.3192 |
| Final provider usage, after the narrative recap call | **$7.3298** |

That is the cost of one specific July 21, 2026 Bedrock/Claude run, not a promise
about what another model or provider will charge. The exact artifact is
[`scenarios/nj11-2026/demo/simulation_cache.json`](../scenarios/nj11-2026/demo/simulation_cache.json),
and its interpretation and limitations are documented in the
[NJ-11 retrospective](nj11-retrospective.md).

That run is also why whole-system-block prompt caching is **off by default**. The
system prompt carries changing memories, stance, and round goals; this artifact paid
for cache writes and received no cache reads. `BEDROCK_CACHE_SYSTEM=1` or
`ANTHROPIC_CACHE_SYSTEM=1` is an experimental opt-in for workloads that prove a
different pattern. `GET /api/simulation/status` reports cache reads, writes, tokens,
and dollars, while `township run` prints final usage. Use the mock, replay, or a
local model while iterating, then run a single town or fewer rounds before paying
for a full scenario.

### Can I run it completely free?

Yes, three ways:

1. **Mock provider** — `township run --provider mock` runs the whole pipeline on a
   deterministic zero-key mock. `LLM_PROVIDER=mock make dev` does the same through
   the visual app. Conversations are template-generated, but every phase, event,
   and chart works. All backend tests run this way.
2. **Replay** — `POST /api/simulation/replay` (or `township replay --run-id ...`)
   streams a cached run through the WebSocket. Zero LLM calls, identical UI.
3. **Local models** — `LLM_PROVIDER=ollama` (default model `llama3.1`, base URL
   `http://localhost:11434/v1`) or `LLM_PROVIDER=lmstudio` run against your own
   hardware. Township reports $0.00 in API charges for these providers; that does
   not account for hardware, electricity, or hosted local-model infrastructure.

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

Anything your chosen provider serves through the adapter's API shape. The cost
catalog knows selected Claude and OpenAI model families. Unknown OpenAI-compatible
and local models report $0.00; unknown Anthropic-family ids use Township's Sonnet
catalog rate as an estimate. Neither result is a provider quote. Verify current
provider pricing before a paid run. Each
provider has a model env override (`BEDROCK_MODEL_ID`, `ANTHROPIC_MODEL`, `OPENAI_MODEL`,
`OPENROUTER_MODEL`, `OLLAMA_MODEL`, `LMSTUDIO_MODEL`). A persona may optionally pin
its own model with a `model:` key in frontmatter, but shipped personas leave that
unset so provider configuration behaves predictably. A custom scenario can still
run one town on Haiku and another on Sonnet by pinning selected residents.

The source development install and Docker image include the optional OpenAI client.
If you installed only the Python wheel, run `pip install 'township[openai]'` before
selecting OpenAI, OpenRouter, Ollama, or LM Studio.

### How long does a simulation take?

On the mock provider: seconds. A full 26-agent district run capped at 3 rounds
completed in about 8 seconds and made 251 LLM calls — which is the number that
matters, because on a real provider wall time is just call count × model latency ÷
concurrency (calls are capped at 10 in flight by default, configurable with
`LLM_MAX_CONCURRENT`). With a
hosted Claude model expect a full 5-round NJ-11 run to take on the order of tens of
minutes. Demos should replay a cached run instead — instant start, zero cost.

### Do agents remember talking to me?

Yes, privately. The *relationship* — a trust score from −100 to 100, encounter count,
topics discussed, and the bounded profile details you supplied — persists to
`data/state/relationships.json` and changes how the agent treats your next authorized
chat, from terse and guarded to warm and personal. The journal (`/api/journal`) keeps
the transcript you choose to save. Both stores require a random browser-held
capability; only its SHA-256 digest reaches disk.

The digest binding is durable before the first private record is written, and each
private mutation reaches disk before its endpoint returns success. Corrupt capability,
relationship, or journal state locks these routes closed instead of exposing an empty
store. On upgrade, rows created before capabilities existed cannot be securely
assigned to a browser: Township removes them from the active files and keeps a local,
API-inaccessible `*.legacy-unbound.json` quarantine for operator review.

Private chat text is deliberately not appended to shared agent memory, persisted in
run artifacts, broadcast over WebSocket, or used to change the shared simulation
opinion. `opinion_changed` comes from public simulation phases and transparent God's
View interventions. This avoids letting one viewer silently alter every other
viewer's world.

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

All deliberation content lives in a scenario package under `scenarios/<id>/` —
towns, personas, options, news beats, God's View presets. Every town gets the
scenario-neutral procedural renderer; authored pixel art is an explicit town-level
adapter. Scaffold one:

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

For authored art, run the scenario-aware builder:

```bash
python3 -m scripts.mapgen.build_maps --scenario <scenario> --town <town> --preview
```

Then declare the exact scenario-qualified paths
`assets/maps/<scenario>/<town>.tmj` and
`assets/maps/<scenario>/<town>-preview.png` in the town's `map` block. Hand-tuned
Python layouts use underscore-normalized ids under
`scripts/mapgen/layouts/<scenario_with_underscores>/<town_with_underscores>.py`; see the
[map-generation guide](../scripts/mapgen/README.md).

### Do I have to simulate elections?

No. The engine deliberates any civic question. The repo ships `millbrook-budget` — a
fictional two-town vote on a budget question — precisely to prove nothing about
elections is hardcoded. `scenario.json`'s `kind` field distinguishes `election` from
`vote`, and the options can be candidates, budget lines, or anything a town could
argue about.

### Can I save and share a run?

Persistence is best-effort so a storage failure cannot retroactively fail a completed
deliberation. On success, one complete `runs/<run_id>/` appears atomically with a
summary and full public event log; the narrative recap is optional.
`GET /api/runs/{run_id}/export` downloads a self-contained JSON bundle, and the receiving
side can replay it with `POST /api/simulation/replay` — the full pixel-town playback,
no LLM calls.

Current artifacts carry explicit schema and privacy versions. Township hides/refuses
unversioned runs and caches because old player chat can be embedded in ordinary-looking
public prose that event-type filtering cannot identify. Regenerate old artifacts;
never make them shareable by adding version fields manually. When a recap exists,
`GET /api/simulation/recap` returns its Markdown story and headline.

### Can I run just one town?

Yes — cheaper and faster for iteration. `TOWN=dover make sim`,
`township run --town dover --rounds 3`, or `POST /api/simulation/start` with
`{"town": "dover", "rounds": 3}`.

### What's the license, and whose art is this?

Township's code and original visual additions are MIT-licensed (see
[LICENSE](../LICENSE)). Third-party character sheets come from Stanford's
Generative Agents ("Smallville"); the RPG tilesheet comes through AI Town from
hilau, George Bailey, bluecarrot16, and earlier LPC contributors; and the player
sprite is credited to ansimuz. These assets keep their Apache-2.0, CC BY-SA 3.0,
CC0, or MIT terms as applicable. [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)
contains the file-by-file inventory, source links, attribution chain,
modification notices, and known provenance qualifications.

### I saw Township being misused. Where do I report it?

If you see a Township output presented as a real poll, an astroturfing operation, or
a persona of a real private person — the project wants to know. Report privately via
[GitHub security advisories](https://github.com/StevenWang-CY/township/security/advisories/new)
for anything sensitive, or open a
[GitHub issue](https://github.com/StevenWang-CY/township/issues) for anything
public. [RESPONSIBLE_USE.md](../RESPONSIBLE_USE.md) spells out what counts as
misuse; the project commits to responding, publicly where warranted.
