<script lang="ts">
  import ToolbarButton from "./ToolbarButton.svelte"

  interface Props {
    /** Preformatted text such as test output, a stack trace or an error's details. */
    code: string
    /** Names the block for assistive technology, e.g. "Standard error". */
    label?: string | undefined
    /**
     * Renders a copy button that hands `code` back; the panel forwards it to the host, whose
     * clipboard works where the webview's may not.
     */
    oncopy?: ((code: string) => void) | undefined
  }

  let { code, label, oncopy }: Props = $props()
</script>

<div class="code-block-container" role={label ? "group" : undefined} aria-label={label}>
  <pre class="code-block">{code}</pre>
  {#if oncopy}
    <div class="copy">
      <ToolbarButton
        icon="copy"
        label={label ? `Copy ${label}` : "Copy"}
        onclick={() => oncopy(code)}
      />
    </div>
  {/if}
</div>

<style>
  .code-block-container {
    position: relative;
  }
  .code-block {
    margin: var(--tmc-space-2) 0;
  }
  .copy {
    position: absolute;
    top: var(--tmc-space-1);
    right: var(--tmc-space-1);
  }
  .code-block-container:has(.copy) .code-block {
    padding-right: var(--tmc-space-6);
  }
</style>
