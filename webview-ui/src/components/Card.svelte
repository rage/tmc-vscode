<script lang="ts">
  interface Props {
    children?: import("svelte").Snippet
  }

  let { children }: Props = $props()
</script>

<div class="card">
  {@render children?.()}
</div>

<style>
  .card {
    background-color: var(--tmc-surface);
    border: 1px solid var(--tmc-surface-border);
    border-radius: var(--tmc-radius-large);
    margin: var(--tmc-space-2) 0 var(--tmc-space-4);
    padding: var(--tmc-space-3);
  }
</style>
