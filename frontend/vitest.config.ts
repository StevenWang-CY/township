import { defineConfig } from "vitest/config";

// Pure-module unit tests (nav grid, spot registry, lib helpers). Browser
// behaviour stays in Playwright (e2e/); anything that needs Phaser is mocked.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
    passWithNoTests: true,
  },
});
