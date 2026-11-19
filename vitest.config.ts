import { defineConfig } from "vitest/config"

// The unit tier (`vscode` mocked) and the webview tier (Svelte 5 + jsdom) are separate
// projects, each with its own environment, plugins and aliases. Tests needing the real
// VS Code API live in src/test-integration.
export default defineConfig({
  test: {
    projects: ["./vitest.unit.config.ts", "./webview-ui/vitest.config.ts"],
    // Root-level: the v8 provider instruments across the whole run.
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["src/**", "webview-ui/src/**", "shared/**"],
      exclude: ["src/test/**", "src/test-integration/**", "webview-ui/src/test/**"],
      // A few points under what the suite reaches. Raise when coverage rises; never lower
      // to make a run pass.
      thresholds: {
        lines: 80,
        branches: 70,
        functions: 78,
      },
    },
  },
})
