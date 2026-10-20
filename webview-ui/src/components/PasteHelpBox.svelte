<script lang="ts">
  import type {
    BackendKind,
    ExerciseSubmissionPanel,
    TargetPanel,
    WebviewError,
  } from "../../../shared/lib"
  import { pasteServiceName } from "../../../shared/lib"
  import { createRequester } from "../utilities/script"
  import { uiState } from "../utilities/uiState.svelte"
  import { vscode } from "../utilities/vscode"
  import Button from "./Button.svelte"
  import ErrorNotice from "./ErrorNotice.svelte"
  import Section from "./Section.svelte"
  import Spinner from "./Spinner.svelte"
  import ToolbarButton from "./ToolbarButton.svelte"

  interface Props {
    /** Names the paste service; the host pastes the exercise `sourcePanel` shows. */
    backend: BackendKind
    sourcePanel: TargetPanel<ExerciseSubmissionPanel>
    /** The section heading's id, so the action that opened the section can focus it. */
    headingId?: string | undefined
    /** Copies the paste link through the host. */
    oncopy: (text: string) => void
    onhide: () => void
  }

  /** The "Get help" section: sends the exercise to the backend's paste service for a link. */
  let { backend, sourcePanel, headingId, oncopy, onhide }: Props = $props()

  const pasteService = $derived(pasteServiceName(backend))
  const request = createRequester()

  let isPasting = $state<boolean>(false)
  // The host answers a paste once, so its link is kept here for the panel to show again.
  const pasteUrl = uiState<string | null>("pasteUrl", null)
  let pasteError = $state<WebviewError | undefined>(undefined)

  async function paste() {
    isPasting = true
    pasteUrl.current = null
    pasteError = undefined
    const outcome = await request("pasteExercise", { sourcePanel })
    isPasting = false
    if (outcome.ok) {
      pasteUrl.current = outcome.value
    } else {
      pasteError = outcome.error
    }
  }
</script>

<Section title="Get help" {headingId}>
  {#snippet actions()}
    <ToolbarButton icon="close" label="Hide Get Help" onclick={onhide} />
  {/snippet}
  <p>
    Send your code to {pasteService} and share the link on the course's discussion channel to ask for
    help.
    {#if backend === "mooc"}This also submits your answer for grading.{/if}
  </p>
  {#if pasteUrl.current !== null}
    {@const url = pasteUrl.current}
    <p class="paste-url">
      <span class="muted">Link:</span>
      <span class="url">{url}</span>
    </p>
    <div class="actions">
      <Button secondary icon="copy" onclick={() => oncopy(url)}>Copy Link</Button>
      <Button
        secondary
        icon="link-external"
        onclick={() => vscode.postMessage({ type: "openLinkInBrowser", url })}
      >
        Open Link
      </Button>
      <Button secondary icon="cloud-upload" disabled={isPasting} onclick={paste}>Send Again</Button>
    </div>
  {:else}
    <div class="actions">
      <Button secondary disabled={isPasting} onclick={paste}>Send to {pasteService}</Button>
      {#if isPasting}
        <Spinner label="Sending to {pasteService}…" />
      {/if}
    </div>
  {/if}
  {#if pasteError !== undefined}
    <ErrorNotice error={pasteError} title="Failed to send to {pasteService}" />
  {/if}
</Section>

<style>
  .url {
    font-family: var(--tmc-font-mono);
    overflow-wrap: anywhere;
  }
</style>
