import { defineConfig, devices } from "@playwright/test"

// Tests against the dev harness in plain Chromium. The VS Code end-to-end suite is
// ../playwright.config.ts.
export default defineConfig({
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  // The repository root ignores test-results/; this package does not.
  outputDir: "../test-results/webview-harness",
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.001 } },
  projects: [
    { name: "a11y", testDir: "./a11y", use: { ...devices["Desktop Chrome"] } },
    // Baselines are rendered on Linux with DejaVu fonts, so they match only there.
    { name: "visual", testDir: "./visual", use: { ...devices["Desktop Chrome"] } },
  ],
})
