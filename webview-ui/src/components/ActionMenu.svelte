<script lang="ts" module>
  /** One entry of an `ActionMenu`. */
  export interface MenuAction {
    label: string
    onselect: () => void
    disabled?: boolean | undefined
  }
</script>

<script lang="ts">
  import { tick } from "svelte"

  interface Props {
    /** The trigger's accessible name and tooltip, e.g. "More Actions". */
    label?: string
    /** Renders nothing while empty, so a state with no extra actions shows no "⋯". */
    actions: MenuAction[]
  }

  /**
   * The "⋯" overflow menu for actions beyond a state's primary and secondary buttons, as a
   * keyboard-operable WAI-ARIA menu button. Selecting an item closes the menu and returns focus
   * to the trigger before `onselect` runs, so an action that moves focus keeps it.
   */
  let { label = "More Actions", actions }: Props = $props()

  const menuId = $props.id()
  let isOpen = $state(false)
  let trigger = $state<HTMLButtonElement | undefined>()
  let menu = $state<HTMLElement | undefined>()

  function items(): HTMLButtonElement[] {
    return [...(menu?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ?? [])]
  }

  async function open(focus: "first" | "last") {
    isOpen = true
    await tick()
    const enabled = items()
    ;(focus === "first" ? enabled[0] : enabled.at(-1))?.focus()
  }

  function close({ restoreFocus }: { restoreFocus: boolean }) {
    isOpen = false
    if (restoreFocus) {
      trigger?.focus()
    }
  }

  function select(action: MenuAction) {
    close({ restoreFocus: true })
    action.onselect()
  }

  function onTriggerKeydown(event: KeyboardEvent) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      void open(event.key === "ArrowDown" ? "first" : "last")
    }
  }

  function onMenuKeydown(event: KeyboardEvent) {
    const enabled = items()
    const current = enabled.indexOf(document.activeElement as HTMLButtonElement)
    const move = (index: number) => {
      event.preventDefault()
      enabled[(index + enabled.length) % enabled.length]?.focus()
    }
    switch (event.key) {
      case "ArrowDown":
        move(current + 1)
        break
      case "ArrowUp":
        move(current - 1)
        break
      case "Home":
        move(0)
        break
      case "End":
        move(enabled.length - 1)
        break
      case "Escape":
        event.preventDefault()
        close({ restoreFocus: true })
        break
      case "Tab":
        close({ restoreFocus: false })
        break
      default:
    }
  }

  function closeOnOutsidePointer(event: PointerEvent) {
    if (isOpen && !event.composedPath().some((target) => target === trigger || target === menu)) {
      close({ restoreFocus: false })
    }
  }
</script>

<svelte:document onpointerdown={closeOnOutsidePointer} />

{#if actions.length > 0}
  <div class="action-menu">
    <button
      bind:this={trigger}
      type="button"
      class="trigger"
      aria-label={label}
      title={label}
      aria-haspopup="menu"
      aria-expanded={isOpen}
      aria-controls={isOpen ? menuId : undefined}
      onclick={() => (isOpen ? close({ restoreFocus: false }) : open("first"))}
      onkeydown={onTriggerKeydown}
    >
      <vscode-icon name="ellipsis"></vscode-icon>
    </button>
    {#if isOpen}
      <div bind:this={menu} id={menuId} class="menu" role="menu" aria-label={label} tabindex="-1">
        {#each actions as action (action.label)}
          <button
            type="button"
            role="menuitem"
            tabindex="-1"
            disabled={action.disabled}
            onclick={() => select(action)}
            onkeydown={onMenuKeydown}
          >
            {action.label}
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .action-menu {
    position: relative;
  }
  .trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 5px;
    background: none;
    color: var(--tmc-icon-foreground);
    cursor: pointer;
  }
  .trigger:hover,
  .trigger[aria-expanded="true"] {
    background: var(--tmc-toolbar-hover);
    border-color: var(--tmc-hc-active-outline);
  }
  .menu {
    position: absolute;
    top: calc(100% + 2px);
    right: 0;
    z-index: 10;
    display: flex;
    flex-direction: column;
    min-width: 200px;
    max-width: min(320px, 90vw);
    padding: var(--tmc-space-1);
    border: 1px solid var(--tmc-menu-border);
    border-radius: 5px;
    background: var(--tmc-menu-background);
    color: var(--tmc-menu-foreground);
    box-shadow: 0 2px 8px var(--tmc-menu-shadow);
  }
  .menu:focus {
    outline: none;
  }
  [role="menuitem"] {
    display: block;
    width: 100%;
    padding: 0 var(--tmc-space-6) 0 var(--tmc-space-3);
    line-height: var(--tmc-list-row-height);
    border: 1px solid transparent;
    border-radius: 3px;
    background: none;
    color: inherit;
    font: inherit;
    text-align: start;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
  }
  [role="menuitem"]:hover:not(:disabled),
  [role="menuitem"]:focus {
    background: var(--tmc-menu-selection-background);
    color: var(--tmc-menu-selection-foreground);
    border-color: var(--tmc-menu-selection-border);
    outline: none;
  }
  [role="menuitem"]:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
