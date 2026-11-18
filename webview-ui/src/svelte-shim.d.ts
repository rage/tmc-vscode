// Lets plain tsc/tsgo resolve `.svelte` imports from .ts files; svelte-check and the
// Svelte language server use precise component types instead.
declare module "*.svelte" {
  import type { Component } from "svelte"

  const component: Component
  export default component
}
