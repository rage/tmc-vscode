import { copyFileSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

import { svelte } from "@sveltejs/vite-plugin-svelte"
import { defineConfig, type Plugin, type UserConfig } from "vite"

// Copies the codicon font + stylesheet into the build output, since the webview's CSP only
// allows resources under public/build and codicon.css references codicon.ttf relatively.
function copyCodicons(): Plugin {
  return {
    name: "copy-codicons",
    apply: "build",
    writeBundle() {
      const require = createRequire(import.meta.url)
      const cssPath = require.resolve("@vscode/codicons/dist/codicon.css")
      const ttfPath = join(dirname(cssPath), "codicon.ttf")
      const outDir = join(import.meta.dirname, "public", "build")
      mkdirSync(outDir, { recursive: true })
      copyFileSync(cssPath, join(outDir, "codicon.css"))
      copyFileSync(ttfPath, join(outDir, "codicon.ttf"))
    },
  }
}

// Builds the webview bundle the extension loads from
// `webview-ui/public/build/{bundle.js,bundle.css}` (see src/panels/TmcPanel.ts).
// Library mode keeps a single-IIFE + separate-CSS layout, with stable,
// unhashed filenames.
export default defineConfig(({ mode }): UserConfig => {
  const production = mode === "production"
  return {
    plugins: [svelte(), copyCodicons()],
    // The output dir lives under the default publicDir (public/); disable
    // publicDir so Vite does not copy public/* (index.html, favicon.png)
    // into the build output.
    publicDir: false,
    build: {
      outDir: "public/build",
      emptyOutDir: true,
      sourcemap: !production,
      minify: production,
      lib: {
        entry: "src/main.ts",
        formats: ["iife"],
        name: "app",
        fileName: () => "bundle.js",
      },
      rollupOptions: {
        output: {
          // Extracted CSS -> bundle.css (matches TmcPanel.ts).
          assetFileNames: "bundle.[ext]",
        },
      },
    },
  }
})
