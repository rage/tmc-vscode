import { defineConfig, devices } from "@playwright/test"

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: "./playwright",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // The retry exists to record a trace (see `use.trace`); a test that passes only
  // on it still fails the run.
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: !!process.env.CI,
  workers: 1,
  // The html reporter writes a report nobody opens in CI, and on its own it
  // prints no per-test output, so a failing run's log says only that the report
  // was written. `list` puts the failures in the log; `open: never` stops the
  // html reporter launching a browser on a local run.
  reporter: [["list"], ["html", { open: "never" }]],

  use: {
    // Honoured by playwright/fixtures.ts on the VS Code window; recording every
    // run costs time on every pass.
    trace: "on-first-retry",
  },

  timeout: 60 * 1000,
  expect: {
    timeout: 10 * 1000,
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  /*
   * Nothing else starts the mock backend, in CI or locally, so without this
   * every spec fails with ECONNREFUSED.
   *
   * A listener already on 4001 in CI would be serving some other run's build, so
   * refusing to reuse it turns that into a failure instead of a false pass;
   * locally, reusing the backend a developer already started is the point. The
   * generous timeout covers cold tsx transpilation.
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
