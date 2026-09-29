<script lang="ts">
  interface Props {
    /** What is being waited for, e.g. "Loading courses". */
    label: string
    /**
     * Hides the label visually. The ring then becomes a polite status itself; otherwise it is
     * hidden from assistive technology and the visible label carries the meaning.
     */
    isLabelHidden?: boolean
  }

  let { label, isLabelHidden = false }: Props = $props()
</script>

<!--
  `vscode-progress-ring` defaults to an assertive `role="alert"` labelled "Loading", which
  interrupts speech on every mount and nests inside surrounding live regions.
-->
<span class="spinner">
  {#if isLabelHidden}
    <vscode-progress-ring role="status" aria-live="polite" aria-label={label}
    ></vscode-progress-ring>
  {:else}
    <vscode-progress-ring role="presentation" aria-hidden="true"></vscode-progress-ring>
    <span>{label}</span>
  {/if}
</span>

<style>
  .spinner {
    display: inline-flex;
    align-items: center;
    gap: var(--tmc-space-2);
  }
  vscode-progress-ring {
    width: 16px;
    height: 16px;
  }
</style>
