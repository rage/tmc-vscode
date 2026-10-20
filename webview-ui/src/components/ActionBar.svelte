<script lang="ts" module>
  /** A labelled button in an `ActionBar`. */
  export interface BarAction {
    label: string
    onclick: () => void
    /** A codicon name; shown only when every action in the bar has one. */
    icon?: string | undefined
    disabled?: boolean | undefined
  }
</script>

<script lang="ts">
  import Button from "./Button.svelte"

  interface Props {
    /** The state's next step; absent when there is none to suggest. */
    primary?: BarAction | undefined
    /** At most two; anything more belongs in the panel header's `ActionMenu`. */
    secondary?: [] | [BarAction] | [BarAction, BarAction]
  }

  /**
   * The button row of a screen state: one primary and up to two secondary buttons. Close is
   * never one of them, as the tab and the header already close the panel.
   */
  let { primary, secondary = [] }: Props = $props()

  const shown = $derived(primary ? [primary, ...secondary] : secondary)
  const hasIcons = $derived(shown.every((action) => action.icon !== undefined))
</script>

{#if shown.length > 0}
  <div class="action-bar">
    {#if primary}
      <Button
        icon={hasIcons ? primary.icon : undefined}
        disabled={primary.disabled}
        onclick={primary.onclick}
      >
        {primary.label}
      </Button>
    {/if}
    {#each secondary as action (action.label)}
      <Button
        secondary
        icon={hasIcons ? action.icon : undefined}
        disabled={action.disabled}
        onclick={action.onclick}
      >
        {action.label}
      </Button>
    {/each}
  </div>
{/if}

<style>
  .action-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--tmc-space-2);
    margin: var(--tmc-space-3) 0;
  }
</style>
