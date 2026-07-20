# data/ — moved

All scenario content that used to live here (towns, candidates, debate
excerpts, election logistics, God's View scenarios, and the `agents/`
directory at the repo root) has moved into the scenario package:

    scenarios/nj11-2026/
        scenario.json           # the manifest that used to be hardcoded
        towns/                  # was data/towns/
        options/                # was data/candidates/
        context/debate-excerpts.json
        context/logistics.json  # was data/election-logistics.json
        god-scenarios.json      # was data/god_view_scenarios.json
        agents/                 # was <repo>/agents/

This directory is retained only for backward-compatible runtime state
(e.g. `simulation_cache.json` written by the orchestrator). The engine
still falls back to the old `data/` + `agents/` layout — with a loud
deprecation warning — for one release, so external scripts have time to
migrate. New content belongs in `scenarios/<id>/`.
