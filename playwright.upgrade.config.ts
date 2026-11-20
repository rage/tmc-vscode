import { defineConfig } from "@playwright/test"

import baseConfig from "./playwright.config"

/**
 * The upgrade E2E: installs released VSIXs into one VS Code profile instead of loading this
 * checkout, so it runs apart from the main suite. `bin/packageUpgradeVsix.sh` builds its VSIX.
 */
export default defineConfig({
  ...baseConfig,
  testDir: "./playwright/upgrade",
  testIgnore: [],
})
