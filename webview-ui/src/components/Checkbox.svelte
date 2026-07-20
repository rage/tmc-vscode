<script lang="ts">
  interface Props {
    checked?: boolean
    onClick?: (checked: boolean) => void
    hidden?: boolean
    children?: import("svelte").Snippet
  }

  let { checked = $bindable(false), onClick = () => {}, hidden = false, children }: Props = $props()

  function onClickWrapper(event: Event) {
    event.stopPropagation()
    checked = !checked
    onClick(checked)
  }
</script>

<!--
    the span blocks the checkbox from receiving events
    this is necessary to block the user from actually manipulating
    the checkbox in order to make the component controlled,
    as there's no way to properly bind the `checked`
    property to the store
    instead we use the span's event handlers to check/uncheck
-->
<span
  role="button"
  tabindex="0"
  {hidden}
  onclickcapture={onClickWrapper}
  onkeypresscapture={onClickWrapper}
>
  <vscode-checkbox {checked}>
    {@render children?.()}
  </vscode-checkbox>
</span>
