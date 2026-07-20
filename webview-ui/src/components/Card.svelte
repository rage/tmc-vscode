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
    background-color: var(--vscode-editorInlayHint-background, rgba(97, 97, 97, 0.1));
    border-radius: 0.4rem;
    margin-top: 0.4rem;
    margin-bottom: 1rem;
    cursor: pointer;
    padding: 0.8rem;
    border: 1px solid var(--vscode-button-border, transparent);
  }
</style>
