/**
 * Visual baselines for the surfaces that carry the product's look. They run
 * only inside the Playwright container (fonts and GPU rasterisation differ
 * per machine), gated by VISUAL=1:
 *
 *   npm run test:visual            # compare against e2e/__snapshots__
 *   npm run test:visual:update     # regenerate baselines (Docker only)
 *
 * See docs/media/README.md for the docker one-liner. Chrome at 1× and 2×.
 */
import { test, expect, type Page } from "@playwright/test";

const VISUAL = process.env.VISUAL === "1";
test.skip(!VISUAL, "visual baselines run inside the Playwright image (VISUAL=1)");

const DOM_TOLERANCE = { maxDiffPixelRatio: 0.01 };
const CANVAS_TOLERANCE = { maxDiffPixelRatio: 0.02 };

async function waitForTownScene(page: Page) {
  await page.waitForFunction(() => {
    const w = window as typeof window & { __town?: { freeze?: () => void; setWorldTime?: (h: number, m: number) => void } };
    return Boolean(w.__town?.freeze && w.__town?.setWorldTime);
  }, null, { timeout: 45_000 });
  // Residents seated, ambience settled.
  await page.waitForTimeout(2500);
}

async function stillTown(page: Page, hour: number) {
  await page.evaluate((h) => {
    const w = window as typeof window & { __town: { setWorldTime: (h: number, m: number) => void; freeze: () => void } };
    w.__town.setWorldTime(h, 0);
    w.__town.freeze();
  }, hour);
  await page.waitForTimeout(400);
}

test("atlas", async ({ page }) => {
  await page.goto("/#/map");
  await page.locator(".atlas-site").first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await expect(page).toHaveScreenshot("atlas.png", DOM_TOLERANCE);
});

test("town by day", async ({ page }) => {
  await page.goto("/?capture=1#/town/dover");
  await waitForTownScene(page);
  await stillTown(page, 14);
  await expect(page).toHaveScreenshot("town-day.png", CANVAS_TOLERANCE);
});

test("town by night", async ({ page }) => {
  await page.goto("/?capture=1#/town/dover");
  await waitForTownScene(page);
  await stillTown(page, 21);
  await expect(page).toHaveScreenshot("town-night.png", CANVAS_TOLERANCE);
});

test("results moment and the dashboard at the end", async ({ page }) => {
  await page.goto("/?capture=1#/town/dover");
  await waitForTownScene(page);
  const slider = page.getByRole("slider", { name: "Replay position" });
  await slider.focus();
  await page.keyboard.press("End");
  await page.locator(".results-overlay").waitFor({ timeout: 20_000 });
  await stillTown(page, 19);
  await expect(page).toHaveScreenshot("results.png", CANVAS_TOLERANCE);
  await page.goto("/#/dashboard");
  await page.locator(".ballot-bar").first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(800);
  await expect(page).toHaveScreenshot("dashboard-end.png", { ...DOM_TOLERANCE, fullPage: true });
});

test("phone town", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?capture=1#/town/dover");
  await waitForTownScene(page);
  await stillTown(page, 14);
  await expect(page).toHaveScreenshot("town-phone.png", CANVAS_TOLERANCE);
});
