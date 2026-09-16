import { defineConfig, devices } from "@playwright/test"

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: "./playwright",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: "html",

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
