<script lang="ts" module>
  /** One thing the student should know about the course, with at most one thing to do about it. */
  export interface CourseNotice {
    /** Unique among the notices shown together. */
    key: string
    tone: "info" | "warning"
    title: string
    /** Names what the notice is about, e.g. the exercises. */
    detail?: string | undefined
    action?: { label: string; onclick: () => void; disabled?: boolean | undefined } | undefined
    /** Renders a dismiss button; `dismissLabel` says what goes away. */
    ondismiss?: (() => void) | undefined
    dismissLabel?: string | undefined
  }
</script>

<script lang="ts">
  import Button from "../../components/Button.svelte"
  import ToolbarButton from "../../components/ToolbarButton.svelte"

  interface Props {
    notices: CourseNotice[]
  }

  /**
   * The course's news and warnings as one compact list, so several do not stack into a wall of
   * tinted boxes. A status region: one that appears later is announced.
   */
  let { notices }: Props = $props()

  const icons = { info: "info", warning: "warning" } as const
</script>

<div role="status">
  {#if notices.length > 0}
    <ul class="notices" aria-label="Course notices">
      {#each notices as notice (notice.key)}
        <li class="notice tone-{notice.tone}">
          <vscode-icon class="notice-icon" name={icons[notice.tone]}></vscode-icon>
          <p class="text">
            <span class="title">{notice.title}</span>
            {#if notice.detail}<span class="detail muted">{notice.detail}</span>{/if}
          </p>
          {#if notice.action}
            <Button secondary disabled={notice.action.disabled} onclick={notice.action.onclick}>
              {notice.action.label}
            </Button>
          {/if}
          {#if notice.ondismiss}
            <ToolbarButton
              icon="close"
              label={notice.dismissLabel ?? "Dismiss"}
              onclick={notice.ondismiss}
            />
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .notices {
    list-style: none;
    margin: var(--tmc-space-3) 0;
    padding: 0;
    border: 1px solid var(--tmc-surface-border);
    border-radius: var(--tmc-radius);
    background: var(--tmc-banner-background);
  }
  .notice {
    display: flex;
    align-items: center;
    gap: var(--tmc-space-2);
    padding: var(--tmc-space-2) var(--tmc-space-3);
  }
  .notice + .notice {
    border-top: 1px solid var(--tmc-surface-border);
  }
  .notice-icon {
    flex: none;
  }
  .tone-info .notice-icon {
    color: var(--tmc-notice-info-accent);
  }
  .tone-warning .notice-icon {
    color: var(--tmc-notice-warning-accent);
  }
  .text {
    flex: 1;
    min-width: 0;
    margin: 0;
  }
  .title {
    font-weight: 600;
  }
  .detail::before {
    content: " · ";
  }
</style>
