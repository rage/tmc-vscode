import { createRequire } from "node:module"
import { resolve } from "node:path"

import type { Plugin } from "vite"
import { defineConfig } from "vitest/config"

// The extension host references build-time constants that esbuild injects via
// `define` (config.js profiles). Reuse the mock-backend profile so
// src/config/constants.ts resolves under vitest too.
const require = createRequire(import.meta.url)
const { mockBackend } = require("./config.js")
const define = { __DEBUG_MODE__: "true", ...mockBackend }

// src/config/constants.ts imports docs/FAQ.md as text (the esbuild build uses a
// `.md` text loader). Mirror that so the module graph resolves under vitest.
const markdownAsText: Plugin = {
  name: "markdown-as-text",
  transform(code, id) {
    if (id.endsWith(".md")) {
      return { code: `export default ${JSON.stringify(code)}`, map: null }
    }
    return undefined
  },
}

// Unit tier: extension-host logic that never needs a live VS Code instance —
// only the `vscode` module surface — so it runs under vitest in Node with
// `vscode` aliased to a jest-mock-vscode instance
// (src/test/support/vscode.cjs). CommonJS so Vite's interop exposes the mock
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
    // A few download/CLI tests spin up loopback servers and hash multi-MB
    // buffers; keep a 20s ceiling.
    testTimeout: 20000,
  },
})
