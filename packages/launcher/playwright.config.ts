import { defineConfig } from "@playwright/test"

// GUI E2E for the launcher via Playwright's Electron support. Runs serially
// (one Electron app at a time) with generous timeouts because specs perform
// real agent installs. The JSON reporter output feeds the daily results table
// built in CI (.github/workflows/launcher-agent-e2e.yml).
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // Spike: 0 retries so a failure doesn't burn a second ~15-min install. Bump
  // back to 1 for nightly once the flow is stable.
  retries: 0,
  // Per-test caps are set inside specs (installs need up to ~15 min); this is a
  // backstop so a wedged app can't hang the job indefinitely.
  timeout: 20 * 60 * 1000,
  expect: { timeout: 30_000 },
  reporter: [
    ["list"],
    ["json", { outputFile: "e2e-results/results.json" }],
    ["html", { open: "never", outputFolder: "e2e-results/html" }],
  ],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
})
