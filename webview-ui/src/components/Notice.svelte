<script lang="ts">
  import type { Snippet } from "svelte"

  import { dismissKeepingFocus } from "../utilities/a11y.svelte"
  import ToolbarButton from "./ToolbarButton.svelte"

  interface Props {
    /**
     * An error is an `alert`, the rest a `status`. A region only announces changes made after it
     * mounts, so an outcome worth hearing that appears together with the notice needs
     * `announce()` as well.
     */
    kind: "info" | "warning" | "error"
    title?: string | undefined
    /** Renders a dismiss button; `dismissLabel` should say what goes away. */
    ondismiss?: (() => void) | undefined
    dismissLabel?: string | undefined
    /** Buttons shown under the text, e.g. Try Again. */
    actions?: Snippet | undefined
    children?: Snippet | undefined
  }

  let { kind, title, ondismiss, dismissLabel = "Dismiss", actions, children }: Props = $props()

  const icons = { info: "info", warning: "warning", error: "error" } as const
</script>

<div class="notice notice-{kind}" role={kind === "error" ? "alert" : "status"}>
  <vscode-icon class="notice-icon" name={icons[kind]}></vscode-icon>
  <div class="notice-body">
    {#if title}<p class="notice-title">{title}</p>{/if}
    {@render children?.()}
    {#if actions}<div class="actions">{@render actions()}</div>{/if}
  </div>
  {#if ondismiss}
    <ToolbarButton
      icon="close"
      label={dismissLabel}
      data-dismiss=""
      onclick={(event) => void dismissKeepingFocus(event.currentTarget, ondismiss)}
    />
  {/if}
</div>

<style>
  /* Course notices (courseHome/CourseNotices.svelte) mirror this look; change both together. */
  .notice {
    display: flex;
    align-items: flex-start;
    gap: var(--tmc-space-2);
    padding: var(--tmc-space-2) var(--tmc-space-3);
    margin: var(--tmc-space-3) 0;
    border: 1px solid var(--tmc-surface-border);
    border-left: 3px solid var(--notice-accent);
    border-radius: var(--tmc-radius);
    background: var(--notice-background);
  }
  .notice-error {
    --notice-accent: var(--tmc-notice-error-accent);
    --notice-background: var(--tmc-notice-error-background);
  }
  .notice-warning {
    --notice-accent: var(--tmc-notice-warning-accent);
    --notice-background: var(--tmc-notice-warning-background);
  }
  .notice-info {
    --notice-accent: var(--tmc-notice-info-accent);
    --notice-background: var(--tmc-notice-info-background);
  }
  /* Centred on the first line of text, however many lines follow. */
  .notice-icon {
    flex: none;
    display: inline-flex;
    align-items: center;
    height: var(--tmc-list-row-height);
    color: var(--notice-accent);
  }
  .notice-body {
    flex: 1;
    min-width: 0;
    padding-block: calc((var(--tmc-list-row-height) - 1lh) / 2);
    overflow-wrap: anywhere;
  }
  .notice-body > :global(:first-child) {
    margin-top: 0;
  }
  .notice-body > :global(:last-child) {
    margin-bottom: 0;
  }
  .notice-body > :global(p) {
    margin: var(--tmc-space-1) 0;
  }
  .notice-title {
    font-weight: 600;
  }
  .actions {
    margin-top: var(--tmc-space-2);
  }
</style>
