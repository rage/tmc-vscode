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
   * Without this, `playwright test` run directly (sandbox/local) leaves
   * nothing listening on 4001 and every spec fails with ECONNREFUSED; CI
   * worked because it started the backend out-of-band.
   *
   * `reuseExistingServer` keeps that CI flow intact by reusing an
   * already-listening backend instead of erroring on the busy port. The
   * generous timeout covers cold tsx transpilation in a sandbox.
   */
  webServer: {
    command: "pnpm run backend:start",
    port: 4001,
    reuseExistingServer: true,
    timeout: 120 * 1000,
    stdout: "pipe",
    stderr: "pipe",
  },
})
