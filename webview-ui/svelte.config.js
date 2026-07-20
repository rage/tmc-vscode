import { vitePreprocess } from "@sveltejs/vite-plugin-svelte"

// vitePreprocess handles `<script lang="ts">` (replacing the former
// svelte-preprocess dependency).
export default {
  preprocess: vitePreprocess(),
}
