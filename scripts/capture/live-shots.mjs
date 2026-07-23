#!/usr/bin/env node
/**
 * Live-stack product shots for Township.
 *
 * Complements capture.mjs (which shoots the zero-backend demo build): these
 * surfaces need a real backend — resident chat, a God's View injection, and
 * the dashboard while a simulation is actually running. Everything runs
 * against the deterministic mock provider; no credentials, no model calls.
 *
 * Prereqs (two terminals):
 *   LLM_PROVIDER=mock uvicorn backend.main:app --port 8001
 *   cd frontend && npx vite --port 5273
 *
 * Then:  node scripts/capture/live-shots.mjs
 *
 * Environment:
 *   TOWNSHIP_LIVE_ORIGIN  frontend origin (default http://localhost:5273)
 */

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const FRONTEND = join(REPO_ROOT, "frontend");
const OUT = join(REPO_ROOT, "docs", "media", "live");
const ORIGIN = process.env.TOWNSHIP_LIVE_ORIGIN || "http://localhost:5273";

const requireFromFrontend = createRequire(join(FRONTEND, "package.json"));
const { chromium } = requireFromFrontend("playwright");

mkdirSync(OUT, { recursive: true });

try {
  const health = await fetch(`${ORIGIN}/api/scenario`);
  if (!health.ok) throw new Error(`HTTP ${health.status}`);
} catch (error) {
  console.error(
    `live-shots: no live stack at ${ORIGIN} (${error}). Start the mock backend on :8001 and Vite on :5273 first.`,
  );
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: "light",
});
const page = await context.newPage();

const failures = [];
page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));

async function open(route, settleMs = 1_200) {
  await page.goto(`${ORIGIN}${route}?capture=1`, { waitUntil: "domcontentloaded" });
  await page.locator("#root").waitFor({ state: "visible" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(settleMs);
}

// TOWNSHIP_LIVE_ONLY=chat|dashboard|gods reshoots one surface.
const ONLY = process.env.TOWNSHIP_LIVE_ONLY || "";
const wants = (name) => !ONLY || ONLY === name;

// ── 1. Dashboard while the simulation is actually running ────────────────
// The mock run is fast, so sample the page as the event stream floods in and
// keep every frame; the caller picks the best genuinely-mid-run state.
if (wants("dashboard")) {
await open("/dashboard");
await page.evaluate(() =>
  fetch("/api/simulation/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }),
);
const burst = [];
for (let i = 0; i < 14; i += 1) {
  burst.push(await page.screenshot({ type: "png" }));
  await page.waitForTimeout(300);
}
burst.forEach((buffer, index) => {
  writeFileSync(join(OUT, `_burst-${String(index).padStart(2, "0")}.png`), buffer);
});

// ── 2. Recap card once the run has persisted its narrative ───────────────
await page.waitForFunction(
  async () => {
    const status = await fetch("/api/simulation/status").then((r) => r.json());
    return status?.status === "completed" && !status?.is_running;
  },
  null,
  { timeout: 60_000, polling: 1_000 },
);
// The dashboard polls the freshly persisted run for its recap; wait for the
// panel, open it, and let the type settle.
const recap = page.locator(".dashboard-recap");
await recap.waitFor({ state: "visible", timeout: 30_000 });
await page.waitForTimeout(2_500);
await page.evaluate(() => {
  const details = document.querySelector(".dashboard-recap-details");
  if (details && !details.open) details.open = true;
});
await page.waitForTimeout(600);
await page.evaluate(() => {
  document.querySelector(".dashboard-recap")?.scrollIntoView({ block: "center", behavior: "auto" });
});
await page.waitForTimeout(400);
await page.screenshot({ path: join(OUT, "recap-card.png"), type: "png" });
}

// ── 3. God's View: the ask, then the district-wide response ──────────────
if (wants("gods")) {
await open("/gods-view");
const card = page.locator("button", { hasText: "Healthcare Premiums Increase 20%" }).first();
await card.waitFor({ state: "visible", timeout: 20_000 });
await card.click();
await page.waitForTimeout(400);
const promptBox = page.locator("#gods-view-prompt");
await promptBox.scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
await page.screenshot({ path: join(OUT, "gods-view-before.png"), type: "png" });

await page.locator("button", { hasText: "Inject Scenario" }).first().click();
// Reactions for every agent + the before/after distribution.
await page.locator('[aria-label="Next steps"]').waitFor({ state: "visible", timeout: 120_000 });
await page.waitForTimeout(800);
await page.evaluate(() => {
  const heading = [...document.querySelectorAll("h2, h3")].find((h) =>
    /projected|reaction|response|shift/i.test(h.textContent || ""),
  );
  heading?.scrollIntoView({ block: "start", behavior: "auto" });
  window.scrollBy(0, -24);
});
await page.waitForTimeout(500);
await page.screenshot({ path: join(OUT, "gods-view-after.png"), type: "png" });
}

// ── 4. Resident chat with a reply worth quoting ───────────────────────────
if (!ONLY || ONLY === "chat") {
// The mock's chat replies rotate deterministic persona templates; retry with
// a fresh panel until the visible exchange actually lands.
// The mock's reply template is seeded by the exact message, so vary the
// question until one lands on the two most quotable of its four voices.
const QUESTIONS = [
  "What's the one issue deciding your vote?",
  "What do people around town say about this race?",
  "How are you feeling about the election?",
  "What would a good representative actually do for Dover?",
  "What matters most to your family right now?",
  "Has anything changed your mind lately?",
  "Do your patients talk about the election?",
  "What should the candidates understand about Dover?",
];
const GOOD_REPLY = /Around here|comes down to/;
let chatShot = false;
for (let attempt = 0; attempt < QUESTIONS.length && !chatShot; attempt += 1) {
  const QUESTION = QUESTIONS[attempt];
  await open("/town/dover", 2_500);
  await page.waitForFunction(
    () => Boolean(window.__townshipScene && document.querySelector("canvas")),
    null,
    { timeout: 20_000 },
  );
  await page.waitForFunction(
    () => Number(window.__townshipScene?.agentSprites?.size || 0) >= 4,
    null,
    { timeout: 15_000 },
  );
  // Golden hour in the world behind the panel.
  await page.evaluate(() => {
    window.__town?.setWeather("clear");
    window.__town?.setWorldTime(16, 30);
  });
  await page.waitForTimeout(600);
  await page.locator("button.resident-card", { hasText: "Maria Santos" }).first().click();
  const input = page.locator('input[placeholder^="Talk to"], textarea[placeholder^="Talk to"]').first();
  await input.waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(900);
  await input.fill(QUESTION);
  await input.press("Enter");
  // Wait until an agent reply appears after our message.
  await page
    .waitForFunction(
      (marker) => {
        const panel = document.querySelector(".chat-panel, [class*=chat]");
        const text = panel?.textContent || "";
        const at = text.indexOf(marker);
        return at >= 0 && text.slice(at + marker.length).trim().length > 40;
      },
      QUESTION,
      { timeout: 30_000 },
    )
    .catch(() => undefined);
  await page.waitForTimeout(1_200);
  const replyOk = await page.evaluate(
    ({ marker, pattern }) => {
      const panel = document.querySelector(".chat-panel, [class*=chat]");
      const text = panel?.textContent || "";
      const at = text.indexOf(marker);
      if (at < 0) return false;
      return new RegExp(pattern).test(text.slice(at + marker.length));
    },
    { marker: QUESTION, pattern: GOOD_REPLY.source },
  );
  if (replyOk || attempt === QUESTIONS.length - 1) {
    // Maria may have wandered while we typed — put her back in frame.
    await page.evaluate(() => {
      const scene = window.__townshipScene;
      const maria = scene?.agentSprites?.get("maria-santos");
      if (maria) scene.cameras.main.centerOn(maria.x, maria.y - 20);
    });
    await page.waitForTimeout(450);
    await page.screenshot({ path: join(OUT, "chat.png"), type: "png" });
    chatShot = true;
  }
}
}

await browser.close();
if (failures.length) {
  console.error(`live-shots: page errors:\n${[...new Set(failures)].join("\n")}`);
  process.exit(1);
}
console.log(`live-shots: written to ${OUT} (pick the mid-run _burst frame, rename to dashboard-live.png, delete the rest)`);
