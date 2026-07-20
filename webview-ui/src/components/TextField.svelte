<script lang="ts">
  interface Props {
    type?: "text"
    placeholder?: string
    value?: string
    onChange?: (value: string) => void
  }

  let { type = "text", placeholder = "", value = "", onChange = () => {} }: Props = $props()

  function onChangeWrapper(event: Event) {
    const target = event.currentTarget as { value: string } | null
    onChange(target?.value ?? "")
  }
</script>

<vscode-textfield class="input" {type} {placeholder} {value} oninput={onChangeWrapper}
></vscode-textfield>

<style>
  .input {
    width: 100%;
  }
</style>
