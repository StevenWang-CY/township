import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { SimulationEvent } from "../src/types/messages";

const TOWN_BOOT_TIMEOUT = 20_000;
const LIVE_WINDOW_REGRESSION_POINT = 500;

function watchRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console.error: ${message.text()}`);
  });
  return errors;
}

async function openMap(page: Page, scenario?: string) {
  const query = scenario ? `?scenario=${encodeURIComponent(scenario)}` : "";
  await page.goto(`/${query}#/`);
  await expect(page.getByRole("heading", { level: 1, name: "Township" })).toBeVisible();
  await expect(page.locator(".district-town-cards")).toBeVisible();
  // The atlas intentionally fades in. Axe must inspect the settled colors;
  // scanning mid-transition measures text blended against the background and
  // reports contrast values that do not exist in the resting interface.
  await expect(page.locator("main > div").first()).toHaveCSS("opacity", "1");
  await expect(page.locator(".district-town-cards button").last()).toHaveCSS("opacity", "1");
}

function townCard(page: Page, name: string) {
  return page.locator(".district-town-cards button").filter({ hasText: name });
}

async function waitForTownScene(page: Page) {
  const wrapper = page.locator(".town-canvas-wrapper");
  await expect(wrapper).toBeVisible();
  await expect(wrapper).toHaveAttribute("aria-busy", "false", { timeout: TOWN_BOOT_TIMEOUT });
  // Phaser may append tiny generated-texture canvases beside its renderer;
  // the first, full-size canvas is the actual town surface.
  await expect(wrapper.locator("canvas").first()).toBeVisible();
  await expect(page.getByRole("group", { name: "Replay timeline" })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Replay position" })).toBeVisible();
}

async function expectNoHorizontalPageOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(
    Math.max(dimensions.document, dimensions.body),
    `page width ${Math.max(dimensions.document, dimensions.body)}px exceeds the ${dimensions.viewport}px viewport`,
  ).toBeLessThanOrEqual(dimensions.viewport + 1);
}

async function expectAxeClean(page: Page, surface: string) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const readable = result.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => ({
      target: node.target.join(" "),
      failure: node.failureSummary,
    })),
  }));
  expect(readable, `${surface} has axe accessibility violations`).toEqual([]);
}

async function pauseReplay(page: Page) {
  const playButton = page.getByRole("button", { name: /(?:Play|Pause|Replay again) replay/ });
  if ((await playButton.getAttribute("aria-label")) === "Pause replay") {
    await playButton.click();
  }
  await expect(playButton).not.toHaveAttribute("aria-label", "Pause replay");
}

async function seekReplayToEnd(page: Page): Promise<number> {
  const slider = page.getByRole("slider", { name: "Replay position" });
  const duration = Number(await slider.getAttribute("aria-valuemax"));
  if (duration <= 0) throw new Error("replay slider has no measurable duration");
  await slider.focus();
  await slider.press("End");
  await expect.poll(async () => Number(await slider.getAttribute("aria-valuenow"))).toBe(duration);
  return duration;
}

interface RenderedReplaySnapshot {
  clock: { hour: number; minute: number };
  weather: string;
  agents: Record<string, {
    x: number;
    y: number;
    activity: string;
    opinionColor: string;
    opinion: string;
    speechBubbles: number;
  }>;
  conversationSpotlight: boolean;
}

async function renderedReplaySnapshot(page: Page): Promise<RenderedReplaySnapshot | null> {
  return page.evaluate(() => {
    const api = (window as typeof window & {
      __town?: { snapshot?: () => RenderedReplaySnapshot };
    }).__town;
    return api?.snapshot?.() ?? null;
  });
}

test("the disclosure stays visible and the replay provenance is honest", async ({ page }) => {
  await openMap(page, "millbrook-budget");

  const disclosure = page.getByRole("complementary", { name: "Simulation disclosure" });
  await expect(disclosure).toBeVisible();
  await expect(disclosure).toContainText("Township is a simulation, not a poll");
  await expect(disclosure.getByRole("button")).toHaveCount(0);

  await disclosure.getByText("What that means").click();
  await expect(disclosure).toContainText("The residents, towns, and local history are fictional composites");
  await expect(disclosure.getByRole("link", { name: "Read the responsible-use policy" })).toBeVisible();

  const demoNote = page.getByRole("note");
  await expect(demoNote).toContainText("published simulation artifact");
  await expect(demoNote).not.toContainText("Claude");

  const notices = await page.evaluate(() => fetch("./legal/THIRD_PARTY_NOTICES.md").then((response) => response.text()));
  expect(notices).toContain("Phaser");
  expect(notices).toContain("React Router DOM");
});

test("an invalid scenario bootstrap never substitutes or renders its facts", async ({ page }) => {
  await page.route("**/demo/manifest.json", (route) => route.fulfill({
    json: { default: "incomplete", scenarios: ["incomplete"] },
  }));
  await page.route("**/demo/incomplete-scenario.json", (route) => route.fulfill({
    json: {
      id: "incomplete",
      title: "Incomplete Fixture",
      question: "Should this invalid package render?",
      decision_kind: "vote",
      options: [{ id: "injected", name: "Injected Candidate", label: "Injected", color: "#123456" }],
      undecided: { id: "undecided", label: "Undecided", color: "#cccccc" },
      towns: [{ id: "injected-town", name: "Injected Town", tagline: "Should stay hidden", color: "#654321" }],
      total_rounds: 1,
      dates: { decision_day: "2027-01-01", prose: "A fixture date." },
      // Deliberately omits the required responsible_use disclosure.
    },
  }));

  await page.goto("/#/");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Township could not open this civic world");
  await expect(alert).toContainText("No candidate, town, or policy data has been substituted");
  await expect(page.getByText("Injected Candidate")).toHaveCount(0);
  await expect(page.getByText("Injected Town", { exact: true })).toHaveCount(0);
});

test("keyboard users can complete scenario-native onboarding without the canvas", async ({ page }) => {
  await page.goto("/?scenario=millbrook-budget#/onboarding");
  await expect(page.getByRole("heading", { level: 1, name: "Join the town square" })).toBeVisible();
  await expect(page.getByText("Democrat", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Republican", { exact: true })).toHaveCount(0);

  await page.getByLabel("Your name").fill("Alex Rivera");
  const townChoice = page.getByRole("radio", { name: /Harlow Crossing/ });
  await townChoice.focus();
  await townChoice.press("Space");
  await expect(townChoice).toBeChecked();
  const stanceChoice = page.getByRole("radio", { name: "Fix It First" });
  await stanceChoice.focus();
  await stanceChoice.press("Space");
  await expect(stanceChoice).toBeChecked();
  const portraitChoice = page.getByRole("radio", { name: "Portrait 4" });
  await portraitChoice.focus();
  await portraitChoice.press("Space");
  await expect(portraitChoice).toBeChecked();
  await page.getByLabel("Outfit").selectOption("labor");
  await page.getByLabel("What do you care about?").fill("Bridge safety, school buses");
  await page.getByLabel("Add a little context").fill("I commute across the bridge and want to hear the tradeoffs.");
  await expectAxeClean(page, "scenario onboarding");

  const submit = page.getByRole("button", { name: "Enter Harlow Crossing" });
  await submit.focus();
  await submit.press("Enter");
  await expect(page).toHaveURL(/\?scenario=millbrook-budget#\/town\/harlow-crossing$/);
  await expect(page.getByRole("heading", { level: 2, name: "Harlow Crossing" })).toBeVisible();
});

test("a scenario can reuse NJ ids without inheriting NJ presentation art", async ({ page }) => {
  const scenario = {
    id: "harbor-choice",
    title: "The Harbor Choice",
    question: "How should Harbor Point renew its waterfront?",
    decision_kind: "vote",
    options: [
      { id: "restore", name: "Restore the Pier", label: "Restore", color: "#397C78" },
      { id: "retreat", name: "Managed Retreat", label: "Retreat", color: "#9B6741" },
    ],
    undecided: { id: "undecided", label: "Undecided", color: "#C9C2B4" },
    // Town and agent ids deliberately collide with the NJ-11 package. Ids are
    // package-local, so neither the Dover map nor Carlos's authored outfit may
    // leak into this scenario.
    towns: [{ id: "dover", name: "Harbor Point", tagline: "Where the marsh meets Main Street", color: "#397C78", population: 2400 }],
    total_rounds: 1,
    dates: { decision_day: "2027-03-02", prose: "Town vote: March 2, 2027." },
    responsible_use: {
      core_notice: "Township is a simulation, not a poll. Its outputs do not measure real public opinion and must never be presented as if they do.",
      residents_notice: "All residents are fictional composites.",
      subjects_notice: "This scenario is fictional.",
      outputs_notice: "Every output is an LLM artifact.",
    },
  };
  const town = {
    name: "Harbor Point",
    tagline: "Where the marsh meets Main Street",
    accent_color: "#397C78",
    landmarks: [
      { name: "Tidal Creek", x: 0, y: 90, width: 1200, height: 80, type: "water", color: "#76AAB0" },
      { name: "Harbor Hall", x: 500, y: 220, width: 170, height: 120, type: "building", color: "#C7A774" },
      { name: "Marsh Green", x: 220, y: 500, width: 240, height: 150, type: "park", color: "#759B68" },
      { name: "Causeway", x: 100, y: 390, width: 1000, height: 34, type: "road", color: "#A58A69" },
    ],
  };
  const feed = {
    events: [{
      type: "simulation_started",
      towns: ["dover"],
      agents: [{
        id: "carlos-restrepo",
        name: "Mara Lee",
        town: "dover",
        occupation: "Harbormaster",
        opinion: { candidate: "undecided", confidence: 40, reasoning: "Listening first.", top_issues: ["flooding"] },
        location: "Harbor Hall",
        current_activity: "idle",
        initials: "ML",
        color: "#397C78",
      }],
    }],
  };

  const leakedArtRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/assets\/maps\/dover(?:-preview\.png|\.tmj)$/.test(new URL(request.url()).pathname)) {
      leakedArtRequests.push(request.url());
    }
  });

  await page.route("**/demo/manifest.json", (route) => route.fulfill({ json: { default: scenario.id, scenarios: [scenario.id] } }));
  await page.route(`**/demo/${scenario.id}-scenario.json`, (route) => route.fulfill({ json: scenario }));
  await page.route(`**/demo/${scenario.id}-towns.json`, (route) => route.fulfill({ json: { towns: { dover: town } } }));
  await page.route(`**/demo/${scenario.id}.json`, (route) => route.fulfill({ json: feed }));

  await page.goto(`/?scenario=${scenario.id}#/town/dover`);
  await waitForTownScene(page);
  await expect.poll(() => page.evaluate(() => {
    const api = (window as typeof window & { __town?: { mapMode?: () => string } }).__town;
    return api?.mapMode?.() ?? null;
  })).toBe("procedural");
  await expect.poll(() => page.evaluate(() => {
    const scene = (window as typeof window & {
      __townshipScene?: { getMiniMapData: () => { landmarks: Array<{ name: string }> } };
    }).__townshipScene;
    return scene?.getMiniMapData().landmarks.map((item) => item.name) ?? [];
  })).toEqual(["Tidal Creek", "Harbor Hall", "Marsh Green", "Causeway"]);
  await expect.poll(() => page.evaluate(() => {
    const scene = (window as typeof window & {
      __townshipScene?: {
        agentSprites?: Map<string, { bodySprite?: { texture?: { key?: string } } }>;
      };
    }).__townshipScene;
    return scene?.agentSprites?.get("carlos-restrepo")?.bodySprite?.texture?.key ?? null;
  })).toBe("char-Tamara_Taylor");
  expect(leakedArtRequests).toEqual([]);
});

test("the zero-backend district map loads without runtime errors", async ({ page }) => {
  const errors = watchRuntimeErrors(page);

  await openMap(page);
  await expect(page.locator(".district-map-pin")).toHaveCount(4);
  await expect(page.getByText("The NJ-11 Special Election", { exact: true }).first()).toBeVisible();
  // Let lazy images, the replay feed, and animation setup settle before the
  // error assertion so late resource/render failures are included.
  await page.waitForTimeout(750);

  expect(errors).toEqual([]);
});

test("a first-time demo visitor enters a town immediately and gets replay controls", async ({ page }) => {
  await openMap(page);
  await townCard(page, "Dover").click();

  await expect(page).toHaveURL(/#\/town\/dover$/);
  await expect(page).not.toHaveURL(/onboarding/);
  await expect(page.getByRole("heading", { level: 2, name: "Dover" })).toBeVisible();
  await waitForTownScene(page);
});

test("a first-time demo guest can use session-only accessibility settings", async ({ page }) => {
  await openMap(page);

  const settings = page.getByRole("button", { name: "Settings" });
  await expect(settings).toHaveAttribute("aria-expanded", "false");
  await settings.click();
  await expect(settings).toHaveAttribute("aria-expanded", "true");

  const panel = page.getByRole("dialog", { name: "Display and audio settings" });
  await expect(panel).toBeVisible();
  await panel.getByLabel("Reduced motion").check();
  await expect(page.locator("html")).toHaveAttribute("data-reduced-motion", "true");
  await panel.getByLabel("High contrast").check();
  await expect(page.locator("html")).toHaveClass(/high-contrast/);

  // The hosted replay guest is intentionally ephemeral, even when preferences
  // change. Interactive/local profiles continue to use the same context API.
  expect(await page.evaluate(() => localStorage.getItem("township-user-profile"))).toBeNull();

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(settings).toBeFocused();
});

test("the hosted journal is honest, request-free, and restores focus", async ({ page }) => {
  const journalRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/journal/")) {
      journalRequests.push(request.url());
    }
  });
  await openMap(page);

  const opener = page.getByRole("button", { name: "Open journal" });
  await opener.click();
  const journal = page.getByRole("dialog", { name: "Journal" });
  await expect(journal).toBeVisible();
  await expect(journal.getByText("This replay keeps no personal history")).toBeVisible();
  await expect(journal.getByRole("link", { name: "Run Township locally" })).toBeVisible();
  await expect(journal.getByRole("button", { name: "Refresh journal" })).toHaveCount(0);
  await expect(journal.getByRole("button", { name: "Close journal" })).toBeFocused();
  expect(journalRequests).toEqual([]);
  await expectAxeClean(page, "hosted journal");

  await page.keyboard.press("Escape");
  await expect(journal).toBeHidden();
  await expect(opener).toBeFocused();
  expect(journalRequests).toEqual([]);
});

test("the Millbrook demo stages its own towns and authoritative landmarks", async ({ page }) => {
  await openMap(page, "millbrook-budget");

  await expect(page.getByText("The Millbrook Surplus").first()).toBeVisible();
  await expect(townCard(page, "Millbrook Village")).toBeVisible();
  await expect(townCard(page, "Harlow Crossing")).toBeVisible();
  await expect(page.locator(".district-town-cards button")).toHaveCount(2);

  await townCard(page, "Millbrook Village").click();
  await expect(page).toHaveURL(/\?scenario=millbrook-budget#\/town\/millbrook-village$/);
  await waitForTownScene(page);

  // This is the exact data the Phaser scene is rendering, not merely copy on
  // a React card. Poll because staged town JSON lands just after scene boot.
  await expect.poll(async () => page.evaluate(() => {
    const scene = (window as typeof window & {
      __townshipScene?: {
        getMiniMapData: () => { landmarks: Array<{ name: string }> };
      };
    }).__townshipScene;
    return scene?.getMiniMapData().landmarks.map((landmark) => landmark.name) ?? [];
  })).toEqual(expect.arrayContaining([
    "Stillwater River",
    "Harrow Mill Ruins",
    "Millbrook Town Hall",
  ]));
});

test("keyboard users can identify landmarks, enter a town, and operate the replay", async ({ page }) => {
  await openMap(page);

  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("navigation")).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();

  const doverPin = page.locator('.district-map-pin[aria-label^="Dover."]');
  await doverPin.focus();
  await expect(doverPin).toBeFocused();
  await page.keyboard.press("Enter");
  await waitForTownScene(page);

  const playButton = page.getByRole("button", { name: /(?:Play|Pause) replay/ });
  await playButton.focus();
  await expect(playButton).toBeFocused();
  // Pause a playing feed (or start a ready feed), then use the explicit
  // slider keyboard contract. Either state is valid when the town finishes
  // booting, because the replay prepares asynchronously.
  if ((await playButton.getAttribute("aria-label")) === "Pause replay") await playButton.press("Enter");

  const slider = page.getByRole("slider", { name: "Replay position" });
  await slider.focus();
  const before = Number(await slider.getAttribute("aria-valuenow"));
  await slider.press("ArrowRight");
  await expect.poll(async () => Number(await slider.getAttribute("aria-valuenow"))).toBeGreaterThan(before);
});

test("seeking beyond the live window and backward reconciles rendered replay state", async ({ page }) => {
  await openMap(page);

  // Discover the active fixture, a chapter beyond the live 500-event ceiling,
  // and a resident whose recorded position changes across that chapter. The
  // contract test remains scenario-generic: it never assumes a town, resident,
  // option, round number, or total event count.
  const bundle = await page.evaluate(async () => {
    const manifest = await fetch("./demo/manifest.json").then((response) => response.json()) as {
      default: string;
    };
    const feed = await fetch(`./demo/${manifest.default}.json`).then((response) => response.json());
    return { feed };
  }) as {
    feed: { events: SimulationEvent[] };
  };

  const starts = bundle.feed.events.find((event) => event.type === "simulation_started");
  if (!starts || starts.type !== "simulation_started") throw new Error("demo feed has no roster");

  const firstChapterByRound = new Map<number, number>();
  bundle.feed.events.forEach((event, index) => {
    if (event.type === "round_started" && !firstChapterByRound.has(event.round)) {
      firstChapterByRound.set(event.round, index);
    }
  });
  const backwardChapter = [...firstChapterByRound.entries()]
    .map(([round, index]) => ({ round, index }))
    .find(({ index }) => index > LIVE_WINDOW_REGRESSION_POINT);
  if (!backwardChapter) throw new Error("demo feed needs a chapter beyond the live event window");

  const movesByAgent = new Map<string, Array<{
    index: number;
    town: string;
    x: number;
    y: number;
  }>>();
  bundle.feed.events.forEach((event, index) => {
    if (
      event.type !== "agent_moved" ||
      !Number.isFinite(event.x) ||
      !Number.isFinite(event.y)
    ) return;
    const moves = movesByAgent.get(event.agent_id) ?? [];
    moves.push({ index, town: event.town, x: event.x!, y: event.y! });
    movesByAgent.set(event.agent_id, moves);
  });

  const pair = [...movesByAgent.entries()]
    .map(([agentId, moves]) => ({ agentId, moves }))
    .find(({ moves }) =>
      moves.some((move) => move.index < backwardChapter.index) &&
      moves.some((move) => move.index > backwardChapter.index));
  if (!pair) throw new Error("demo feed needs a resident move on both sides of the chapter");

  const agent = starts.agents.find((candidate) => candidate.id === pair.agentId);
  if (!agent) throw new Error("moved resident is absent from simulation_started");
  const town = pair.moves[0].town;
  await page.goto(`/#/town/${encodeURIComponent(town)}`);
  await waitForTownScene(page);
  await pauseReplay(page);
  await expect(
    page.locator("button.resident-card--compact").filter({ hasText: agent.name }),
  ).toBeVisible();

  // Position zero has applied no event, yet transport metadata should already
  // provide the feed's canonical roster (not scenario-specific UI furniture).
  const initialSlider = page.getByRole("slider", { name: "Replay position" });
  await initialSlider.focus();
  await initialSlider.press("Home");
  await expect.poll(async () => Number(await initialSlider.getAttribute("aria-valuenow"))).toBe(0);
  await expect.poll(async () => Boolean((await renderedReplaySnapshot(page))?.agents[agent.id])).toBe(true);

  const expectedAt = (position: number) => {
    let x: number | undefined;
    let y: number | undefined;
    let candidate = agent.opinion.candidate;
    let clock = { hour: 8, minute: 0 };
    let weather = "clear";
    for (let i = 0; i < position; i++) {
      const event = bundle.feed.events[i];
      if (event.type === "agent_moved" && event.agent_id === agent.id) {
        x = event.x ?? undefined;
        y = event.y ?? undefined;
      } else if (event.type === "opinion_changed" && event.agent_id === agent.id) {
        candidate = event.new_opinion.candidate;
      } else if (event.type === "world_clock_tick") {
        clock = { hour: event.hour, minute: event.minute };
      } else if (event.type === "weather_changed") {
        weather = event.weather;
      }
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("expected precise resident move");
    return { x, y, clock, weather, opinion: candidate };
  };

  const assertRenderedAt = async (position: number) => {
    const expected = expectedAt(position);
    await expect.poll(async () => {
      const snapshot = await renderedReplaySnapshot(page);
      const rendered = snapshot?.agents[agent.id];
      return snapshot && rendered ? {
        x: rendered.x,
        y: rendered.y,
        opinion: rendered.opinion,
        speechBubbles: rendered.speechBubbles,
        clock: snapshot.clock,
        weather: snapshot.weather,
        conversationSpotlight: snapshot.conversationSpotlight,
      } : null;
    }).toEqual({
      x: expected.x,
      y: expected.y,
      opinion: expected.opinion,
      speechBubbles: 0,
      clock: expected.clock,
      weather: expected.weather,
      conversationSpotlight: false,
    });
  };

  const laterPosition = await seekReplayToEnd(page);
  expect(laterPosition).toBeGreaterThan(LIVE_WINDOW_REGRESSION_POINT);
  await assertRenderedAt(laterPosition);

  await page.getByRole("button", {
    name: new RegExp(`^Skip to round ${backwardChapter.round}(?:\\s|\\()`),
  }).click();
  const slider = page.getByRole("slider", { name: "Replay position" });
  const earlierPosition = backwardChapter.index + 1;
  await expect.poll(async () => Number(await slider.getAttribute("aria-valuenow"))).toBe(earlierPosition);
  expect(earlierPosition).toBeGreaterThan(LIVE_WINDOW_REGRESSION_POINT);
  expect(earlierPosition).toBeLessThan(laterPosition);
  await assertRenderedAt(earlierPosition);

  const replayedPosition = await seekReplayToEnd(page);
  await assertRenderedAt(replayedPosition);
});

test("the map surface passes automated WCAG A/AA checks", async ({ page }) => {
  await openMap(page);
  await expectAxeClean(page, "district map");
});

test("the dashboard surface passes automated WCAG A/AA checks", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/dashboard");
  await expect(page.getByRole("heading", { level: 1, name: "District Dashboard" })).toBeVisible();
  await expect(page.locator("[data-stance-id]").first()).toBeVisible();
  await seekReplayToEnd(page);
  await page.waitForTimeout(750);
  const replayBarCollisions = await page.evaluate(() => {
    const bar = document.querySelector(".demo-timeline")?.getBoundingClientRect();
    if (!bar) return ["missing replay bar"];
    return [...document.querySelectorAll(".dashboard-town-issue")]
      .map((node) => node.getBoundingClientRect())
      .filter((rect) => rect.top < bar.bottom && rect.bottom > bar.top)
      .map((rect) => `${Math.round(rect.top)}-${Math.round(rect.bottom)}`);
  });
  expect(replayBarCollisions, "the replay bar obscures town issue rows").toEqual([]);
  await expectAxeClean(page, "district dashboard");
});

test("God's View reads package hypotheses without backend requests and passes axe", async ({ page }) => {
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url());
  });

  await page.goto("/?scenario=millbrook-budget#/gods-view");
  await expect(page.getByRole("heading", { level: 1, name: "God's View" })).toBeVisible();
  const scenario = page.getByRole("button", { name: /Storm Topples the Mill's East Wall/ });
  await expect(scenario).toBeVisible();
  await expect(page.getByText("ICE Enforcement in Dover")).toHaveCount(0);
  await scenario.click();
  await expect(scenario).toHaveAttribute("aria-pressed", "true");
  const prompt = page.getByLabel("What if...");
  await expect(prompt).toHaveAttribute("readonly", "");
  await expect(prompt).toHaveValue(/overnight nor'easter/);
  await expect(page.getByRole("button", { name: "Inject Scenario" })).toBeDisabled();
  await expect(page.getByText(/local zero-key install/)).toBeVisible();
  expect(apiRequests).toEqual([]);
  await page.waitForTimeout(500);
  await expectAxeClean(page, "hosted God's View");
  expect(apiRequests).toEqual([]);
});

test("the town surface passes automated WCAG A/AA checks", async ({ page }) => {
  await openMap(page);
  await townCard(page, "Dover").click();
  await waitForTownScene(page);
  await expectAxeClean(page, "town replay");
});

test("390px mobile map and town do not create horizontal page scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openMap(page);
  await expectNoHorizontalPageOverflow(page);

  // The fixed-seed capture mode makes the demo guest/resident proximity
  // deterministic while exercising the identical responsive layout.
  await page.goto("/?capture=1#/town/dover");
  await waitForTownScene(page);
  const speed = page.locator('[aria-label^="Playback speed"]');
  for (let i = 0; i < 3; i += 1) {
    if (((await speed.getAttribute("aria-label")) ?? "").includes("4x")) break;
    await speed.click();
  }
  await expect.poll(() => page.evaluate(() => {
    const scene = (window as typeof window & {
      __townshipScene?: { agentSprites?: { size?: number } };
    }).__townshipScene;
    return Number(scene?.agentSprites?.size ?? 0);
  })).toBeGreaterThanOrEqual(4);
  await expectNoHorizontalPageOverflow(page);
  await expect(page.locator(".keyboard-hint")).toBeHidden();
  const proximityCard = page.locator(".proximity-card");
  await expect(proximityCard).toBeVisible({ timeout: 15_000 });
  const cardBounds = await proximityCard.boundingBox();
  const canvasBounds = await page.locator(".town-canvas-wrapper").boundingBox();
  expect(cardBounds).not.toBeNull();
  expect(canvasBounds).not.toBeNull();
  expect(cardBounds!.x).toBeGreaterThanOrEqual(canvasBounds!.x - 1);
  expect(cardBounds!.x + cardBounds!.width).toBeLessThanOrEqual(
    canvasBounds!.x + canvasBounds!.width + 1,
  );
  const shellBounds = await page.evaluate(() => {
    const main = document.querySelector("main")?.getBoundingClientRect();
    const timeline = document.querySelector(".demo-timeline")?.getBoundingClientRect();
    return main && timeline
      ? { mainBottom: main.bottom, timelineTop: timeline.top }
      : null;
  });
  expect(shellBounds).not.toBeNull();
  expect(shellBounds!.mainBottom).toBeLessThanOrEqual(shellBounds!.timelineTop + 1);
});
