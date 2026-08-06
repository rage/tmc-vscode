<script lang="ts">
  import type { Snippet } from "svelte"

  interface Props {
    checked?: boolean
    indeterminate?: boolean
    disabled?: boolean
    hidden?: boolean
    onClick?: (checked: boolean) => void
    "aria-label"?: string
    children?: Snippet
  }

  let {
    checked = $bindable(false),
    indeterminate = false,
    disabled = false,
    hidden = false,
    onClick = () => {},
    "aria-label": ariaLabel,
    children,
  }: Props = $props()

  // Driven as a *controlled* component: we mirror the parent's decision back onto the
  // element on every change so its rendered state can never drift from `checked`. A prior
  // role="button" span wrapper produced two tab stops, the wrong role, and no announced state.
  type CheckboxElement = HTMLElement & { checked: boolean; indeterminate: boolean }
  let element = $state<CheckboxElement | undefined>()

  $effect(() => {
    if (element) {
      element.checked = checked
      element.indeterminate = indeterminate
    }
  })

  function onChange(event: Event) {
    const next = (event.currentTarget as CheckboxElement).checked
    // Reset to the last controlled value first, so a parent that ignores the toggle
    // leaves the element in sync rather than drifted.
    if (element) {
      element.checked = checked
      element.indeterminate = indeterminate
    }
    checked = next
    onClick(next)
  }
</script>

<vscode-checkbox
  bind:this={element}
  {checked}
  {indeterminate}
  disabled={disabled || undefined}
  hidden={hidden || undefined}
  aria-label={ariaLabel}
  onchange={onChange}
>
  {@render children?.()}
</vscode-checkbox>
