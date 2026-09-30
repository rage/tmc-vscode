<script lang="ts">
  import type { Snippet } from "svelte"

  import type { WebviewError } from "../shared/shared"
  import { vscode } from "../utilities/vscode"
  import Button from "./Button.svelte"
  import CodeBlock from "./CodeBlock.svelte"
  import Notice from "./Notice.svelte"

  interface Props {
    error: WebviewError
    title?: string | undefined
    /** Copies the error's details through the host; without it they cannot be copied. */
    oncopy?: ((text: string) => void) | undefined
    ondismiss?: (() => void) | undefined
    dismissLabel?: string | undefined
    /** Buttons after the error's own remedies, e.g. Retry. */
    actions?: Snippet | undefined
  }

  let { error, title, oncopy, ondismiss, dismissLabel, actions }: Props = $props()

  const remedies = $derived(error.actions ?? [])
</script>

{#snippet allActions()}
  {#each remedies as remedy (remedy.command)}
    <Button onclick={() => vscode.postMessage({ type: "runCommand", command: remedy.command })}>
      {remedy.label}
    </Button>
  {/each}
  {@render actions?.()}
{/snippet}

<Notice
  kind="error"
  {title}
  {ondismiss}
  {dismissLabel}
  actions={remedies.length > 0 || actions ? allActions : undefined}
>
  <p>{error.message}</p>
  {#if error.details}
    <CodeBlock code={error.details} label="Error details" {oncopy} />
  {/if}
</Notice>
