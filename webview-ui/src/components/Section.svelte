<script lang="ts">
  import type { Snippet } from "svelte"

  interface Props {
    /** Shown in VS Code's uppercase section-header style; read in its written case. */
    title: string
    /** Small controls at the header's right end, e.g. a `Checkbox` filter or a `ToolbarButton`. */
    actions?: Snippet | undefined
    /** The heading's id, for moving focus to the section when an action reveals it. */
    headingId?: string | undefined
    children: Snippet
  }

  /** A titled part of a panel, spaced and headed the same way on every screen. */
  const generatedId = $props.id()
  let { title, actions, headingId = generatedId, children }: Props = $props()
</script>

<section class="section" aria-labelledby={headingId}>
  <div class="header">
    <h2 id={headingId} tabindex="-1">{title}</h2>
    {#if actions}<div class="actions">{@render actions()}</div>{/if}
  </div>
  {@render children()}
</section>

<style>
  .section {
    margin-top: var(--tmc-space-6);
  }
  .header {
    display: flex;
    align-items: center;
    gap: var(--tmc-space-2);
    padding-bottom: var(--tmc-space-1);
    margin-bottom: var(--tmc-space-2);
    border-bottom: 1px solid var(--tmc-section-header-border);
  }
  h2 {
    flex: 1;
    min-width: 0;
    margin: 0;
  }
</style>
