import { createRequire } from "node:module"
import { resolve } from "node:path"

import type { Plugin } from "vite"
import { defineConfig } from "vitest/config"

// Reuse the mock-backend profile for the build-time constants esbuild injects
// via `define`.
const require = createRequire(import.meta.url)
const { mockBackend } = require("./config.js")
const define = { __DEBUG_MODE__: "true", ...mockBackend }

// Mirrors esbuild's `.md` text loader (constants.ts imports docs/FAQ.md).
const markdownAsText: Plugin = {
  name: "markdown-as-text",
  transform(code, id) {
    if (id.endsWith(".md")) {
      return { code: `export default ${JSON.stringify(code)}`, map: null }
    }
    return undefined
  },
}

// Unit tier: runs in Node with `vscode` aliased to a jest-mock-vscode instance
// (src/test/support/vscode.cjs), which is CommonJS so Vite's interop exposes its
// members as named exports for `import * as vscode`.
export default defineConfig({
  define,
  plugins: [markdownAsText],
  resolve: {
    alias: [{ find: /^vscode$/, replacement: resolve(__dirname, "src/test/support/vscode.cjs") }],
  },
  test: {
    name: "unit",
    globals: true,
    environment: "node",
    include: ["src/test/**/*.test.ts"],
    // jest-mock-vscode's spies are module-level vi.fn()s that restoreAllMocks restores to
    // rather than clears, so without this their call history leaks between tests.
    clearMocks: true,
    // Download/CLI tests run loopback servers and hash multi-MB buffers.
    testTimeout: 20000,
  },
})
