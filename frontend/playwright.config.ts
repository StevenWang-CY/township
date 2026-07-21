import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Keep E2E isolated from the normal `npm run preview` port. Reusing a preview
// can silently test a stale demo build after application files change.
const PORT = 4187;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // Phaser/WebGL contexts are intentionally exercised serially. Parallel
  // browser teardown is both noisy and resource-heavy on contributor laptops.
  fullyParallel: false,
  timeout: 60_000,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "line",
  // Keep generated screenshots/traces out of the repository regardless of OS.
  outputDir: join(tmpdir(), "township-playwright-results"),
  use: {
    baseURL: BASE_URL,
    colorScheme: "light",
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run demo:build && npm run demo:preview -- --host 127.0.0.1 --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
