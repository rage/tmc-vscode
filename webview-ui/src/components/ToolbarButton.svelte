<script lang="ts">
  import type { SvelteHTMLElements } from "svelte/elements"

  type Props = SvelteHTMLElements["vscode-toolbar-button"] & {
    /** Codicon name, e.g. "close" or "copy". */
    icon: string
    /** The button's only accessible name, also shown as its tooltip; say what it acts on. */
    label: string
  }

  /**
   * A compact icon button (`vscode-toolbar-button`) for close, dismiss, copy and other secondary
   * actions beside a heading or notice, as VS Code draws them. For a labelled action use `Button`.
   */
  let { label, title = label, children, ...rest }: Props = $props()
</script>

<vscode-toolbar-button {...rest} {label} {title}>{@render children?.()}</vscode-toolbar-button>
