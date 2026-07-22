#!/usr/bin/env node
/**
 * Automated launch-media capture for Township.
 *
 * The script serves the zero-backend demo build, uses its real ephemeral guest,
 * drives the capture API exposed by TownScene, and writes the README hero, town
 * stills, mobile proof, demo-player surfaces, and social preview. No model
 * calls or credentials are involved.
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
const FRONTEND = join(REPO_ROOT, "frontend");
const DEMO_DIST = join(FRONTEND, "dist-demo");
const MEDIA = join(REPO_ROOT, "docs", "media");
const PORT = Number(process.env.TOWNSHIP_CAPTURE_PORT || 4174);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const requireFromFrontend = createRequire(join(FRONTEND, "package.json"));

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Usage: node scripts/capture/capture.mjs

Build the static demo first, serve it locally, and regenerate the curated
product media under docs/media/. The run is scripted and zero-key.

Environment:
  TOWNSHIP_CAPTURE_PORT  preview port (default: 4174)
  PYTHON                 Python executable used by make_gif.py`);
  process.exit(0);
}

let chromium;
try {
  ({ chromium } = requireFromFrontend("playwright"));
} catch {
  console.error("capture: Playwright is missing. Run `make install` first.");
  process.exit(1);
}

if (!existsSync(join(DEMO_DIST, "index.html"))) {
  console.error("capture: frontend/dist-demo is missing. Run `make demo-build` first.");
  process.exit(1);
}

const demoManifest = JSON.parse(readFileSync(join(DEMO_DIST, "demo", "manifest.json"), "utf8"));
const defaultFeed = JSON.parse(
  readFileSync(join(DEMO_DIST, "demo", `${demoManifest.default}.json`), "utf8"),
);
const finalEvent = [...defaultFeed.events]
  .reverse()
  .find((event) => event.type === "simulation_ended");
const expectedFinalCounts = finalEvent?.summary?.overall_opinions;
if (!expectedFinalCounts || typeof expectedFinalCounts !== "object") {
  console.error("capture: default demo feed has no final overall_opinions summary.");
  process.exit(1);
}

for (const dir of [
  join(MEDIA, "scene"),
  join(MEDIA, "demo-player"),
  join(MEDIA, "mobile"),
]) {
  mkdirSync(dir, { recursive: true });
}

const tempFrames = mkdtempSync(join(tmpdir(), "township-capture-"));
let frameNumber = 0;

function addHeroFrame(buffer, repeats = 1) {
  for (let i = 0; i < repeats; i += 1) {
    const name = `${String(frameNumber).padStart(3, "0")}.png`;
    writeFileSync(join(tempFrames, name), buffer);
    frameNumber += 1;
  }
}

async function waitForServer() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(ORIGIN);
      if (response.ok) return;
    } catch {
      // Preview server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error(`preview server did not become ready at ${ORIGIN}`);
}

async function settle(page, ms = 700) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(ms);
}

async function openRoute(page, route, scenario = null) {
  const query = new URLSearchParams({ capture: "1" });
  if (scenario) query.set("scenario", scenario);
  await page.goto(`${ORIGIN}/?${query.toString()}#${route}`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator("#root").waitFor({ state: "visible" });
  await settle(page);
}

async function accelerateReplay(page) {
  const speed = page.locator('[aria-label^="Playback speed"]');
  if (!(await speed.isVisible().catch(() => false))) return;
  for (let i = 0; i < 3; i += 1) {
    const label = (await speed.getAttribute("aria-label")) || "";
    if (label.includes("4x")) break;
    await speed.click();
    await page.waitForTimeout(100);
  }
}

async function pauseReplay(page) {
  const control = page.locator('[aria-label="Pause replay"]');
  if (await control.isVisible().catch(() => false)) {
    await control.click();
    await page.waitForTimeout(120);
  }
}

async function settleTownStill(page) {
  await pauseReplay(page);
  await page.evaluate(() => {
    const scene = window.__townshipScene;
    if (!scene) return;
    scene.agentSprites?.forEach?.((sprite) => sprite.clearSpeechBubbles?.());
    scene.handleConversationEnded?.("capture-still");
    const keyboardHint = document.querySelector(".keyboard-hint");
    if (keyboardHint instanceof HTMLElement) keyboardHint.style.display = "none";
  });
  await page.waitForTimeout(180);
}

async function waitForTown(page, minimumResidents = 4) {
  await page.waitForFunction(
    () => Boolean(window.__townshipScene && document.querySelector("canvas")),
    null,
    { timeout: 20_000 },
  );
  await accelerateReplay(page);
  await page
    .waitForFunction(
      (minimum) => {
        const scene = window.__townshipScene;
        return Number(scene?.agentSprites?.size || 0) >= minimum;
      },
      minimumResidents,
      { timeout: 15_000 },
    );
  await settle(page, 900);
}

async function setTownMoment(page, hour, weather = "clear") {
  await page.evaluate(
    ({ targetHour, targetWeather }) => {
      window.__town?.setWeather(targetWeather);
      window.__town?.setWorldTime(targetHour, 0);
    },
    { targetHour: hour, targetWeather: weather },
  );
  await page.waitForTimeout(500);
}

async function resetPageScroll(page) {
  await page.evaluate(() => {
    document.scrollingElement?.scrollTo({ top: 0, left: 0, behavior: "auto" });
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  });
  await page.waitForTimeout(80);
}

async function shot(page, path, { resetScroll = true } = {}) {
  if (resetScroll) await resetPageScroll(page);
  return page.screenshot({ path, type: "png", animations: "allow" });
}

function watchRuntimeFailures(page, label, failures) {
  page.on("pageerror", (error) => failures.push(`${label} pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`${label} console.error: ${message.text()}`);
  });
  page.on("requestfailed", (request) => {
    failures.push(
      `${label} request failed: ${request.method()} ${request.url()} (${request.failure()?.errorText || "unknown"})`,
    );
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failures.push(`${label} HTTP ${response.status()}: ${response.url()}`);
    }
  });
}

const server = spawn(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["run", "demo:preview", "--", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
  { cwd: FRONTEND, stdio: ["ignore", "pipe", "pipe"] },
);

let serverLog = "";
server.stdout.on("data", (chunk) => { serverLog += chunk.toString(); });
server.stderr.on("data", (chunk) => { serverLog += chunk.toString(); });

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: "light",
  });
  const page = await context.newPage();

  const runtimeFailures = [];
  watchRuntimeFailures(page, "desktop", runtimeFailures);

  // District map: the product's front door and the opening hero beat.
  await openRoute(page, "/");
  await resetPageScroll(page);
  const firstPin = page.locator(".district-map-pin").first();
  if (await firstPin.isVisible().catch(() => false)) {
    const box = await firstPin.boundingBox();
    if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  }
  await settle(page, 500);
  const mapBuffer = await shot(
    page,
    join(MEDIA, "demo-player", "01-map.png"),
    { resetScroll: false },
  );
  addHeroFrame(mapBuffer, 3);

  const townSets = [
    { scenario: null, id: "dover", residents: 6 },
    { scenario: null, id: "montclair", residents: 6 },
    { scenario: null, id: "parsippany", residents: 6 },
    { scenario: null, id: "randolph", residents: 6 },
    { scenario: "millbrook-budget", id: "millbrook-village", residents: 4 },
    { scenario: "millbrook-budget", id: "harlow-crossing", residents: 4 },
  ];

  let socialBackdrop = null;
  for (const town of townSets) {
    await openRoute(page, `/town/${town.id}`, town.scenario);
    await waitForTown(page, town.residents);
    await settleTownStill(page);
    await setTownMoment(page, 16, "clear");
    const dayPath = join(MEDIA, "scene", `${town.id}-day.png`);
    const dayBuffer = await shot(page, dayPath);

    if (town.id === "dover") {
      // The social card needs the world itself, not the product screenshot's
      // resident rail. Cropping at the source prevents a stray sidebar sliver
      // from appearing when the image is used as a CSS cover background.
      socialBackdrop = await page.locator(".town-canvas-wrapper").screenshot({
        type: "png",
        style: ".proximity-card, .keyboard-hint { display: none !important; }",
      });
      writeFileSync(join(MEDIA, "demo-player", "02-town-replay.png"), dayBuffer);
      await page.evaluate(() => {
        window.__town?.triggerConversation("carlos-restrepo", "sofia-ramirez");
      });
      for (let i = 0; i < 7; i += 1) {
        await page.waitForTimeout(180);
        addHeroFrame(await page.screenshot({ type: "png" }));
      }
      await page.evaluate(() => window.__town?.triggerNews("A late-breaking town hall draws a crowd"));
      for (let i = 0; i < 4; i += 1) {
        await page.waitForTimeout(220);
        addHeroFrame(await page.screenshot({ type: "png" }));
      }
      writeFileSync(join(MEDIA, "demo-player", "03-timeline-seek.png"), await page.screenshot({ type: "png" }));
    }

    await settleTownStill(page);
    await setTownMoment(page, 21, "clear");
    const nightBuffer = await shot(page, join(MEDIA, "scene", `${town.id}-night.png`));
    if (town.id === "dover") addHeroFrame(nightBuffer, 3);
  }

  // Dashboard at the actual end: state and narrative, not a merely late round.
  await openRoute(page, "/dashboard");
  const timeline = page.locator('[aria-label="Replay position"]');
  await timeline.waitFor({ state: "visible" });
  await timeline.press("End");
  await page.waitForFunction(() => {
    const slider = document.querySelector('[aria-label="Replay position"]');
    return slider?.getAttribute("aria-valuenow") === slider?.getAttribute("aria-valuemax");
  });
  await page.waitForFunction((counts) => Object.entries(counts).every(([stance, count]) => {
    const node = document.querySelector(`[data-stance-id="${CSS.escape(stance)}"]`);
    return node?.getAttribute("data-stance-count") === String(count);
  }), expectedFinalCounts);
  await settle(page, 1_200);
  const dashboardBuffer = await shot(page, join(MEDIA, "demo-player", "04-dashboard-end.png"));
  addHeroFrame(dashboardBuffer, 3);

  await openRoute(page, "/gods-view");
  await settle(page, 500);
  await shot(page, join(MEDIA, "demo-player", "05-gods-view.png"));

  // Mobile stranger proof: no hidden desktop-only escape hatch.
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    colorScheme: "light",
  });
  const mobile = await mobileContext.newPage();
  watchRuntimeFailures(mobile, "mobile", runtimeFailures);
  await openRoute(mobile, "/");
  await shot(mobile, join(MEDIA, "mobile", "map.png"));
  await openRoute(mobile, "/town/dover");
  await waitForTown(mobile, 3);
  await setTownMoment(mobile, 16, "clear");
  await shot(mobile, join(MEDIA, "mobile", "town.png"));
  await mobileContext.close();

  // 1280×640 social card, composed from the real product rather than mock art.
  if (socialBackdrop) {
    const backdrop = `data:image/png;base64,${socialBackdrop.toString("base64")}`;
    const lockup = readFileSync(join(MEDIA, "brand", "lockup-dark.svg"), "utf8");
    await page.setViewportSize({ width: 1280, height: 640 });
    await page.setContent(`<!doctype html><html><head><style>
      * { box-sizing: border-box; }
      html, body { margin: 0; width: 1280px; height: 640px; overflow: hidden; }
      body { background: #1e1720; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      .card { position: relative; width: 100%; height: 100%; overflow: hidden; background: #2c2430; }
      .world { position: absolute; inset: -72px -30px -30px 390px; background: url('${backdrop}') center/cover; filter: saturate(.9) contrast(1.05); transform: rotate(-1deg) scale(1.03); }
      .wash { position: absolute; inset: 0; background: linear-gradient(90deg, #241b28 0%, #2a202cf5 36%, #2a202c90 58%, #2a202c18 82%); }
      .grain { position: absolute; inset: 0; opacity: .12; background-image: linear-gradient(#fff1 1px, transparent 1px), linear-gradient(90deg, #fff1 1px, transparent 1px); background-size: 4px 4px; }
      .content { position: absolute; left: 64px; top: 54px; width: 620px; color: #f4ecdf; }
      .lockup { width: 420px; height: 74px; }
      h1 { margin: 44px 0 14px; font-family: Georgia, serif; font-size: 44px; line-height: 1.02; font-weight: 600; letter-spacing: -.02em; }
      h1 span { white-space: nowrap; }
      p { margin: 0; max-width: 540px; color: #d7cdbf; font-size: 21px; line-height: 1.45; }
      .chips { display: flex; gap: 10px; margin-top: 24px; }
      .chip { border: 1px solid #d9c48e88; background: #3a2d3dbf; color: #e7d7ad; padding: 8px 13px; border-radius: 4px; font-size: 13px; letter-spacing: .03em; }
      .notice { position: absolute; left: 64px; bottom: 28px; padding: 7px 11px; border-left: 3px solid #d9c48e; background: #241b28d9; color: #f4ecdf; font-size: 13px; font-weight: 650; letter-spacing: .025em; }
      .rule { position: absolute; left: 0; right: 0; bottom: 0; height: 10px; background: linear-gradient(90deg, #c16f59, #d9c48e, #7a9e7e); }
    </style></head><body><div class="card"><div class="world"></div><div class="wash"></div><div class="grain"></div><div class="content"><div class="lockup">${lockup}</div><h1>AI residents.<br><span>Real trade-offs.</span><br>A living town.</h1><p>An open civic deliberation engine with replayable, inspectable multi-agent simulations.</p><div class="chips"><span class="chip">ZERO-KEY DEMO</span><span class="chip">SCENARIO PACKAGES</span><span class="chip">MIT CODE · ATTRIBUTED ASSETS</span></div></div><div class="notice">SIMULATION, NOT A POLL · DOES NOT MEASURE REAL PUBLIC OPINION</div><div class="rule"></div></div></body></html>`);
    await page.screenshot({ path: join(MEDIA, "social-preview.png"), type: "png" });
  }

  await context.close();
  if (runtimeFailures.length) {
    throw new Error(`browser runtime failures:\n${[...new Set(runtimeFailures)].join("\n")}`);
  }
} catch (error) {
  if (String(error).includes("Executable doesn't exist")) {
    console.error("capture: Chromium is missing. Run `cd frontend && npx playwright install chromium`.");
  } else {
    console.error(`capture: ${error instanceof Error ? error.stack : error}`);
  }
  if (serverLog.trim()) console.error(serverLog.trim());
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => undefined);
  server.kill("SIGTERM");
}

if (!process.exitCode) {
  const gifBuilder = spawn(
    process.env.PYTHON || "python3",
    [join(SCRIPT_DIR, "make_gif.py"), tempFrames, join(MEDIA, "hero.gif")],
    { cwd: REPO_ROOT, stdio: "inherit" },
  );
  const gifCode = await new Promise((resolveCode) => gifBuilder.on("close", resolveCode));
  if (gifCode !== 0) process.exitCode = Number(gifCode) || 1;
}

if (!process.exitCode) {
  const portraitBuilder = spawn(
    process.env.PYTHON || "python3",
    [join(SCRIPT_DIR, "make_resident_portraits.py")],
    { cwd: REPO_ROOT, stdio: "inherit" },
  );
  const portraitCode = await new Promise((resolveCode) =>
    portraitBuilder.on("close", resolveCode),
  );
  if (portraitCode !== 0) process.exitCode = Number(portraitCode) || 1;
}

rmSync(tempFrames, { recursive: true, force: true });
if (!process.exitCode) console.log(`capture: launch media written to ${MEDIA}`);
