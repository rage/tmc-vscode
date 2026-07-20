<script lang="ts">
  // "Need help?" button that can be expanded for a prompt to submit to paste

  import { writable } from "svelte/store"

  import type {
    ExerciseSubmissionPanel,
    ExerciseTestsPanel,
    LocalCourseData,
    LocalCourseExercise,
    TargetPanel,
  } from "../shared/shared"
  import { vscode } from "../utilities/vscode"

  interface Props {
    hidden: boolean
    // matches the `pasteExercise` message sent to the extension host
    course: LocalCourseData
    exercise: LocalCourseExercise
    sourcePanel: TargetPanel<ExerciseTestsPanel | ExerciseSubmissionPanel>
    pasteUrl?: string | undefined
    pasteError?: string | undefined
  }

  let {
    hidden,
    course,
    exercise,
    sourcePanel,
    pasteUrl = $bindable(undefined),
    pasteError = $bindable(undefined),
  }: Props = $props()

  const pasting = writable<boolean>(false)
  const showHelp = writable<boolean>(false)

  function toggleShowHelp() {
    showHelp.update((val) => {
      return !val
    })
  }
  function paste() {
    pasteUrl = undefined
    pasteError = undefined
    pasting.set(true)
    vscode.postMessage({
      type: "pasteExercise",
      course: course,
      exercise: exercise,
      requestingPanel: sourcePanel,
    })
  }
</script>

<vscode-button
  role="button"
  tabindex="0"
  {hidden}
  secondary
  onclick={toggleShowHelp}
  onkeypress={toggleShowHelp}
>
  Need help?
</vscode-button>
<div class="help" hidden={!$showHelp}>
  <h2 class="header">Submit to TMC Paste</h2>
  <div>
    You can submit your code to TMC Paste and share the link to the course discussion channel and
    ask for help.
  </div>
  <div class="paste-button-container">
    <vscode-button role="button" tabindex="0" onclick={paste} onkeypress={paste}>
      Submit to TMC Paste
    </vscode-button>
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
    {#if $pasting && pasteUrl === undefined && pasteError === undefined}
      <div>Sending to TMC Paste...</div>
      <vscode-progress-ring></vscode-progress-ring>
    {/if}
  </div>
</div>

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
