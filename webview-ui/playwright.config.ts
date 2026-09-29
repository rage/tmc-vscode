import { defineConfig, devices } from "@playwright/test"

// Accessibility smoke tests against the dev harness in plain Chromium (`pnpm run test:a11y`).
// The VS Code end-to-end suite is ../playwright.config.ts.
export default defineConfig({
  testDir: "./a11y",
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  // The repository root ignores test-results/; this package does not.
  outputDir: "../test-results/webview-a11y",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})
