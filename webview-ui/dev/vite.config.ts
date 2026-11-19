import { createReadStream, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

import { svelte } from "@sveltejs/vite-plugin-svelte"
import { defineConfig, type Plugin } from "vite"

import { SCENARIOS } from "./scenarios"

const codiconsDirectory = dirname(
  createRequire(import.meta.url).resolve("@vscode/codicons/dist/codicon.css"),
)
const CODICON_FILES: Record<string, string> = {
  "codicon.css": "text/css",
  "codicon.ttf": "font/ttf",
}

// `vscode-icon` loads the stylesheet by the href of #vscode-codicon-stylesheet into each shadow
// root, so it needs a real URL with the font beside it rather than a bundled import.
function serveCodicons(): Plugin {
  return {
    name: "harness-codicons",
    configureServer(server) {
      server.middlewares.use("/codicons", (request, response, next) => {
        // codicon.css asks for the font with a cache-busting query.
        const name = (request.url ?? "").replaceAll(/^\/|\?.*$/g, "")
        const contentType = CODICON_FILES[name]
        if (!contentType) {
          next()
          return
        }
        response.setHeader("Content-Type", contentType)
        createReadStream(join(codiconsDirectory, name)).pipe(response)
      })
    },
    generateBundle() {
      for (const name of Object.keys(CODICON_FILES)) {
        this.emitFile({
          type: "asset",
          fileName: `codicons/${name}`,
          source: readFileSync(join(codiconsDirectory, name)),
        })
      }
    },
  }
}

// The accessibility tests read the ids from here: their loader cannot import the TypeScript
// scenarios, whose `shared/` modules sit in the CommonJS root package.
function listScenarios(): Plugin {
  return {
    name: "harness-scenario-list",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "scenarios.json",
        source: JSON.stringify(SCENARIOS.map(({ id }) => id)),
      })
    },
  }
}

// The browser dev harness (see ../README.md). Separate from ../vite.config.ts, which builds the
// bundle the extension ships.
export default defineConfig({
  root: import.meta.dirname,
  base: "./",
  plugins: [
    svelte({ configFile: join(import.meta.dirname, "..", "svelte.config.js") }),
    serveCodicons(),
    listScenarios(),
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "esnext",
    rollupOptions: {
      input: {
        index: join(import.meta.dirname, "index.html"),
        frame: join(import.meta.dirname, "frame.html"),
      },
    },
  },
  server: { port: 5199 },
  preview: { port: 5199 },
})
