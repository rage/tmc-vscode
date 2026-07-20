import { svelte } from "@sveltejs/vite-plugin-svelte"
import { defineConfig } from "vitest/config"

// Webview component tier: renders the Svelte 5 components with
// @testing-library/svelte in jsdom. Proves the harness end to end (a component
// mounts, reacts to a valid message payload, and posts messages back through
// the mocked webview API — see src/test/setup.ts).
export default defineConfig({
  plugins: [svelte()],
  // Resolve the browser build of Svelte and @testing-library/svelte.
  resolve: {
    conditions: ["browser"],
  },
  test: {
    name: "webview",
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./src/test/setup.ts"],
    // @testing-library/svelte ships a .svelte wrapper that must be run through
    // vite-plugin-svelte rather than Node's native loader.
    server: {
      deps: {
        inline: [/@testing-library\/svelte/, /svelte/],
      },
    },
  },
})
