import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./playwright",
  // upgrade/: run by playwright.upgrade.config.ts, against packaged VSIXs. real/: opt-in, see
  // playwright.real.config.ts.
  testIgnore: ["upgrade/**", "real/**"],
  globalSetup: "./playwright/mockBackendLock.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // The retry exists to record a trace (see `use.trace`); a test that passes only
  // on it still fails the run.
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: !!process.env.CI,
  workers: 1,
  // `list` puts failures in the CI log, which the html reporter alone does not; `open: never`
  // stops the html reporter launching a browser locally.
  reporter: [["list"], ["html", { open: "never" }]],

  use: {
    // Honoured by playwright/fixtures.ts on the VS Code window; recording every run is slow.
    trace: "on-first-retry",
  },

  timeout: 60 * 1000,
  expect: {
    timeout: 10 * 1000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  /*
   * Nothing else starts the mock backend; without this every spec fails with ECONNREFUSED.
   *
   * In CI a listener already on 4001 would serve some other run's build, so reuse is refused;
   * locally, reusing a developer's running backend is the point. The generous timeout covers
   * cold tsx transpilation.
   */
  webServer: {
    command: "pnpm run backend:start",
    port: 4001,
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    stdout: "pipe",
    stderr: "pipe",
  },
})
