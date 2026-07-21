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
  import { vscode } from "../utilities/vscode"
  import Button from "./Button.svelte"

  interface Props {
    hidden: boolean
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

  let { hidden, course, exercise, sourcePanel, pasteUrl, pasteError, onPaste }: Props = $props()

  let pasting = $state<boolean>(false)
  let showHelp = $state<boolean>(false)

  function toggleShowHelp() {
    showHelp = !showHelp
  }
  function paste() {
    // Clearing the previous result is the parent's concern; mutating its props here
    // would be silently clobbered on the next parent render.
    onPaste?.()
    pasting = true
    vscode.postMessage({
      type: "pasteExercise",
      course: course,
      exercise: exercise,
      requestingPanel: sourcePanel,
    })
  }
</script>

<Button {hidden} secondary onclick={toggleShowHelp}>Need help?</Button>
{#if showHelp}
  <div class="help" transition:slide>
    <h2 class="header">Submit to TMC Paste</h2>
    <div>
      You can submit your code to TMC Paste and share the link to the course discussion channel and
      ask for help.
    </div>
    <div class="paste-button-container">
      <Button onclick={paste}>Submit to TMC Paste</Button>
    </div>
    <div class="paste-results-container">
      {#if pasteUrl !== undefined}
        <div>
          Paste available at <a href={pasteUrl}>{pasteUrl}</a>
        </div>
      {/if}
      {#if pasteError !== undefined}
        <div>
          Failed to submit to TMC Paste: {pasteError}
        </div>
      {/if}
      {#if pasting && pasteUrl === undefined && pasteError === undefined}
        <div>Sending to TMC Paste…</div>
        <vscode-progress-ring></vscode-progress-ring>
      {/if}
    </div>
  </div>
{/if}

<style>
  .help {
    border: 1px solid;
    padding: 0.8rem;
    margin-top: 0.4rem;
  }
  .paste-button-container {
    margin-top: 0.8rem;
  }
  .header {
    margin-top: 0rem;
    margin-bottom: 0.4rem;
  }
  .paste-results-container {
    margin-top: 0.8rem;
  }
</style>
