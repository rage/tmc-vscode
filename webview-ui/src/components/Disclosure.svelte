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
  }
  .heading {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: var(--tmc-font-size-body);
    font-weight: normal;
    text-transform: none;
    letter-spacing: normal;
    color: inherit;
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: var(--tmc-space-1);
    width: 100%;
    min-height: var(--tmc-list-row-height);
    padding: 0 var(--tmc-space-1);
    border: 1px solid transparent;
    border-radius: var(--tmc-radius);
    background: none;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: pointer;
  }
  .toggle:hover {
    background: var(--tmc-list-hover);
    border-color: var(--tmc-hc-active-outline);
    border-style: dashed;
  }
  .content {
    padding: var(--tmc-space-1) 0 var(--tmc-space-2) calc(16px + var(--tmc-space-2));
  }
</style>
