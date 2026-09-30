<script lang="ts">
  import type { VscodeCheckbox } from "@vscode-elements/elements"
  import type { SvelteHTMLElements } from "svelte/elements"

  type Props = Omit<
    SvelteHTMLElements["vscode-checkbox"],
    "checked" | "indeterminate" | "onchange" | "aria-label" | "label"
  > & {
    checked: boolean
    /** Receives the state the user asked for; the box only moves once `checked` changes. */
    oncheckedchange?: ((checked: boolean) => void) | undefined
  }

  let { checked, oncheckedchange, children, ...rest }: Props = $props()

  function handleChange(event: Event & { currentTarget: VscodeCheckbox }) {
    const requested = event.currentTarget.checked
    event.currentTarget.checked = checked
    oncheckedchange?.(requested)
  }
</script>

<vscode-checkbox {...rest} {checked} onchange={handleChange}>
  {@render children?.()}
</vscode-checkbox>
