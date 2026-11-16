<script lang="ts">
  import type { Snippet } from "svelte"

  import type { WebviewError } from "../../../../shared/lib"
  import ErrorNotice from "../../components/ErrorNotice.svelte"

  interface Props {
    /** The course or organization, in the card's level-3 heading. */
    name: string
    /** Muted context under the name, e.g. the course's organization. */
    context?: string | undefined
    description?: string | undefined
    /** The card's one control, at its right end or, narrow, under its text. */
    action: Snippet
    /** Why acting on the card failed, shown under its text until dismissed. */
    failure?: { title: string; error: WebviewError; ondismiss: () => void } | undefined
  }

  /** One course or organization in an add-course list; render it inside a `<ul>`. */
  let { name, context, description, action, failure }: Props = $props()
</script>

<li class="card">
  <div class="text">
    <h3 class="name">{name}</h3>
    {#if context}<p class="muted context">{context}</p>{/if}
    {#if description}<p class="description">{description}</p>{/if}
  </div>
  <div class="action">{@render action()}</div>
  {#if failure}
    <div class="failure">
      <ErrorNotice
        error={failure.error}
        title={failure.title}
        ondismiss={failure.ondismiss}
        dismissLabel="Dismiss the error"
      />
    </div>
  {/if}
</li>

<style>
  .card {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--tmc-space-2) var(--tmc-space-4);
    padding: var(--tmc-space-3);
    border: 1px solid var(--tmc-surface-border);
    border-radius: var(--tmc-radius);
  }
  .text {
    flex: 1 1 240px;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .name {
    margin: 0;
  }
  .context,
  .description {
    margin: var(--tmc-space-1) 0 0;
  }
  .action {
    display: flex;
    align-items: center;
    gap: var(--tmc-space-2);
    flex: none;
  }
  .failure {
    flex-basis: 100%;
  }
</style>
