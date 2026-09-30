<script lang="ts">
  import type { Snippet } from "svelte"

  import { uiState } from "../utilities/uiState.svelte"

  interface Props {
    title: string
    /** Level of the heading that wraps the toggle, so the section sits in the page outline. */
    headingLevel?: 2 | 3 | 4
    /** Keeps the open state across the panel being hidden, under this name unique on the screen. */
    persistAs?: string | undefined
    children: Snippet
  }

  let { title, headingLevel = 2, persistAs, children }: Props = $props()

  const regionId = $props.id()

  // svelte-ignore state_referenced_locally -- read once: the name seeds it
  const persisted = persistAs === undefined ? undefined : uiState(`disclosure:${persistAs}`, false)
  let open = $state(persisted?.current ?? false)

  function toggle() {
    open = !open
    if (persisted) {
      persisted.current = open
    }
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
      </button>
    </svelte:element>
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
  .content {
    padding: var(--tmc-space-2) 0;
  }
</style>
