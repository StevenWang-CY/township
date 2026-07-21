# Township documentation

Index of project documentation. Topic guides live in this directory; project-wide
policies live at the repository root and are linked below. For the project overview
and quickstart, start with the [repository README](../README.md);
[CLAUDE.md](../CLAUDE.md) orients coding agents (layout, commands, invariants).

## Guides

| Document | One-liner |
|----------|-----------|
| [architecture.md](architecture.md) | How the pieces fit — scenario package → simulation engine → event stream → frontend — plus the wire contract, prompt assembly, and design decisions |
| [api.md](api.md) | The full REST + WebSocket reference, with real captured responses from a mock-provider server |
| [scenario-format.md](scenario-format.md) | The full scenario package spec — `scenario.json`, towns, options, personas, news beats, validation — with both shipped packages as worked examples |
| [persona-authoring.md](persona-authoring.md) | Writing a resident: every frontmatter field, the craft of voice and ambivalence, the ethics rules, and the submission checklist |
| [persona-template.md](persona-template.md) | A complete, annotated, lint-passing persona to copy from |
| [deployment.md](deployment.md) | Running Township: local dev, environment variables, the provider matrix, Docker, reverse proxies, and cost guardrails |
| [faq.md](faq.md) | Short answers on cost, keys, models, memory, licensing, and what Township is not |
| [nj11-retrospective.md](nj11-retrospective.md) | The flagship NJ-11 run beside the certified April 2026 results — an honest error analysis of what the deliberation sim got right and wrong |

[`CONTRIBUTING.md`](../CONTRIBUTING.md) is the on-ramp for all three contribution
paths (personas, scenarios, engine/frontend work).
`docs/media/` holds the baseline UI screenshots referenced by the README.
The map-generation pipeline has its own guide at
[`scripts/mapgen/README.md`](../scripts/mapgen/README.md).

## Policies and notices

| Document | One-liner |
|----------|-----------|
| [RESPONSIBLE_USE.md](../RESPONSIBLE_USE.md) | What Township is and is not — simulation, not a poll — and the disclaimer that ships with every scenario |
| [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) | Licenses and provenance for the vendored game art under `frontend/public/assets/` |
| [SECURITY.md](../SECURITY.md) | How to report vulnerabilities; fixes land on `main` only |
| [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) | Community standards, including how political topics are handled in this repo |
