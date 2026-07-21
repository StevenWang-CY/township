#!/usr/bin/env node
/* ── stage-demo.mjs ──────────────────────────────────────────
 *
 * Stages recorded simulation caches for the zero-backend demo build
 * (`npm run demo:build` — the `predemo:build` hook runs this first).
 *
 * For every scenario package with a demo cache
 *   scenarios/<id>/demo/simulation_cache.json
 * it writes into frontend/public/demo/:
 *   <id>.json           — the event feed (minified; usage report dropped)
 *   <id>-scenario.json  — a bootstrap payload shape-compatible with
 *                         GET /api/scenario, derived from the scenario
 *                         package (scenario.json + towns/*.json)
 *   manifest.json       — { default, scenarios } consumed at runtime;
 *                         default is nj11-2026 when staged, else the first
 *                         staged scenario. `?scenario=<id>` switches at
 *                         runtime among everything listed here.
 * ─────────────────────────────────────────────────────────── */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(FRONTEND_DIR, "..");
const SCENARIOS_DIR = join(REPO_ROOT, "scenarios");
const OUT_DIR = join(FRONTEND_DIR, "public", "demo");

const PREFERRED_DEFAULT = "nj11-2026";

/** Mirror of backend/core/scenario.py ScenarioLoader.town_color. */
function townColor(town) {
  return town.accent_color || "#888888";
}

/** Build the /api/scenario-shaped bootstrap payload from a scenario package.
 *  Mirrors backend/routes/scenario.py::get_scenario. */
function buildScenarioPayload(scenarioDir, id) {
  const config = JSON.parse(readFileSync(join(scenarioDir, "scenario.json"), "utf8"));

  // Town roster: honor explicit town_order, then append any stray town files
  // so nothing silently disappears (same policy as ScenarioLoader.town_ids).
  const townsDir = join(scenarioDir, "towns");
  const townFiles = readdirSync(townsDir).filter((f) => f.endsWith(".json"));
  const byId = {};
  for (const f of townFiles) {
    byId[basename(f, ".json")] = JSON.parse(readFileSync(join(townsDir, f), "utf8"));
  }
  const ordered = (config.town_order || []).filter((t) => byId[t]);
  for (const t of Object.keys(byId).sort()) {
    if (!ordered.includes(t)) ordered.push(t);
  }

  const towns = ordered.map((townId) => {
    const town = byId[townId];
    const entry = {
      id: townId,
      name: town.name || townId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      tagline: town.tagline || "",
      color: townColor(town),
      county: town.county || "",
    };
    const population = town.demographics?.population;
    if (population != null) entry.population = population;
    return entry;
  });

  return {
    id: config.id || id,
    title: config.title,
    question: config.question,
    decision_kind: config.kind || "vote",
    options: (config.options || []).map((o) => ({
      id: o.id,
      name: o.name,
      label: o.label,
      color: o.color,
      group: o.group ?? null,
    })),
    undecided: {
      id: config.undecided?.id || "undecided",
      label: config.undecided?.label || "Undecided",
      color: config.undecided?.color || "#D1D5DB",
    },
    towns,
    total_rounds: (config.round_plan || []).length,
    dates: {
      decision_day: config.dates?.decision_day || "",
      prose: config.dates?.prose || "",
    },
  };
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function main() {
  if (!existsSync(SCENARIOS_DIR)) {
    console.error(`stage-demo: no scenarios/ directory at ${SCENARIOS_DIR}`);
    process.exit(1);
  }
  mkdirSync(OUT_DIR, { recursive: true });

  const staged = [];
  for (const id of readdirSync(SCENARIOS_DIR).sort()) {
    const scenarioDir = join(SCENARIOS_DIR, id);
    if (!statSync(scenarioDir).isDirectory()) continue;
    const cachePath = join(scenarioDir, "demo", "simulation_cache.json");
    if (!existsSync(cachePath)) {
      console.log(`stage-demo: skip ${id} (no demo/simulation_cache.json)`);
      continue;
    }

    // Feed: keep events + district_summary, drop the usage report (dead
    // weight for the player), minify.
    const cache = JSON.parse(readFileSync(cachePath, "utf8"));
    const events = cache.events || [];
    if (events.length === 0) {
      console.log(`stage-demo: skip ${id} (cache has no events)`);
      continue;
    }
    const feed = JSON.stringify({
      scenario_id: id,
      events,
      district_summary: cache.district_summary ?? null,
    });
    writeFileSync(join(OUT_DIR, `${id}.json`), feed);

    // Bootstrap payload (shape-compatible with GET /api/scenario).
    const payload = buildScenarioPayload(scenarioDir, id);
    writeFileSync(join(OUT_DIR, `${id}-scenario.json`), JSON.stringify(payload));

    staged.push(id);
    console.log(
      `stage-demo: staged ${id} — ${events.length} events (${kb(Buffer.byteLength(feed))}), scenario payload OK`,
    );
  }

  if (staged.length === 0) {
    console.error("stage-demo: no demo caches found — nothing to stage.");
    process.exit(1);
  }

  const def = staged.includes(PREFERRED_DEFAULT) ? PREFERRED_DEFAULT : staged[0];
  writeFileSync(join(OUT_DIR, "manifest.json"), JSON.stringify({ default: def, scenarios: staged }));
  console.log(`stage-demo: manifest → default "${def}", scenarios [${staged.join(", ")}]`);
}

main();
