<script lang="ts">
  import type { Snippet } from "svelte"

  import { focusOnMount } from "../utilities/a11y.svelte"

  interface Props {
    title: string
    /**
     * Moves focus to the heading when the panel mounts, so keyboard and screen-reader users land
     * on the new content instead of `<body>`. Turn off for panels the user did not navigate to.
     */
    shouldFocusOnMount?: boolean
    /** Trailing controls, e.g. a Close `ToolbarButton` or a Refresh `Button`. */
    actions?: Snippet | undefined
  }

  let { title, shouldFocusOnMount = true, actions }: Props = $props()

  function focusHeading(heading: HTMLElement) {
    if (shouldFocusOnMount) {
      focusOnMount(heading)
    }
  }
</script>

<header class="panel-header">
  <div class="title-row">
    <h1 tabindex="-1" {@attach focusHeading}>{title}</h1>
    {#if actions}<div class="actions">{@render actions()}</div>{/if}
  </div>
</header>

<style>
  .title-row {
    display: flex;
    align-items: flex-start;
    gap: var(--tmc-space-2);
  }
  h1 {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .actions {
    margin-top: var(--tmc-space-4);
  }
</style>
