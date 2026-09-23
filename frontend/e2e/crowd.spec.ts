import { expect, test, type Page } from "@playwright/test";

/**
 * Crowd contract on the recorded replay: residents walk axis-aligned routes,
 * cross asphalt only at crossings, never stand on the road or on top of
 * each other, and a seek re-derives the same seats and indoor state.
 */

const TOWN_BOOT_TIMEOUT = 20_000;

interface CrowdStats {
  residents: number;
  walking: number;
  indoors: number;
  held: number;
  minPairDistance: number | null;
  closestPair: [string, string] | null;
  onRoad: string[];
  jaywalking: string[];
  positions: Record<string, { x: number; y: number; indoors: boolean }>;
}

interface TownApi {
  lastPaths: () => Array<{ from: { x: number; y: number }; path: Array<{ x: number; y: number }> }>;
  crowdStats: () => CrowdStats;
  snapshot: () => { agents: Record<string, { x: number; y: number; indoors?: boolean; spot?: string | null }> };
}

async function openDover(page: Page) {
  await page.goto("/#/town/dover");
  const wrapper = page.locator(".town-canvas-wrapper");
  await expect(wrapper).toBeVisible();
  await expect(wrapper).toHaveAttribute("aria-busy", "false", { timeout: TOWN_BOOT_TIMEOUT });
  await expect(page.getByRole("slider", { name: "Replay position" })).toBeVisible();
  await page.waitForFunction(() => {
    const api = (window as unknown as { __town?: { crowdStats?: () => CrowdStats } }).__town;
    return Boolean(api?.crowdStats && api.crowdStats().residents >= 4);
  }, null, { timeout: TOWN_BOOT_TIMEOUT });
}

async function stats(page: Page): Promise<CrowdStats> {
  return page.evaluate(() => (window as unknown as { __town: TownApi }).__town.crowdStats());
}

async function setSpeed(page: Page, wanted: string) {
  const button = page.locator('[aria-label^="Playback speed"]');
  for (let i = 0; i < 6; i++) {
    const label = (await button.getAttribute("aria-label")) ?? "";
    if (label.includes(wanted)) return;
    await button.click();
  }
}

test("replayed residents walk in straight legs and cross only at crossings", async ({ page }) => {
  await openDover(page);
  const play = page.getByRole("button", { name: /(?:Play|Pause|Replay again) replay/ });
  if ((await play.getAttribute("aria-label")) !== "Pause replay") await play.click();
  await setSpeed(page, "4×");

  const samples: CrowdStats[] = [];
  for (let i = 0; i < 60; i++) {
    samples.push(await stats(page));
    await page.waitForTimeout(500);
  }
  const paths = await page.evaluate(() => (window as unknown as { __town: TownApi }).__town.lastPaths());
  expect(paths.length, "the replay should have routed at least one walk").toBeGreaterThan(0);

  // Every leg is axis-aligned; only the final hop onto the exact spot may be short and oblique.
  const oblique: string[] = [];
  for (const { from, path } of paths) {
    let prev = from;
    path.forEach((p, i) => {
      const dx = Math.abs(p.x - prev.x);
      const dy = Math.abs(p.y - prev.y);
      const len = Math.hypot(dx, dy);
      const last = i === path.length - 1;
      if (dx > 0.5 && dy > 0.5 && !(last && len <= 12.5)) {
        oblique.push(`${prev.x},${prev.y}->${p.x},${p.y}`);
      }
      prev = p;
    });
  }
  expect(oblique, "diagonal walking legs").toEqual([]);

  // Nobody stands on asphalt, and walkers over asphalt are on a crossing.
  const standing = samples.flatMap((s) => s.onRoad);
  expect(standing, "residents standing on the road").toEqual([]);
  const jay = samples.flatMap((s) => s.jaywalking);
  expect(jay, "walkers on asphalt outside a crossing").toEqual([]);

  // Outdoor residents keep their distance (a facing chat pair is 32 px).
  const tooClose = samples
    .filter((s) => s.minPairDistance !== null && s.minPairDistance < 26)
    .map((s) => `${s.closestPair?.join("~")}:${s.minPairDistance}`);
  expect(tooClose, "residents closer than 26 px").toEqual([]);
});

test("seeking re-derives identical seats and indoor state", async ({ page }) => {
  await openDover(page);
  const play = page.getByRole("button", { name: /(?:Play|Pause|Replay again) replay/ });
  if ((await play.getAttribute("aria-label")) === "Pause replay") await play.click();
  const slider = page.getByRole("slider", { name: "Replay position" });
  const duration = Number(await slider.getAttribute("aria-valuemax"));
  expect(duration).toBeGreaterThan(0);

  // A seek re-derives every seat at once; the overlap resolver then settles
  // the last few pixels over a handful of ticks, so sample once nothing has
  // moved for a beat rather than at a fixed delay.
  const settled = async () => {
    let last = JSON.stringify((await stats(page)).positions);
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(150);
      const now = JSON.stringify((await stats(page)).positions);
      if (now === last) return;
      last = now;
    }
  };
  const seekTo = async (key: "End" | "Home") => {
    await slider.focus();
    await slider.press(key);
    await expect.poll(async () => Number(await slider.getAttribute("aria-valuenow")))
      .toBe(key === "End" ? duration : 0);
    await settled();
  };
  await seekTo("End");
  const first = (await stats(page)).positions;
  await seekTo("Home");
  await seekTo("End");
  const second = (await stats(page)).positions;
  expect(second).toEqual(first);
  // Someone is inside on results night at 19:00 (work/home) — the indoor
  // state must be part of what a seek re-derives.
  const snapshot = await page.evaluate(() => (window as unknown as { __town: TownApi }).__town.snapshot());
  for (const agent of Object.values(snapshot.agents)) {
    expect(typeof agent.indoors).toBe("boolean");
  }
});

/**
 * The map contract behind all of the above: in every shipped town, every
 * door, standing spot and edge portal reaches every other on pavement —
 * sidewalks, paths, lots and painted crossings — never over open asphalt
 * and never through a wall. A prop on a corner, a missing zebra or a
 * parapet one tile too long shows up here before it shows up as a resident
 * walking into traffic.
 */
const TOWNS: Array<[string, string]> = [
  ["nj11-2026", "dover"],
  ["nj11-2026", "montclair"],
  ["nj11-2026", "parsippany"],
  ["nj11-2026", "randolph"],
  ["millbrook-budget", "millbrook-village"],
  ["millbrook-budget", "harlow-crossing"],
];

for (const [scenario, town] of TOWNS) {
  test(`${town}: every door, spot and portal connects on pavement`, async ({ page }) => {
    await page.goto(`/?scenario=${scenario}#/town/${town}`);
    const wrapper = page.locator(".town-canvas-wrapper");
    await expect(wrapper).toHaveAttribute("aria-busy", "false", { timeout: TOWN_BOOT_TIMEOUT });
    await page.waitForFunction(() => {
      const api = (window as unknown as { __town?: { pavementAudit?: () => unknown } }).__town;
      return Boolean(api?.pavementAudit);
    }, null, { timeout: TOWN_BOOT_TIMEOUT });
    const audit = await page.evaluate(() => (window as unknown as {
      __town: { pavementAudit: () => { points: number; pairs: number; bad: Array<{ a: string; b: string; why: string }> } };
    }).__town.pavementAudit());
    expect(audit.points, "the town should expose doors, spots and portals").toBeGreaterThan(8);
    expect(audit.bad, "pairs that need the road or have no route").toEqual([]);
  });
}
