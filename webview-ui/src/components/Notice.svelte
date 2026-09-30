<script lang="ts">
  import type { Snippet } from "svelte"

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
    /** Buttons shown under the text, e.g. Retry. */
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
    <ToolbarButton icon="close" label={dismissLabel} onclick={ondismiss} />
  {/if}
</div>

<style>
  .notice {
    display: flex;
    align-items: flex-start;
    gap: var(--tmc-space-2);
    padding: var(--tmc-space-2) var(--tmc-space-3);
    margin: var(--tmc-space-2) 0;
    border: 1px solid var(--tmc-hc-outline);
    border-left: 2px solid var(--notice-accent);
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
  .notice-icon {
    color: var(--notice-accent);
    flex: none;
  }
  .notice-body {
    flex: 1;
    min-width: 0;
  }
  .notice-body > :global(:first-child) {
    margin-top: 0;
  }
  .notice-body > :global(:last-child) {
    margin-bottom: 0;
  }
  .notice-title {
    font-weight: 600;
  }
  .actions {
    margin-top: var(--tmc-space-2);
  }
</style>
