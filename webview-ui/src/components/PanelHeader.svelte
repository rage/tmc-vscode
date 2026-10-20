<script lang="ts">
  import type { Snippet } from "svelte"

  import { focusOnMount } from "../utilities/a11y.svelte"

  interface Props {
    /** The display name of what the panel shows, never a slug. */
    title: string
    /** Muted context under the title, e.g. "Python Programming · University of Helsinki". */
    subtitle?: string | undefined
    /**
     * Moves focus to the heading when the panel mounts, so keyboard and screen-reader users land
     * on the new content instead of `<body>`. Turn off for panels the user did not navigate to.
     */
    shouldFocusOnMount?: boolean
    /** Icon controls at the right end: `ToolbarButton`s and an `ActionMenu`, never labelled buttons. */
    toolbar?: Snippet | undefined
  }

  /** A panel's one level-1 heading, with its context line and toolbar. */
  let { title, subtitle, shouldFocusOnMount = true, toolbar }: Props = $props()

  function focusHeading(heading: HTMLElement) {
    if (shouldFocusOnMount) {
      focusOnMount(heading)
    }
  }
</script>

<header class="panel-header">
  <div class="titles">
    <h1 tabindex="-1" {@attach focusHeading}>{title}</h1>
    {#if subtitle}<p class="subtitle muted">{subtitle}</p>{/if}
  </div>
  {#if toolbar}<div class="toolbar">{@render toolbar()}</div>{/if}
</header>

<style>
  .panel-header {
    display: flex;
    align-items: flex-start;
    gap: var(--tmc-space-2);
    margin: var(--tmc-space-4) 0 var(--tmc-space-3);
  }
  .titles {
    flex: 1;
    min-width: 0;
  }
  h1 {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .subtitle {
    margin: var(--tmc-space-1) 0 0;
    overflow-wrap: anywhere;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--tmc-space-1);
    flex: none;
  }
</style>
