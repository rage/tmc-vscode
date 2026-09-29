<script lang="ts">
  import type { VscodeCheckbox } from "@vscode-elements/elements"
  import type { SvelteHTMLElements } from "svelte/elements"

  type Props = Omit<
    SvelteHTMLElements["vscode-checkbox"],
    "checked" | "indeterminate" | "onchange" | "aria-label" | "label"
  > & {
    checked: boolean
    /** Shown as "some selected"; the element clears it on toggle, so the parent owns it too. */
    indeterminate?: boolean | undefined
    /** Receives the state the user asked for; the box only moves once `checked` changes. */
    oncheckedchange?: ((checked: boolean) => void) | undefined
    /**
     * Name for a checkbox with no visible label, e.g. `Select ${exercise.name}`. A host
     * `aria-label` cannot name the input inside the shadow root, so this is slotted as hidden text.
     */
    accessibleName?: string | undefined
  }

  let {
    checked,
    indeterminate = false,
    oncheckedchange,
    accessibleName,
    children,
    ...rest
  }: Props = $props()

  function handleChange(event: Event & { currentTarget: VscodeCheckbox }) {
    const requested = event.currentTarget.checked
    event.currentTarget.checked = checked
    event.currentTarget.indeterminate = indeterminate
    oncheckedchange?.(requested)
  }

  // The element draws the indeterminate icon but never sets it on its inner input, so assistive
  // technology would report "not checked" instead of "mixed".
  function exposeIndeterminate(element: VscodeCheckbox) {
    const isIndeterminate = indeterminate
    void element.updateComplete.then(() => {
      const input = element.shadowRoot?.querySelector("input")
      if (input) {
        input.indeterminate = isIndeterminate
      }
    })
  }
</script>

<vscode-checkbox
  {...rest}
  {checked}
  {indeterminate}
  onchange={handleChange}
  {@attach exposeIndeterminate}
>
  {#if accessibleName}<span class="visually-hidden">{accessibleName}</span>{/if}
  {@render children?.()}
</vscode-checkbox>
