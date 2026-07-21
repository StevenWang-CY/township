# `data/` — local runtime state

Scenario content never lives here. Towns, options, context, God's View presets,
and personas belong in a complete package under `scenarios/<id>/`; the loader does
not synthesize a scenario from the former root-level `data/` + `agents/` layout.

This directory instead holds gitignored, deployment-local state:

```text
data/
├── simulation_cache.json            # latest replay cache, best-effort
└── state/
    ├── player_capabilities.json      # user id → SHA-256 capability digest
    ├── relationships.json            # capability-protected player trust state
    └── journal.json                  # capability-protected player journals
```

The two private stores are validated strictly at startup. Corruption locks all
private-state endpoints closed until an operator repairs the files and restarts the
process. On upgrade, records without a matching capability binding cannot be safely
assigned to a browser; Township removes them from the active store and preserves a
local `*.legacy-unbound.json` quarantine for operator review. That quarantine is
never served by the API.

Use `TOWNSHIP_STATE_DIR` and `TOWNSHIP_CACHE_PATH` to relocate these files. Durable
run directories live separately under `runs/` (or `TOWNSHIP_RUNS_DIR`).
