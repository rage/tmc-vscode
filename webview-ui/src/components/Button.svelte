<script lang="ts">
  import type { SvelteHTMLElements } from "svelte/elements"

  /**
   * A `vscode-button` whose props, events and attachments pass straight through. Use it rather
   * than the bare element: it needs no a11y ignores at call sites, and Space activates it without
   * also scrolling the page. For icon-only close/dismiss controls use `vscode-toolbar-button`.
   */
  let { children, onkeydown, ...rest }: SvelteHTMLElements["vscode-button"] = $props()

  const handleKeydown: typeof onkeydown = (event) => {
    // The element dispatches its own click on Space but leaves the default page scroll in place.
    if (event.key === " ") {
      event.preventDefault()
    }
    onkeydown?.(event)
  }
</script>

<vscode-button {...rest} onkeydown={handleKeydown}>{@render children?.()}</vscode-button>
