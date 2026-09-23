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

import {
  captureDayInReview,
  captureNeighbors,
  heroCampaignBeats,
  openFeedRoute,
} from "./campaign.mjs";

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
// The campaign recording (Evolution III stages every feed a scenario ships).
const campaignFeedPath = join(DEMO_DIST, "demo", "nj11-2026--campaign.json");
const campaignFeed = existsSync(campaignFeedPath) ? JSON.parse(readFileSync(campaignFeedPath, "utf8")) : null;
if (!campaignFeed) console.warn("capture: no campaign feed staged — the hero's campaign beats will be skipped.");
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

/** Pin the replay to one speed ("1x", "2x", …) by cycling the toggle. */
async function setReplaySpeed(page, wanted = "1x") {
  const speed = page.locator('[aria-label^="Playback speed"]');
  if (!(await speed.isVisible().catch(() => false))) return;
  for (let i = 0; i < 4; i += 1) {
    const label = (await speed.getAttribute("aria-label")) || "";
    if (label.includes(`speed ${wanted}`)) return;
    await speed.click();
    await page.waitForTimeout(100);
  }
}

/**
 * Seek the replay to the last events before `town`'s final round ends —
 * so the decide phase that follows plays paced (residents walk to the
 * polls) instead of being landed on by a seek. Keyboard seeks step 15
 * events; the target is chosen so the landing always precedes round_ended.
 */
async function seekToDecide(page, feed, town) {
  const timeline = page.locator('[aria-label="Replay position"]');
  await timeline.waitFor({ state: "visible" });
  await pauseReplay(page);
  let lastEnded = -1;
  feed.events.forEach((event, index) => {
    if (event.type === "round_ended" && event.town === town) lastEnded = index;
  });
  if (lastEnded < 0) return false;
  await timeline.focus();
  await timeline.press("End");
  await page.waitForTimeout(400);
  const duration = Number(await timeline.getAttribute("aria-valuemax"));
  const target = lastEnded - 16;
  const presses = Math.floor((duration - target) / 15);
  for (let i = 0; i < presses; i += 1) await timeline.press("ArrowLeft");
  await page.waitForTimeout(700);
  return true;
}

/** Camera on the town's polling place (the civic layer knows where). */
async function framePollingPlace(page, zoom = 1.7) {
  return page.evaluate((z) => {
    const scene = window.__townshipScene;
    const poll = scene?.civic?.getPollingPlace?.();
    if (!scene || !poll) return false;
    window.__town?.setOverviewMode(false);
    const cam = scene.cameras.main;
    cam.panEffect?.reset();
    cam.zoomEffect?.reset();
    cam.setZoom(z);
    cam.centerOn(poll.x, poll.y + 8);
    return true;
  }, zoom);
}

async function pauseReplay(page) {
  const control = page.locator('[aria-label="Pause replay"]');
  if (await control.isVisible().catch(() => false)) {
    await control.click();
    await page.waitForTimeout(120);
  }
}

async function resumeReplay(page) {
  const control = page.locator('[aria-label="Play replay"]');
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

async function setTownMoment(page, hour, minute = 0, weather = "clear") {
  await page.evaluate(
    ({ targetHour, targetMinute, targetWeather }) => {
      window.__town?.setWeather(targetWeather);
      window.__town?.setWorldTime(targetHour, targetMinute);
    },
    { targetHour: hour, targetMinute: minute, targetWeather: weather },
  );
  await page.waitForTimeout(500);
}

/** Canvas-only frame for the hero GIF: the living town, no app chrome. */
async function heroFrame(page) {
  return page.locator(".town-canvas-wrapper").screenshot({
    type: "png",
    animations: "allow",
    style:
      ".proximity-card, .keyboard-hint, .player-hud, .atlas-card, .town-minimap-wrapper, .minimap, .town-switcher { display: none !important; }",
  });
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

  // Hero GIF: the campaign itself, cut in beats from the recorded 21-day
  // run — a weekday morning as commuters leave, a recorded conversation
  // between two voices with its own lines, a week of the calendar passing
  // as yard signs take colour, election day at the polling place, results
  // night — and the district atlas to close. Canvas only, no app chrome,
  // nothing staged by hand (scripts/capture/campaign.mjs).
  let heroBox = null;
  if (campaignFeed) {
    await openFeedRoute(page, ORIGIN, "/town/dover", "campaign");
    await heroCampaignBeats({
      page,
      feed: campaignFeed,
      town: "dover",
      frame: async (repeats = 1) => addHeroFrame(await heroFrame(page), repeats),
      setTownMoment,
      waitForTown,
    });
    heroBox = await page.locator("canvas").first().boundingBox();
    // The closing beat: the district atlas, cropped to the canvas aspect so
    // the GIF keeps one frame size.
    await openRoute(page, "/map");
    await page.locator(".atlas-site").first().waitFor({ timeout: 30_000 });
    await resetPageScroll(page);
    await settle(page, 900);
    const panel = await page.locator(".atlas-panel").first().boundingBox();
    if (panel && heroBox) {
      const aspect = heroBox.width / heroBox.height;
      let w = panel.width;
      let h = w / aspect;
      if (h > panel.height) { h = panel.height; w = h * aspect; }
      const clip = { x: panel.x + (panel.width - w) / 2, y: panel.y + (panel.height - h) / 2, width: w, height: h };
      for (let i = 0; i < 3; i += 1) {
        addHeroFrame(await page.screenshot({ type: "png", clip }), i === 2 ? 4 : 2);
        await page.waitForTimeout(500);
      }
    }
  }

  // District atlas: the storybook pixel overworld at /map (the town itself
  // is the landing). One clean product surface, then a composed still per
  // scenario with a town's hover card open.
  async function captureAtlas(scenario, hoverName, outPath) {
    await openRoute(page, "/map", scenario);
    await resetPageScroll(page);
    const site = page
      .locator(".atlas-site", { hasText: hoverName })
      .first();
    if (await site.isVisible().catch(() => false)) {
      await site.hover();
    }
    await settle(page, 600);
    await shot(page, outPath, { resetScroll: false });
  }

  await openRoute(page, "/map");
  await resetPageScroll(page);
  await settle(page, 500);
  await shot(page, join(MEDIA, "demo-player", "01-map.png"), { resetScroll: false });
  // Hover a mid-map town in each scenario: its card floats over open terrain
  // instead of covering the scenario cartouche in the corner.
  await captureAtlas(null, "Montclair", join(MEDIA, "scene", "atlas-nj11.png"));
  await captureAtlas(
    "millbrook-budget",
    "Harlow Crossing",
    join(MEDIA, "scene", "atlas-millbrook.png"),
  );

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
    await page.evaluate(() => window.__town?.setOverviewMode(true));
    await settleTownStill(page);
    await setTownMoment(page, 16, 30);
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
      // Timeline surface: the replay caught mid-conversation, then framed so
      // the recorded dialogue actually reads. Wait for a talking pair, pause,
      // move the camera onto them FIRST, and re-show the replay's own line
      // for the speaker as the readable spotlight bubble.
      await resumeReplay(page);
      await page
        .waitForFunction(() => {
          const scene = window.__townshipScene;
          if (!scene?.agentSprites) return false;
          // Cross-town conversations only mark the remote side, so a local
          // speech bubble counts as a speaker too, not just "talking".
          return [...scene.agentSprites.values()].some(
            (sprite) =>
              sprite.getActivity?.() === "talking" ||
              (sprite.getSpeechBubbleCount?.() || 0) > 0,
          );
        }, null, { timeout: 15_000 })
        .catch(() => undefined);
      await pauseReplay(page);
      const talkerId = await page.evaluate(() => {
        const scene = window.__townshipScene;
        if (!scene?.agentSprites) return null;
        // Frame whoever is mid-conversation here — the pair when both are
        // local, the lone local speaker when the partner is in another town.
        const talkers = [...scene.agentSprites.entries()].filter(
          ([, s]) =>
            s.getActivity?.() === "talking" ||
            (s.getSpeechBubbleCount?.() || 0) > 0,
        );
        if (talkers.length === 0) return null;
        const [aId, a] = talkers[0];
        const b = talkers[1]?.[1] ?? a;
        const cam = scene.cameras.main;
        cam.setZoom(1.45);
        cam.centerOn((a.x + b.x) / 2, (a.y + b.y) / 2 + 24);
        return aId;
      });
      if (talkerId) {
        const spoken = defaultFeed.events.find(
          (event) =>
            event.type === "agent_speech" &&
            event.agent_id === talkerId &&
            event.town === "dover",
        )?.text;
        if (spoken) {
          // Trim the recorded line at its last full stop under the bubble cap.
          let line = spoken;
          if (line.length > 138) {
            const cut = line.slice(0, 138);
            const end = Math.max(
              cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "),
            );
            line = end > 40 ? cut.slice(0, end + 1) : cut;
          }
          await page.waitForTimeout(250); // camera settled → bubble clamps right
          await page.evaluate(
            ({ id, text }) => {
              const scene = window.__townshipScene;
              scene?.agentSprites?.forEach?.((s) => s.clearSpeechBubbles?.());
              scene?.agentSprites?.get(id)?.showSpeechBubble(text, 9_000, "neutral", true);
            },
            { id: talkerId, text: line },
          );
        }
      }
      await page.waitForTimeout(350);
      writeFileSync(join(MEDIA, "demo-player", "03-timeline-seek.png"), await page.screenshot({ type: "png" }));
      await page.evaluate(() => {
        const scene = window.__townshipScene;
        scene?.agentSprites?.forEach?.((s) => s.clearSpeechBubbles?.());
        window.__town?.setOverviewMode(false);
        window.__town?.setOverviewMode(true);
      });
      await page.waitForTimeout(600);

      // Decision day: the recorded decide phase played paced, caught with a
      // resident at the ballot box, then the run's end with bunting and the
      // tally posted at the kiosk.
      if (await seekToDecide(page, defaultFeed, "dover")) {
        await setReplaySpeed(page, "1x");
        await framePollingPlace(page, 1.6);
        await resumeReplay(page);
        await page
          .waitForFunction(() => {
            const scene = window.__townshipScene;
            return [...(scene?.agentSprites?.values?.() ?? [])].some((s) => s.getActivity?.() === "voting");
          }, null, { timeout: 30_000 })
          .catch(() => undefined);
        await page.waitForTimeout(250);
        await pauseReplay(page);
        await page.evaluate(() => {
          window.__townshipScene?.agentSprites?.forEach?.((s) => s.clearSpeechBubbles?.());
          const keyboardHint = document.querySelector(".keyboard-hint");
          if (keyboardHint instanceof HTMLElement) keyboardHint.style.display = "none";
        });
        await shot(page, join(MEDIA, "demo-player", "06-decide.png"));
        const timeline = page.locator('[aria-label="Replay position"]');
        await timeline.focus();
        await timeline.press("End");
        await page.waitForTimeout(1_200);
        await framePollingPlace(page, 1.45);
        await settle(page, 500);
        await shot(page, join(MEDIA, "demo-player", "07-results.png"));
        await page.evaluate(() => {
          window.__town?.setOverviewMode(false);
          window.__town?.setOverviewMode(true);
        });
        await page.waitForTimeout(600);
      }
    }

    await settleTownStill(page);
    await setTownMoment(page, 21, 30);
    await shot(page, join(MEDIA, "scene", `${town.id}-night.png`));
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
    if (!node) return count === 0; // a zero-count option may sit out the legend
    return node.getAttribute("data-stance-count") === String(count);
  }), expectedFinalCounts);
  await settle(page, 1_200);
  await shot(page, join(MEDIA, "demo-player", "04-dashboard-end.png"));

  await openRoute(page, "/gods-view");
  await settle(page, 500);
  await shot(page, join(MEDIA, "demo-player", "05-gods-view.png"));

  // Campaign stills: the day in review as the calendar turns, and the roster
  // with its neighbors group open.
  if (campaignFeed) {
    await openFeedRoute(page, ORIGIN, "/town/dover", "campaign");
    await waitForTown(page, 12);
    await captureDayInReview(page, campaignFeed, "dover", shot, join(MEDIA, "demo-player", "08-campaign-week.png"));
    await captureNeighbors(page, shot, join(MEDIA, "demo-player", "09-neighbors.png"));
  }

  // Mobile stranger proof: no hidden desktop-only escape hatch.
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    colorScheme: "light",
  });
  const mobile = await mobileContext.newPage();
  watchRuntimeFailures(mobile, "mobile", runtimeFailures);
  await openRoute(mobile, "/map");
  await shot(mobile, join(MEDIA, "mobile", "map.png"));
  await openRoute(mobile, "/town/dover");
  await waitForTown(mobile, 3);
  await mobile.evaluate(() => window.__town?.setOverviewMode(true));
  await settleTownStill(mobile); // accelerated replay bubbles pile up on a phone-width map
  await setTownMoment(mobile, 16, 30);
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

if (process.env.TOWNSHIP_KEEP_FRAMES) {
  console.log(`capture: hero frames kept at ${tempFrames}`);
} else {
  rmSync(tempFrames, { recursive: true, force: true });
}
if (!process.exitCode) console.log(`capture: launch media written to ${MEDIA}`);
