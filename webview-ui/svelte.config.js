import { vitePreprocess } from "@sveltejs/vite-plugin-svelte"

// vitePreprocess handles `<script lang="ts">`.
export default {
  preprocess: vitePreprocess(),
}
