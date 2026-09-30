<script lang="ts">
  interface Props {
    /** What is being waited for, e.g. "Loading courses". */
    label: string
  }

  let { label }: Props = $props()
</script>

<!--
  `vscode-progress-ring` defaults to an assertive `role="alert"` labelled "Loading", which
  interrupts speech on every mount and nests inside surrounding live regions.
-->
<span class="spinner">
  <vscode-progress-ring role="presentation" aria-hidden="true"></vscode-progress-ring>
  <span>{label}</span>
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
