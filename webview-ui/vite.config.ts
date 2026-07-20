import { svelte } from "@sveltejs/vite-plugin-svelte"
import { defineConfig, type UserConfig } from "vite"

// Builds the webview bundle the extension loads from
// `webview-ui/public/build/{bundle.js,bundle.css}` (see src/panels/TmcPanel.ts).
// Library mode keeps a single-IIFE + separate-CSS layout, with stable,
// unhashed filenames.
export default defineConfig(({ mode }): UserConfig => {
  const production = mode === "production"
  return {
    plugins: [svelte()],
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
