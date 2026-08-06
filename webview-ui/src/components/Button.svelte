<script lang="ts">
  import type { Snippet } from "svelte"

  interface Props {
    onclick?: (event: MouseEvent) => void
    secondary?: boolean
    disabled?: boolean
    hidden?: boolean
    type?: "button" | "submit" | "reset"
    class?: string
    "aria-label"?: string
    children?: Snippet
  }

  let {
    onclick,
    secondary = false,
    disabled = false,
    hidden = false,
    type = "button",
    class: className = "",
    "aria-label": ariaLabel,
    children,
  }: Props = $props()
</script>

<!--
    vscode-button already dispatches a synthetic click on Enter/Space, so adding onkeypress
    would fire every keyboard activation twice. The svelte-ignores below are false positives
    for this already-interactive custom element.
-->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<vscode-button
  class={className}
  {type}
  secondary={secondary || undefined}
  disabled={disabled || undefined}
  hidden={hidden || undefined}
  aria-label={ariaLabel}
  {onclick}
>
  {@render children?.()}
</vscode-button>
