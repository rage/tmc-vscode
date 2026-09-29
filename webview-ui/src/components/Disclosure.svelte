<script lang="ts">
  import type { Snippet } from "svelte"

  interface Props {
    title: string
    /** Starts open when true; bind to follow or drive it. */
    open?: boolean
    /** Level of the heading that wraps the toggle, so the section sits in the page outline. */
    headingLevel?: 2 | 3 | 4
    /** Short text after the title inside the toggle, e.g. "3 / 5 completed". */
    description?: string | undefined
    ontoggle?: ((open: boolean) => void) | undefined
    /**
     * Controls for the whole section, e.g. `ToolbarButton`s. Rendered beside the toggle, never
     * inside it: a button nested in a button is unreachable for assistive technology.
     */
    actions?: Snippet | undefined
    children: Snippet
  }

  let {
    title,
    open = $bindable(false),
    headingLevel = 2,
    description,
    ontoggle,
    actions,
    children,
  }: Props = $props()

  const regionId = $props.id()

  function toggle() {
    open = !open
    ontoggle?.(open)
  }
</script>

<section class="disclosure">
  <div class="header">
    <svelte:element this={`h${headingLevel}`} class="heading">
      <button
        type="button"
        class="toggle"
        aria-expanded={open}
        aria-controls={regionId}
        onclick={toggle}
      >
        <vscode-icon name={open ? "chevron-down" : "chevron-right"}></vscode-icon>
        <span class="title">{title}</span>
        {#if description}<span class="description">{description}</span>{/if}
      </button>
    </svelte:element>
    {#if actions}<div class="actions">{@render actions()}</div>{/if}
  </div>
  <div id={regionId} class="content" hidden={!open}>
    {@render children()}
  </div>
</section>

<style>
  .header {
    display: flex;
    align-items: center;
    gap: var(--tmc-space-2);
    padding-right: var(--tmc-space-1);
    background: var(--tmc-section-header-background);
    color: var(--tmc-section-header-foreground);
    border-top: 1px solid var(--tmc-section-header-border);
  }
  .heading {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: var(--tmc-font-size-body);
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: var(--tmc-space-1);
    width: 100%;
    padding: var(--tmc-space-1) var(--tmc-space-1);
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: pointer;
  }
  .toggle:hover {
    outline: 1px dashed var(--tmc-hc-active-outline);
  }
  .description {
    margin-left: var(--tmc-space-2);
    font-weight: normal;
    color: var(--tmc-fg-muted);
  }
  .actions {
    flex-wrap: nowrap;
    gap: 0;
  }
  .content {
    padding: var(--tmc-space-2) 0;
  }
</style>
