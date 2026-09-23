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
 *   <id>-towns.json     — the complete town payload shape-compatible with
 *                         GET /api/towns (landmarks, ambience, demographics)
 *   <id>-god-scenarios.json — the package's hypothetical-event library used
 *                         by the read-only hosted God's View
 *   manifest.json       — { default, scenarios } consumed at runtime;
 *                         default is nj11-2026 when staged, else the first
 *                         staged scenario. `?scenario=<id>` switches at
 *                         runtime among everything listed here.
 * ─────────────────────────────────────────────────────────── */

import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  rmSync,
  lstatSync,
  realpathSync,
} from "node:fs";
import { join, dirname, basename, relative, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { publicDemoEvents } from "./demo-events.mjs";

const FRONTEND_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(FRONTEND_DIR, "..");
const SCENARIOS_DIR = join(REPO_ROOT, "scenarios");
const OUT_DIR = join(FRONTEND_DIR, "public", "demo");

const PREFERRED_DEFAULT = "nj11-2026";
const CANONICAL_CORE_NOTICE =
  "Township is a simulation, not a poll. Its outputs do not measure real public opinion and must never be presented as if they do.";
const ARTIFACT_SCHEMA_VERSION = 1;
const ARTIFACT_PRIVACY_VERSION = 1;
/** A staged feed must stay a download the player can hold and seek: a 21-day
 *  campaign lands near 11k events / 6 MB with the neighbors tier. */
export const FEED_MAX_EVENTS = 16_000;
export const FEED_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_FEEDS = [
  { id: "one-day", file: "simulation_cache.json", label: "Recorded deliberation", flagship: true },
];
const FEED_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** The recordings a package ships: demo/manifest.json when present, else the
 *  classic simulation_cache.json alone. */
function readFeedSpecs(scenarioDir, id) {
  const candidate = join(scenarioDir, "demo", "manifest.json");
  if (!pathExistsNoFollow(candidate)) return DEFAULT_FEEDS;
  const manifestPath = checkedPath(scenarioDir, candidate, `${id}/demo/manifest.json`);
  const doc = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!doc || !Array.isArray(doc.feeds) || doc.feeds.length === 0) {
    throw new Error(`stage-demo: ${id}/demo/manifest.json must list feeds`);
  }
  const seen = new Set();
  return doc.feeds.map((feed) => {
    if (!feed || typeof feed !== "object") throw new Error(`stage-demo: ${id} feed entry must be an object`);
    const { id: feedId, file, label, flagship } = feed;
    if (typeof feedId !== "string" || !FEED_ID_RE.test(feedId) || seen.has(feedId)) {
      throw new Error(`stage-demo: ${id} feed id ${JSON.stringify(feedId)} must be a unique slug`);
    }
    seen.add(feedId);
    if (typeof file !== "string" || !/^[A-Za-z0-9_.-]+\.json$/.test(file) || file.includes("..")) {
      throw new Error(`stage-demo: ${id} feed ${feedId} must name a JSON file inside demo/`);
    }
    if (typeof label !== "string" || !label.trim()) throw new Error(`stage-demo: ${id} feed ${feedId} needs a label`);
    return { id: feedId, file, label: label.trim(), flagship: Boolean(flagship) };
  });
}

function pathExistsNoFollow(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

/** Resolve a package input without ever following a link outside its root. */
function checkedPath(root, candidate, label, kind = "file") {
  let info;
  let rootReal;
  let candidateReal;
  try {
    info = lstatSync(candidate);
    rootReal = realpathSync(root);
    candidateReal = realpathSync(candidate);
  } catch {
    throw new Error(`stage-demo: ${label} is missing or unreadable`);
  }
  if (info.isSymbolicLink()) {
    throw new Error(`stage-demo: ${label} must not be a symbolic link`);
  }
  const fromRoot = relative(rootReal, candidateReal);
  if (fromRoot === ".." || fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(fromRoot)) {
    throw new Error(`stage-demo: ${label} must stay within its scenario package`);
  }
  if (kind === "directory" ? !info.isDirectory() : !info.isFile()) {
    throw new Error(`stage-demo: ${label} must be a regular ${kind}`);
  }
  return candidateReal;
}

/** Mirror of backend/core/scenario.py ScenarioLoader.town_color. */
function townColor(town) {
  return town.accent_color || "#888888";
}

/** Build the /api/scenario-shaped bootstrap payload from a scenario package.
 *  Mirrors backend/routes/scenario.py::get_scenario. */
function readTowns(scenarioDir, config, id) {
  // Town roster: honor explicit town_order, then append any stray town files
  // so nothing silently disappears (same policy as ScenarioLoader.town_ids).
  const townsDir = checkedPath(
    scenarioDir,
    join(scenarioDir, "towns"),
    `${id}/towns`,
    "directory",
  );
  const townFiles = readdirSync(townsDir).filter((f) => f.endsWith(".json"));
  const byId = {};
  for (const f of townFiles) {
    const townPath = checkedPath(scenarioDir, join(townsDir, f), `${id}/towns/${f}`);
    byId[basename(f, ".json")] = JSON.parse(readFileSync(townPath, "utf8"));
  }
  const ordered = (config.town_order || []).filter((t) => byId[t]);
  for (const t of Object.keys(byId).sort()) {
    if (!ordered.includes(t)) ordered.push(t);
  }
  return { byId, ordered };
}

function buildScenarioPayload(config, byId, ordered, id) {

  const responsibleUse = config.responsible_use;
  for (const field of ["core_notice", "residents_notice", "subjects_notice", "outputs_notice"]) {
    if (typeof responsibleUse?.[field] !== "string" || !responsibleUse[field].trim()) {
      throw new Error(`${id}: responsible_use.${field} must be a non-empty string`);
    }
  }
  if (responsibleUse.core_notice.trim() !== CANONICAL_CORE_NOTICE) {
    throw new Error(
      `${id}: responsible_use.core_notice must exactly match Township's canonical simulation-not-a-poll warning`,
    );
  }

  const towns = ordered.map((townId) => {
    const town = byId[townId];
    const entry = {
      id: townId,
      name: town.name || townId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      tagline: town.tagline || "",
      color: townColor(town),
      county: town.county || "",
      map: town.map ?? null,
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
    round_plan: (config.round_plan || []).map((r) => ({
      round: r.round,
      phases: Array.isArray(r.phases) ? r.phases : [],
      clock: typeof r.clock === "string" ? r.clock : "12:00",
    })),
    dates: {
      decision_day: config.dates?.decision_day || "",
      prose: config.dates?.prose || "",
    },
    responsible_use: responsibleUse,
  };
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export function stageDemos({
  scenariosDir = SCENARIOS_DIR,
  outDir = OUT_DIR,
  preferredDefault = PREFERRED_DEFAULT,
} = {}) {
  if (!existsSync(scenariosDir)) {
    throw new Error("stage-demo: no scenarios/ directory found");
  }
  const scenariosRoot = realpathSync(scenariosDir);
  mkdirSync(outDir, { recursive: true });
  // The scenario set is authoritative. Remove yesterday's generated files so
  // a renamed/deleted package can never linger in a later Pages build, while
  // preserving the tracked ignore policy that documents this directory.
  for (const entry of readdirSync(outDir)) {
    if (entry !== ".gitignore") rmSync(join(outDir, entry), { recursive: true, force: true });
  }

  const staged = [];
  const feedsByScenario = {};
  for (const id of readdirSync(scenariosRoot).sort()) {
    const candidateDir = join(scenariosRoot, id);
    const entry = lstatSync(candidateDir);
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const scenarioDir = checkedPath(
      scenariosRoot,
      candidateDir,
      `scenario package ${id}`,
      "directory",
    );
    const stagedFeeds = [];
    for (const spec of readFeedSpecs(scenarioDir, id)) {
      const cacheCandidate = join(scenarioDir, "demo", spec.file);
      if (!pathExistsNoFollow(cacheCandidate)) {
        console.log(`stage-demo: skip ${id}/${spec.file} (missing)`);
        continue;
      }
      const cachePath = checkedPath(scenarioDir, cacheCandidate, `${id}/demo/${spec.file}`);

      // Feed: keep events + district_summary, drop the usage report (dead
      // weight for the player), minify.
      const cache = JSON.parse(readFileSync(cachePath, "utf8"));
      if (
        cache.schema_version !== ARTIFACT_SCHEMA_VERSION ||
        cache.privacy_version !== ARTIFACT_PRIVACY_VERSION
      ) {
        throw new Error(
          `stage-demo: ${id}/${spec.file} predates the private-player boundary; regenerate it`,
        );
      }
      const rawEvents = Array.isArray(cache.events) ? cache.events : [];
      if (
        !Array.isArray(cache.events) ||
        rawEvents.some((event) => !event || typeof event !== "object" || typeof event.type !== "string")
      ) {
        throw new Error(`stage-demo: ${id}/${spec.file} has an invalid events array`);
      }
      const events = publicDemoEvents(rawEvents);
      if (events.length !== rawEvents.length) {
        console.warn(
          `stage-demo: ${id}/${spec.file} dropped ${rawEvents.length - events.length} private legacy event(s)`,
        );
      }
      if (events.length === 0) {
        console.log(`stage-demo: skip ${id}/${spec.file} (no events)`);
        continue;
      }
      if (events.length > FEED_MAX_EVENTS) {
        throw new Error(
          `stage-demo: ${id}/${spec.file} has ${events.length} events; the player's budget is ${FEED_MAX_EVENTS}`,
        );
      }
      const feed = JSON.stringify({
        schema_version: ARTIFACT_SCHEMA_VERSION,
        privacy_version: ARTIFACT_PRIVACY_VERSION,
        scenario_id: id,
        feed_id: spec.id,
        events,
        district_summary: cache.district_summary ?? null,
      });
      const bytes = Buffer.byteLength(feed);
      if (bytes > FEED_MAX_BYTES) {
        throw new Error(
          `stage-demo: ${id}/${spec.file} is ${kb(bytes)}; the player's budget is ${kb(FEED_MAX_BYTES)}`,
        );
      }
      const outName = `${id}--${spec.id}.json`;
      writeFileSync(join(outDir, outName), feed);
      stagedFeeds.push({ id: spec.id, file: outName, label: spec.label, flagship: spec.flagship, events: events.length, bytes });
    }
    if (stagedFeeds.length === 0) {
      console.log(`stage-demo: skip ${id} (no demo feeds)`);
      continue;
    }
    // The flagship feed (the manifest's, else the first) also answers at the
    // classic <id>.json address every older link and the e2e suite use.
    const flagship = stagedFeeds.find((f) => f.flagship) ?? stagedFeeds[0];
    for (const f of stagedFeeds) f.flagship = f === flagship;
    copyFileSync(join(outDir, flagship.file), join(outDir, `${id}.json`));
    feedsByScenario[id] = stagedFeeds;

    // Bootstrap payload (shape-compatible with GET /api/scenario).
    const manifestPath = checkedPath(
      scenarioDir,
      join(scenarioDir, "scenario.json"),
      `${id}/scenario.json`,
    );
    const config = JSON.parse(readFileSync(manifestPath, "utf8"));
    const { byId, ordered } = readTowns(scenarioDir, config, id);
    const payload = buildScenarioPayload(config, byId, ordered, id);
    writeFileSync(join(outDir, `${id}-scenario.json`), JSON.stringify(payload));
    writeFileSync(join(outDir, `${id}-towns.json`), JSON.stringify({ towns: byId }));
    const godScenariosCandidate = join(scenarioDir, "god-scenarios.json");
    const godScenariosPath = pathExistsNoFollow(godScenariosCandidate)
      ? checkedPath(scenarioDir, godScenariosCandidate, `${id}/god-scenarios.json`)
      : null;
    const godScenarios = godScenariosPath
      ? JSON.parse(readFileSync(godScenariosPath, "utf8"))
      : [];
    if (!Array.isArray(godScenarios)) {
      throw new Error(`stage-demo: ${id}/god-scenarios.json must contain a JSON array`);
    }
    writeFileSync(
      join(outDir, `${id}-god-scenarios.json`),
      JSON.stringify(godScenarios),
    );

    staged.push(id);
    console.log(
      `stage-demo: staged ${id} — ${stagedFeeds.map((f) => `${f.id}: ${f.events} events (${kb(f.bytes)})`).join(", ")}; scenario + town + God's View payloads OK`,
    );
  }

  if (staged.length === 0) throw new Error("stage-demo: no demo caches found");

  const def = staged.includes(preferredDefault) ? preferredDefault : staged[0];
  const manifest = { default: def, scenarios: staged, feeds: feedsByScenario };
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest));
  console.log(`stage-demo: manifest → default "${def}", scenarios [${staged.join(", ")}]`);
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    stageDemos();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "stage-demo: staging failed");
    process.exitCode = 1;
  }
}
