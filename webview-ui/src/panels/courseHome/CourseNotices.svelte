<script lang="ts" module>
  /** Something to do about a notice. */
  export interface CourseNoticeAction {
    label: string
    onclick: () => void
    disabled?: boolean | undefined
  }

  /** One thing the student should know about the course, and what they can do about it. */
  export interface CourseNotice {
    /** Unique among the notices shown together. */
    key: string
    tone: "info" | "warning"
    title: string
    /** Names what the notice is about, e.g. the exercises. */
    detail?: string | undefined
    /** The first is the one most students want. */
    actions?: CourseNoticeAction[] | undefined
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
          {#each notice.actions ?? [] as action (action.label)}
            <Button secondary disabled={action.disabled} onclick={action.onclick}>
              {action.label}
            </Button>
          {/each}
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
  /* At sidebar widths the action wraps under the text instead of squeezing it to a word a line. */
  .notice {
    display: flex;
    flex-wrap: wrap;
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
    flex: 1 1 14ch;
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
  }
  .title {
    font-weight: 600;
  }
  .detail::before {
    content: " · ";
  }
</style>
