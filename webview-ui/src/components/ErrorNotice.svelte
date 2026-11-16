<script lang="ts">
  import type { Snippet } from "svelte"

  import type { WebviewError } from "../../../shared/lib"
  import { vscode } from "../utilities/vscode"
  import Button from "./Button.svelte"
  import Notice from "./Notice.svelte"

  interface Props {
    error: WebviewError
    /** `warning` for an action held back rather than failed. */
    kind?: "error" | "warning"
    title?: string | undefined
    ondismiss?: (() => void) | undefined
    dismissLabel?: string | undefined
    /** Buttons after the error's own remedies, e.g. Retry. */
    actions?: Snippet | undefined
  }

  let { error, kind = "error", title, ondismiss, dismissLabel, actions }: Props = $props()

  const remedies = $derived(error.actions ?? [])
</script>

{#snippet allActions()}
  {#each remedies as remedy (remedy.command)}
    <Button onclick={() => vscode.postMessage({ type: "runCommand", command: remedy.command })}>
      {remedy.label}
    </Button>
  {/each}
  {@render actions?.()}
  {#if error.detailsId !== undefined}
    {@const detailsId = error.detailsId}
    <Button secondary onclick={() => vscode.postMessage({ type: "showErrorDetails", detailsId })}>
      Show Details
    </Button>
  {/if}
{/snippet}

<Notice
  {kind}
  {title}
  {ondismiss}
  {dismissLabel}
  actions={remedies.length > 0 || actions || error.detailsId !== undefined ? allActions : undefined}
>
  <p>{error.message}</p>
</Notice>
