import { createRequire } from "node:module"
import path from "node:path"

// Extension-host bundler.
//
// esbuild does NOT type-check (it strips types); run `pnpm run tsc` (tsc
// --noEmit) separately to gate on types. Build-profile constants are
// injected via `define` (see config.js).
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

// Profile map values are already JSON.stringify'd — that's exactly what
// esbuild's `define` expects (raw text substituted at build time).
const define = {
  __DEBUG_MODE__: JSON.stringify(!production),
  ...apiConfig,
}

// systeminformation optionally `require`s these macOS-only native addons
// (cpu.js guards both osx-temperature-sensor and, as of 5.31,
// macos-temperature-sensor in their own try/catch). Neither is installed on
// other platforms; stub both to an empty module so the bundle resolves
// cleanly instead of leaving an unresolved runtime `require` in the CJS
// bundle.
const stubOptionalNativeAddon = {
  name: "stub-optional-native-addon",
  setup(build) {
    build.onResolve({ filter: /^(osx|macos)-temperature-sensor$/ }, (args) => ({
      path: args.path,
      namespace: "stub-empty",
    }))
    build.onLoad({ filter: /.*/, namespace: "stub-empty" }, () => ({
      contents: "module.exports = {};",
      loader: "js",
    }))
  },
}

// Emits markers/diagnostics the VS Code task problem-matcher understands (see
// the `esbuildWatch` task in .vscode/tasks.json).
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
  // Prefer the ESM entry of dual-published packages. In particular this picks
  // ts-results' patched `esm/` build (static, fully bundlable) over its UMD
  // `main`, whose factory-scoped `require("tslib")` esbuild cannot rewrite and
  // would otherwise leak as an unresolved runtime require (fatal under
  // `--no-dependencies` packaging).
  mainFields: ["module", "main"],
  // `vscode` is injected by the runtime; chai/mocha/vscode-test are resolved
  // from node_modules when the test bundles run inside the extension host.
  external: ["vscode", "mocha", "chai", "chai-as-promised", "vscode-test"],
  define,
  loader: {
    // docs/FAQ.md is imported as text (src/config/constants.ts).
    ".md": "text",
  },
  sourcemap: production ? false : "inline",
  minify: production,
  logLevel: "info",
  plugins: watch ? [stubOptionalNativeAddon, problemMatcherPlugin] : [stubOptionalNativeAddon],
}

// The two test outputs bundle every matching spec file into a single file
// via a generated in-memory entry point.
function aggregateEntry(globPattern) {
  const files = globSync(globPattern, { cwd: __dirname })
  const contents = files
    .map((f) => `import ${JSON.stringify("./" + f.split(path.sep).join("/"))};`)
    .join("\n")
  return { contents, resolveDir: __dirname }
}

/** @type {Array<import("esbuild").BuildOptions>} */
const builds = [
  {
    ...common,
    entryPoints: { extension: "./src/extension.ts" },
    outdir: "dist",
  },
  // The integration tier stays in test-electron and is bundled for the
  // mocha loader (bin/runIntegrationTests.js). Matches both *.spec.ts (this
  // tier's convention) and *.test.ts (the common convention elsewhere), so a
  // new integration test named the latter way isn't silently excluded from
  // the bundle.
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
