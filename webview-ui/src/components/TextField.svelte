<script lang="ts">
  interface Props {
    // Mirrors the input types vscode-textfield supports.
    type?: "text" | "password" | "email" | "search" | "tel" | "url" | "number"
    placeholder?: string
    value?: string
    // Visible label associated via for/id. Prefer this over a placeholder, which is not a
    // reliable accessible name and disappears once the user types.
    label?: string
    // Use when an accessible name is needed but no visible label is wanted.
    "aria-label"?: string
    // Optional decorative codicon rendered before the field (e.g. "search").
    icon?: string
    // Optional change notification; most callers should `bind:value` instead.
    onChange?: (value: string) => void
  }

  let {
    type = "text",
    placeholder = "",
    // vscode-textfield is a custom element, so its value is mirrored into this prop by hand
    // on `input` (Svelte's `bind:value` is native-input only).
    value = $bindable(""),
    label,
    "aria-label": ariaLabel,
    icon,
    onChange,
  }: Props = $props()

  const fieldId = $props.id()

  function onInput(event: Event) {
    const next = (event.currentTarget as { value: string } | null)?.value ?? ""
    value = next
    onChange?.(next)
  }
</script>

{#if label}
  <vscode-label for={fieldId}>{label}</vscode-label>
{/if}
<vscode-textfield
  id={fieldId}
  class="input"
  {type}
  {placeholder}
  {value}
  aria-label={ariaLabel}
  oninput={onInput}
>
  {#if icon}
    <vscode-icon slot="content-before" name={icon} aria-hidden="true"></vscode-icon>
  {/if}
</vscode-textfield>

<style>
  .input {
    width: 100%;
  }
</style>
