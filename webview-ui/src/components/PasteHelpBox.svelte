<script lang="ts">
  // "Need help?" button that can be expanded for a prompt to submit to paste

  import { slide } from "svelte/transition"

  import type {
    ExerciseSubmissionPanel,
    ExerciseTestsPanel,
    LocalCourseData,
    LocalCourseExercise,
    TargetPanel,
  } from "../shared/shared"
  import { pasteServiceName } from "../shared/shared"
  import { reducedMotion } from "../utilities/a11y.svelte"
  import { vscode } from "../utilities/vscode"
  import Button from "./Button.svelte"
  import Notice from "./Notice.svelte"
  import Spinner from "./Spinner.svelte"

  interface Props {
    // matches the `pasteExercise` message sent to the extension host
    course: LocalCourseData
    exercise: LocalCourseExercise
    sourcePanel: TargetPanel<ExerciseTestsPanel | ExerciseSubmissionPanel>
    // Owned by the parent (arrive via a postMessage it listens for); plain one-way props.
    pasteUrl?: string | undefined
    pasteError?: string | undefined
    // asks the parent to clear any stale paste result before a new paste starts
    onPaste?: () => void
  }

  let { course, exercise, sourcePanel, pasteUrl, pasteError, onPaste }: Props = $props()

  const pasteService = $derived(pasteServiceName(course.kind))
  const regionId = $props.id()

  let hasRequestedPaste = $state<boolean>(false)
  let showHelp = $state<boolean>(false)
  const isPasting = $derived(
    hasRequestedPaste && pasteUrl === undefined && pasteError === undefined,
  )

  function toggleShowHelp() {
    showHelp = !showHelp
  }
  function paste() {
    // Clearing the previous result is the parent's concern; mutating its props here
    // would be silently clobbered on the next parent render.
    onPaste?.()
    hasRequestedPaste = true
    vscode.postMessage({
      type: "pasteExercise",
      course: course,
      exercise: exercise,
      requestingPanel: sourcePanel,
    })
  }
  function copyLink(url: string) {
    vscode.postMessage({ type: "copyToClipboard", text: url })
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
