// @ts-check
// Extension-host bundler. esbuild does not type-check; `pnpm run typecheck` does.
import { createRequire } from "node:module"
import path from "node:path"

import * as esbuild from "esbuild"
import { globSync } from "glob"

const require = createRequire(import.meta.url)
const { mockTmcLocalMooc, mockBackend, productionApi } = require("./config.js")

const __dirname = import.meta.dirname

const production = process.env.NODE_ENV === "production"
const watch = process.argv.includes("--watch")

const apiConfig = (() => {
  switch (process.env.BACKEND) {
    case "mockTmcLocalMooc":
      return mockTmcLocalMooc
    case "mockBackend":
      return mockBackend
    case "production":
      return productionApi
    default:
      console.warn("No backend set, defaulting to `production`")
      return productionApi
  }
})()

// Profile map values are already JSON.stringify'd, as `define` expects.
const define = {
  __DEBUG_MODE__: JSON.stringify(!production),
  ...apiConfig,
}

// Emits markers/diagnostics the VS Code task problem-matcher understands (see
// the `esbuildWatch` task in .vscode/tasks.json).
/** @type {import("esbuild").Plugin} */
const problemMatcherPlugin = {
  name: "esbuild-problem-matcher",
  setup(build) {
    build.onStart(() => {
      console.log("[watch] build started")
    })
    build.onEnd((result) => {
      for (const { text, location } of result.errors) {
        console.error(`✘ [ERROR] ${text}`)
        if (location) {
          console.error(`    ${location.file}:${location.line}:${location.column}:`)
        }
      }
      console.log("[watch] build finished")
    })
  },
}

/** @type {import("esbuild").BuildOptions} */
const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  // ts-results' UMD `main` has a factory-scoped `require("tslib")` that esbuild
  // cannot rewrite; it would leak as an unresolved runtime require (fatal under
  // `--no-dependencies` packaging). Its patched `esm/` build avoids that.
  mainFields: ["module", "main"],
  // `vscode` is injected by the runtime; chai and mocha are resolved from
  // node_modules when the test bundles run inside the extension host.
  external: ["vscode", "mocha", "chai"],
  define,
  loader: {
    // docs/FAQ.md is imported as text (src/config/constants.ts).
    ".md": "text",
  },
  // Kept out of the vsix by .vscodeignore's `**/*.map`; maps pasted "Show Logs"
  // stack traces back to source from the archived build artifact.
  sourcemap: true,
  minify: production,
  logLevel: "info",
  plugins: watch ? [problemMatcherPlugin] : [],
}

// Bundles every matching spec file via a generated in-memory entry point. An
// empty match is a build failure: the tier would otherwise run zero tests and pass.
/**
 * @param {string} globPattern
 * @returns {import("esbuild").StdinOptions}
 */
function aggregateEntry(globPattern) {
  const files = globSync(globPattern, { cwd: __dirname })
  if (files.length === 0) {
    throw new Error(`No test files matched ${globPattern}; the bundled suite would be empty.`)
  }
  const contents = files
    .map((f) => `import ${JSON.stringify("./" + f.split(path.sep).join("/"))};`)
    .join("\n")
  return { contents, resolveDir: __dirname }
}

/** @type {Array<import("esbuild").BuildOptions>} */
const builds = [
  {
    ...common,
    entryPoints: { extension: "./src/extension.ts", uninstall: "./src/uninstall.ts" },
    outdir: "dist",
  },
  // Bundled for the mocha loader (bin/runIntegrationTests.js). Matches both
  // suffixes so a misnamed test isn't silently excluded.
  {
    ...common,
    stdin: aggregateEntry("src/test-integration/**/*.{spec,test}.ts"),
    outfile: "dist/integration.spec.js",
  },
]

console.log(`esbuild building in ${production ? "production" : "development"} configuration.`)
console.log(`Configured TMC backend: ${apiConfig.__TMC_BACKEND_URL__}`)
console.log(`Configured MOOC backend: ${apiConfig.__MOOC_BACKEND_URL__}`)

if (watch) {
  const contexts = await Promise.all(builds.map((b) => esbuild.context(b)))
  await Promise.all(contexts.map((c) => c.watch()))
  console.log("[watch] watching for changes...")
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)))
}
