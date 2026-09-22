import { defineConfig } from "vitest/config"

// Root vitest config. The unit tier (extension-host logic with `vscode`
// mocked) and the webview component tier (Svelte 5 + jsdom) run as two
// projects so each keeps its own environment, plugins and module aliases.
//
// Tests that genuinely need the real VS Code API stay in the test-electron
// integration tier (src/test-integration, run via `pnpm run
// test:integration`).
export default defineConfig({
  test: {
    projects: ["./vitest.unit.config.ts", "./webview-ui/vitest.config.ts"],
    // Coverage is configured at the root, not per-project: the v8 provider
    // instruments across the whole run. `pnpm run test:coverage` wires this up.
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["src/**", "webview-ui/src/**", "shared/**"],
      exclude: ["src/test/**", "src/test-integration/**", "webview-ui/src/test/**"],
      // A few points under what the suite reaches, so ordinary churn does not
      // trip them and a real drop still does. Raise them when the measured
      // numbers move up, never lower them to make a run pass.
      thresholds: {
        lines: 79,
        branches: 68,
        functions: 77,
      },
    },
  },
})
