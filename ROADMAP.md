# Township roadmap

Township v0.1 establishes the complete loop: scenario packages, fictional
residents with memory and relationships, multi-round deliberation, a typed event
stream, a living pixel frontend, live and recorded runs, seven provider modes,
and a deterministic zero-key path. The next chapters are about making the engine
more rigorous, more authorable, and more useful for research without pretending
that synthetic residents are a substitute for real people.

This roadmap is directional, not a release promise. Milestones will be shaped in
[GitHub issues](https://github.com/StevenWang-CY/township/issues) before code lands.
The [Responsible Use policy](RESPONSIBLE_USE.md) is a design constraint for every
item below.

## Shipped in v0.1

- Generic scenario packages: elections and non-election civic choices use the
  same engine; no town, person, or option is hardcoded in backend logic.
- Configurable `seed → converse → news → opinion → decide` round plans, parallel
  towns, cross-town relationships, daily routines, time, and weather.
- One typed event contract across live WebSocket runs, persisted JSON artifacts,
  terminal replay, and the static browser replay player.
- Bedrock, Anthropic, OpenAI, OpenRouter, Ollama, LM Studio, and deterministic mock
  providers behind a narrow, metered interface.
- Pixel town maps, distinct resident art, pair personas, chat, trust, journal,
  dashboard, God's View presets, accessibility settings, and replay controls.
- Automated, fixed-seed product-media capture plus an in-town debug overlay for
  simulation time, activity, wire events, connection state, and frame timing.
- `township` CLI scaffolds scenarios and residents, runs simulations headlessly,
  and replays saved work; offline tests validate scenarios, personas, providers,
  and the backend/frontend wire contract.
- Two end-to-end examples: fictional `millbrook-budget` and retrospective
  `nj11-2026`, including a fully disclosed real-model replay and error analysis.

## v0.2 — Reproducible experiment workbench

The first priority is turning a compelling run into a defensible set of runs.

- **Experiment manifests.** Record provider, resolved model, model parameters,
  scenario content hash, seed, concurrency, code version, and run parentage in
  every artifact.
- **Batch and repeated-run CLI.** Run the same scenario across seeds or providers,
  cap spend before launch, resume interrupted batches, and export one tidy dataset.
- **Run comparison.** Diff stance trajectories, issue salience, conversation
  networks, errors, token usage, and cost—not only final character states.
- **Evaluation harness.** Measure test-retest stability, persona sensitivity,
  consensus drift, option-order effects, and intervention sensitivity with
  documented metrics and confidence intervals over runs.
- **Schema versioning.** Version scenario packages and event logs, publish
  migrations, and keep old replays loadable as the wire evolves.
- **Provenance in the UI.** Make scenario sources, persona authorship, model/run
  metadata, and the simulation disclaimer one click away from every chart.
- **Deterministic fault injection.** Reproduce provider timeouts, malformed tool
  calls, partial-town failure, and reconnect behavior for reliability testing.

## v0.3 — Deeper social dynamics

- **Conversation topology controls.** Let authors choose homophily, bridge ties,
  geography, schedule overlap, and deliberate cross-group encounters instead of
  relying on one pairing strategy.
- **Relationship-aware dialogue.** Make history, trust, disagreement, and social
  role affect who meets, what they share, and what they withhold; expose the
  resulting network rather than hiding it in prompts.
- **Memory experiments.** Compare bounded recency, authored durable memories, and
  optional retrieval-backed memory under the same evaluation harness before
  adding infrastructure by default.
- **Richer civic spaces.** Support public meetings and multi-party conversations,
  with turn-taking and facilitation rules authored by the scenario.
- **Counterfactual controls.** Compare a news beat or intervention against a
  matched no-intervention branch while keeping the limitations explicit.
- **Cross-town tuning.** Weight gossip by shared concerns and documented
  relationships, visualize how a claim travels, and preserve its source chain.

## v0.4 — Creator ecosystem

- **Scenario doctor.** A single command that validates sources, option balance,
  relationship symmetry, landmark references, replay compatibility, licenses,
  and responsible-use metadata with actionable fixes.
- **Guided authoring.** Local preview and form-based editing for people who can
  write a nuanced resident but do not want to edit YAML by hand.
- **Portable scenario bundles.** Install, export, sign, and verify scenario
  packages independently of the application repository.
- **Community gallery.** Curated fictional and retrospective scenarios with clear
  provenance, content warnings, maintainer review, and version compatibility.
- **Extension points.** Document stable hooks for custom providers, phases,
  visualizations, and evaluators without requiring a fork of core modules.
- **Localization.** Translate chrome and scenario metadata while preserving
  authored multilingual resident voices and avoiding automatic cultural flattening.

## Living-world and product quality

These improvements can land continuously rather than waiting for a numbered
research release.

- Expand gesture and activity animation while keeping `prefers-reduced-motion`
  behavior first-class.
- Add optional, provenance-documented CC0 ambience and effects with independent
  controls, captions/visual equivalents, and a silent default for automation.
- Refine touch navigation, virtual controls, focus order, screen-reader event
  narration, high-contrast charts, and keyboard access to the Phaser world.
- Profile initial-load cost and split the game engine from map/dashboard routes;
  maintain performance budgets for JavaScript, art, and replay data.

## Deployment and operations

Township defaults to a single-process, file-backed deployment because that keeps
the local and classroom path understandable. Larger installations may need:

- queued runs with cancellation, per-run concurrency and spend limits, and clear
  multi-user isolation;
- object storage or a database adapter for run artifacts and journals;
- authentication, rate limiting, abuse controls, and quotas before exposing live
  inference or voice endpoints to the public internet;
- privacy-preserving operational metrics that are opt-in, documented, and absent
  from the zero-key/offline path;
- deployment recipes for common self-hosted platforms and verified backup/restore.

## Explicit non-goals

Some ideas in the prototype-era plans do not belong on Township's path:

- **No live-election prediction feed.** Real-election scenarios remain
  retrospective, after results are certified; Township will not become an
  election-night forecast or influence tool.
- **No microtargeting optimizer.** Interventions exist to study model behavior,
  not to tune messages against real demographic groups.
- **No synthetic electorate claims.** More agents do not turn fictional
  composites into a representative sample.
- **No private-person replicas.** Residents remain fictional composites, never
  identifiable private individuals.
- **No hidden model magic.** A polished world cannot outrank source visibility,
  run metadata, uncertainty, limitations, and reproducibility.

## Help shape the next release

The most valuable contributions are not necessarily the largest. A sharp
evaluation metric, an accessibility fix, a locally grounded fictional scenario,
or one resident who carries a genuine contradiction can change the project more
than another provider adapter.

Open a [feature proposal](https://github.com/StevenWang-CY/township/issues/new?template=feature_request.yml),
read [CONTRIBUTING.md](CONTRIBUTING.md), and attach evidence or a small prototype
where possible. Roadmap items become milestones only after their scope, risks,
and acceptance criteria are clear.
