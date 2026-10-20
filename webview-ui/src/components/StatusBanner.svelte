<script lang="ts" module>
  /** What the outcome means for the student; `progress` is work still under way. */
  export type BannerTone = "passed" | "failed" | "warning" | "info" | "progress"
</script>

<script lang="ts">
  import type { Snippet } from "svelte"

  interface Props {
    tone: BannerTone
    /** The state in a few words, e.g. "Exercise passed"; rendered as a level-2 heading. */
    title: string
    children?: Snippet | undefined
  }

  /**
   * The headline of a screen's current state, such as a submission's result, under the panel
   * header. Not a live region: announce a change with `announce()`. For a problem beside the
   * main content use `Notice` or `ErrorNotice` instead.
   */
  let { tone, title, children }: Props = $props()

  const icons: Record<Exclude<BannerTone, "progress">, string> = {
    passed: "pass-filled",
    failed: "error",
    warning: "warning",
    info: "info",
  }
</script>

<section class="banner tone-{tone}">
  <span class="icon" aria-hidden="true">
    {#if tone === "progress"}
      <vscode-progress-ring role="presentation" aria-hidden="true"></vscode-progress-ring>
    {:else}
      <vscode-icon name={icons[tone]}></vscode-icon>
    {/if}
  </span>
  <div class="body">
    <h2 class="title">{title}</h2>
    {@render children?.()}
  </div>
</section>

<style>
  .banner {
    display: flex;
    align-items: flex-start;
    gap: var(--tmc-space-3);
    padding: var(--tmc-space-3) var(--tmc-space-4);
    margin: var(--tmc-space-3) 0 var(--tmc-space-4);
    border: 1px solid var(--tmc-hc-outline);
    border-left: 3px solid var(--banner-accent);
    border-radius: var(--tmc-radius);
    background: var(--tmc-banner-background);
  }
  .tone-passed {
    --banner-accent: var(--tmc-status-passed);
  }
  .tone-failed {
    --banner-accent: var(--tmc-status-failed);
  }
  .tone-warning {
    --banner-accent: var(--tmc-notice-warning-accent);
  }
  .tone-info,
  .tone-progress {
    --banner-accent: var(--tmc-notice-info-accent);
  }
  .icon {
    display: inline-flex;
    flex: none;
    width: 16px;
    height: 20px;
    align-items: center;
    color: var(--banner-accent);
  }
  vscode-progress-ring {
    width: 16px;
    height: 16px;
  }
  .body {
    flex: 1;
    min-width: 0;
  }
  .title {
    margin: 0;
    font-size: calc(var(--tmc-font-size-body) * 1.15);
    line-height: 20px;
    text-transform: none;
    letter-spacing: normal;
    color: inherit;
  }
  .body > :global(:not(.title)) {
    margin: var(--tmc-space-1) 0 0;
  }
</style>
