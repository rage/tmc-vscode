import { vitePreprocess } from "@sveltejs/vite-plugin-svelte"

// vitePreprocess handles `<script lang="ts">`.
export default {
  preprocess: vitePreprocess(),
  // Without this, a file with no rune in it silently compiles in legacy mode.
  compilerOptions: { runes: true },
}
