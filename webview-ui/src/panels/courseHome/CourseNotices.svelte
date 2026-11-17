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
        {@const actions = notice.actions ?? []}
        <li class="notice tone-{notice.tone}">
          <vscode-icon class="notice-icon" name={icons[notice.tone]}></vscode-icon>
          <p class="text">
            <span class="title">{notice.title}</span>
            {#if notice.detail}<span class="detail muted">{notice.detail}</span>{/if}
          </p>
          {#if actions.length > 0}
            <div class="actions">
              {#each actions as action (action.label)}
                <Button secondary disabled={action.disabled} onclick={action.onclick}>
                  {action.label}
                </Button>
              {/each}
            </div>
          {/if}
          {#if notice.ondismiss}
            <span class="dismiss">
              <ToolbarButton
                icon="close"
                label={notice.dismissLabel ?? "Dismiss"}
                onclick={notice.ondismiss}
              />
            </span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  /* One box in Notice's look, with each notice's tone on its own left edge. */
  .notices {
    list-style: none;
    margin: var(--tmc-space-3) 0;
    padding: 0;
    border: 1px solid var(--tmc-surface-border);
    border-radius: var(--tmc-radius);
    border-left: none;
    background: var(--tmc-banner-background);
    overflow: hidden;
  }
  /* Buttons go under the text, so it keeps the full width. */
  .notice {
    display: grid;
    grid-template-columns: 16px minmax(0, 1fr) auto;
    column-gap: var(--tmc-space-2);
    padding: var(--tmc-space-2) var(--tmc-space-3);
    border-left: 3px solid var(--notice-accent);
  }
  .notice + .notice {
    border-top: 1px solid var(--tmc-surface-border);
  }
  .tone-info {
    --notice-accent: var(--tmc-notice-info-accent);
  }
  .tone-warning {
    --notice-accent: var(--tmc-notice-warning-accent);
  }
  .notice-icon {
    display: inline-flex;
    align-items: center;
    height: var(--tmc-list-row-height);
    color: var(--notice-accent);
  }
  .text {
    grid-column: 2;
    margin: 0;
    padding-block: calc((var(--tmc-list-row-height) - 1lh) / 2);
    overflow-wrap: anywhere;
  }
  .dismiss {
    grid-row: 1;
    grid-column: 3;
  }
  .actions {
    grid-row: 2;
    grid-column: 2 / -1;
    display: flex;
    flex-wrap: wrap;
    gap: var(--tmc-space-2);
    margin-top: var(--tmc-space-2);
  }
  .title {
    font-weight: 600;
  }
  .detail::before {
    content: " · ";
  }
</style>
