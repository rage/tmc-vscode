// Lets plain tsc/tsgo resolve `.svelte` imports from .ts files (e.g.
// main.ts importing App.svelte). svelte-check and the Svelte language
// server resolve .svelte modules themselves with precise component types,
// so this shim only affects the plain-TypeScript view of the project.
declare module "*.svelte" {
  import type { Component } from "svelte"

  const component: Component
  export default component
}
