<script lang="ts">
  import type {
    ExerciseSubmissionPanel,
    ReplyValue,
    TargetPanel,
    WebviewError,
  } from "../../../shared/lib"
  import { announce, focusWhen } from "../utilities/a11y.svelte"
  import { createRequester } from "../utilities/script"
  import { uiState } from "../utilities/uiState.svelte"
  import { vscode } from "../utilities/vscode"
  import Button from "./Button.svelte"
  import ErrorNotice from "./ErrorNotice.svelte"
  import Spinner from "./Spinner.svelte"

  interface Props {
    /** The host pastes the exercise this panel shows. */
    sourcePanel: TargetPanel<ExerciseSubmissionPanel>
    /** Copies the paste link through the host. */
    oncopy: (text: string) => void
  }

  /** The body of the Get Help section: sends the exercise to the backend's pastebin. */
  let { sourcePanel, oncopy }: Props = $props()

  const request = createRequester()

  let isPasting = $state<boolean>(false)
  // The host answers a paste once, so its link is kept here for the panel to show again.
  const pasted = uiState<ReplyValue<"pasteExercise"> | null>("paste", null)
  // The button that replaced the one that sent, which takes focus once the send settles.
  let focusTarget = $state<"copy" | "send" | undefined>(undefined)
  const focusIf = (target: "copy" | "send") =>
    focusWhen(
      () => focusTarget === target && !isPasting,
      () => (focusTarget = undefined),
    )
  let pasteError = $state<WebviewError | undefined>(undefined)

  /** Sends the exercise, unless a send is already under way. */
  export async function paste() {
    if (isPasting) {
      return
    }
    isPasting = true
    pasted.current = null
    pasteError = undefined
    const outcome = await request("pasteExercise", { sourcePanel })
    isPasting = false
    focusTarget = outcome.ok ? "copy" : "send"
    if (outcome.ok) {
      pasted.current = outcome.value
      announce(
        outcome.value.isReused ? "Your code is unchanged, so its link is the same" : "Link ready",
      )
    } else {
      pasteError = outcome.error
    }
  }
</script>

<p>
  Send your code to the pastebin and share the link on the course's discussion channel to ask for
  help.
</p>
{#if pasted.current !== null}
  {@const { link, isReused } = pasted.current}
  <p class="paste-url">
    <span class="muted">Link:</span>
    <span class="url">{link}</span>
  </p>
  {#if isReused}
    <p class="muted">Your code is unchanged since you last sent it, so this is the same link.</p>
  {/if}
  <div class="actions">
    <Button secondary icon="copy" {@attach focusIf("copy")} onclick={() => oncopy(link)}>
      Copy Link
    </Button>
    <Button
      secondary
      icon="link-external"
      onclick={() => vscode.postMessage({ type: "openLinkInBrowser", url: link })}
    >
      Open Link
    </Button>
    <Button secondary icon="cloud-upload" disabled={isPasting} onclick={paste}>Send Again</Button>
  </div>
{:else}
  <div class="actions">
    <Button secondary disabled={isPasting} {@attach focusIf("send")} onclick={paste}>
      Send to Pastebin
    </Button>
    {#if isPasting}
      <Spinner label="Sending to the pastebin…" />
    {/if}
  </div>
{/if}
{#if pasteError !== undefined}
  <ErrorNotice error={pasteError} title="Could not send to the pastebin" />
{/if}

<style>
  .url {
    font-family: var(--tmc-font-mono);
    overflow-wrap: anywhere;
  }
</style>
