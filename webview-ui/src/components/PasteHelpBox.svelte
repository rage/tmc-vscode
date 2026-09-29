<script lang="ts">
  // "Need help?" button that can be expanded for a prompt to submit to paste

  import { slide } from "svelte/transition"

  import type { ExerciseSubmissionPanel, LocalCourseData, TargetPanel } from "../shared/shared"
  import { pasteServiceName } from "../shared/shared"
  import { announce, reducedMotion } from "../utilities/a11y.svelte"
  import { createRequester } from "../utilities/script"
  import Button from "./Button.svelte"
  import Notice from "./Notice.svelte"
  import Spinner from "./Spinner.svelte"

  interface Props {
    // names the paste service; the host pastes the exercise `sourcePanel` shows
    course: LocalCourseData
    sourcePanel: TargetPanel<ExerciseSubmissionPanel>
  }

  let { course, sourcePanel }: Props = $props()

  const pasteService = $derived(pasteServiceName(course.kind))
  const regionId = $props.id()
  const request = createRequester()

  let isPasting = $state<boolean>(false)
  let pasteUrl = $state<string | undefined>(undefined)
  let pasteError = $state<string | undefined>(undefined)
  let showHelp = $state<boolean>(false)

  function toggleShowHelp() {
    showHelp = !showHelp
  }
  async function paste() {
    isPasting = true
    pasteUrl = undefined
    pasteError = undefined
    const outcome = await request("pasteExercise", { sourcePanel })
    isPasting = false
    if (outcome.ok) {
      pasteUrl = outcome.value
    } else {
      pasteError = outcome.error.message
    }
  }
  async function copyLink(url: string) {
    const outcome = await request("copyToClipboard", { sourcePanel, text: url })
    announce(outcome.ok ? "Copied to the clipboard" : "Could not copy to the clipboard")
  }
</script>

<div class="actions">
  <Button
    secondary
    aria-expanded={showHelp}
    aria-controls={showHelp ? regionId : undefined}
    onclick={toggleShowHelp}
  >
    Need help?
  </Button>
</div>
{#if showHelp}
  <div id={regionId} class="help" transition:slide={{ duration: reducedMotion.current ? 0 : 200 }}>
    <h2 class="header">Submit to {pasteService}</h2>
    <p>
      You can submit your code to {pasteService} and share the link to the course discussion channel and
      ask for help.
    </p>
    {#if course.kind === "mooc"}
      <p>This also submits your answer for grading, like Submit to server does.</p>
    {/if}
    <div class="actions">
      <Button secondary disabled={isPasting} onclick={paste}>Submit to {pasteService}</Button>
    </div>
    {#if pasteUrl !== undefined}
      <p>Paste available at <a href={pasteUrl}>{pasteUrl}</a></p>
      <div class="actions">
        <Button secondary icon="copy" onclick={() => pasteUrl && copyLink(pasteUrl)}>
          Copy link
        </Button>
      </div>
    {/if}
    {#if pasteError !== undefined}
      <Notice kind="error">Failed to submit to {pasteService}: {pasteError}</Notice>
    {/if}
    {#if isPasting}
      <Spinner label="Sending to {pasteService}…" />
    {/if}
  </div>
{/if}

<style>
  .help {
    border: 1px solid var(--tmc-surface-border);
    border-radius: var(--tmc-radius);
    padding: var(--tmc-space-3);
    margin-top: var(--tmc-space-1);
  }
  .header {
    margin-top: 0;
  }
  .actions {
    margin: var(--tmc-space-2) 0;
  }
</style>
