<script lang="ts">
  import { onMount } from "svelte"
  import { writable } from "svelte/store"

  import PasteHelpBox from "../components/PasteHelpBox.svelte"
  import ProgressBar from "../components/ProgressBar.svelte"
  import TestResults from "../components/TestResults.svelte"
  import { SubmissionFinished } from "../shared/langsSchema"
  import type { ExerciseSubmissionPanel, FeedbackQuestion } from "../shared/shared"
  import { assertUnreachable, unwrap } from "../shared/shared"
  import { addMessageListener, loadable } from "../utilities/script"
  import { vscode } from "../utilities/vscode"

  interface Props {
    panel: ExerciseSubmissionPanel
  }

  let { panel }: Props = $props()

  // common exercise fields, independent of the backend
  const exercise = $derived(unwrap(panel.exercise))

  const submissionStatusUrl = loadable<string>()
  const progressPercent = writable<number>(0)
  const progressMessages = writable<Array<string>>([])
  const submissionError = loadable<Error>()
  const submissionResult = loadable<SubmissionFinished>()
  const feedbackQuestions = loadable<Array<FeedbackQuestion>>()
  const pasteResult = loadable<string>()
  const pasteError = loadable<string>()

  onMount(() => {
    vscode.postMessage({
      type: "requestExerciseSubmissionData",
      sourcePanel: panel,
    })
  })
  // svelte-ignore state_referenced_locally -- the panel identity (id/type)
  // is fixed for the lifetime of the component, capturing the initial value is intended
  addMessageListener(panel, (message) => {
    switch (message.type) {
      case "submissionStatusUrl": {
        submissionStatusUrl.set(message.url)
        break
      }
      case "submissionStatusUpdate": {
        progressPercent.set(message.progressPercent)
        progressMessages.update((ms) => {
          if (message.message !== undefined) {
            ms.push(message.message)
          }
          return ms
        })
        break
      }
      case "submissionStatusError": {
        submissionError.set(message.error)
        break
      }
      case "submissionResult": {
        submissionResult.set(message.result)
        feedbackQuestions.set(message.questions)
        break
      }
      case "pasteResult": {
        pasteResult.set(message.pasteLink)
        break
      }
      case "pasteError": {
        pasteError.set(message.error)
        break
      }
      default: {
        assertUnreachable(message)
      }
    }
  })

  function runInBackground() {
    vscode.postMessage({ type: "closeSidePanel" })
  }
  function showInBrowser(submissionUrl: string) {
    vscode.postMessage({
      type: "openLinkInBrowser",
      url: submissionUrl,
    })
  }
  function closePanel() {
    vscode.postMessage({ type: "closeSidePanel" })
  }
</script>

{#if $submissionResult === undefined}
  <h1>Processing submission...</h1>
{:else if $submissionResult.status === "ok"}
  {#if $submissionResult.all_tests_passed}
    <h1>All tests passed on the server</h1>
  {:else}
    <h1>Some tests failed on the server</h1>
  {/if}
{:else if $submissionResult.status === "hidden"}
  <h1>Processing the submission finished</h1>
{:else if $submissionResult.status === "fail"}
  <!-- validation failure etc. -->
  <h1>Some tests failed on the server</h1>
{:else}
  <h1>Something went wrong...</h1>
  <div>Submission status: {$submissionResult.status}</div>
{/if}

<vscode-button
  role="button"
  tabindex="0"
  class="close-button"
  secondary
  onclick={closePanel}
  onkeypress={closePanel}
>
  ×
</vscode-button>

{#if $submissionResult && !$submissionResult.all_tests_passed}
  <div class="help-box-container">
    <PasteHelpBox
      hidden={false}
      course={panel.course}
      exercise={panel.exercise}
      sourcePanel={{ id: panel.id, type: panel.type }}
      pasteUrl={$pasteResult}
      pasteError={$pasteError}
    />
  </div>
{/if}

{#if $submissionResult === undefined}
  <div>
    <vscode-button
      role="button"
      tabindex="0"
      secondary
      onclick={runInBackground}
      onkeypress={runInBackground}
    >
      Run in background
    </vscode-button>
    <vscode-button
      role="button"
      tabindex="0"
      secondary
      onclick={() => $submissionStatusUrl && showInBrowser($submissionStatusUrl)}
      onkeypress={() => $submissionStatusUrl && showInBrowser($submissionStatusUrl)}
      disabled={$submissionStatusUrl === undefined}
    >
      Show submission in browser
    </vscode-button>
  </div>

  <div class="progress-bar">
    <ProgressBar label={"Running tests on the server"} value={$progressPercent} max={100} />
  </div>

  <div>
    {#each $progressMessages as message, idx}
      {#if idx < $progressMessages.length - 1}
        <div>✓ {message}</div>
      {:else}
        <div class="current-message">{message}</div>
        <vscode-progress-ring></vscode-progress-ring>
      {/if}
    {/each}
  </div>
{:else}
  <TestResults
    totalPoints={exercise.availablePoints}
    successPoints={$submissionResult.points.length}
    testResults={$submissionResult.test_cases ?? []}
    validationResult={$submissionResult.validations && {
      strategy: $submissionResult.validations.strategy,
      validation_errors: $submissionResult.validations.validationErrors,
    }}
    solutionUrl={$submissionResult.solution_url}
  />
{/if}

<style>
  .close-button {
    position: absolute;
    top: 0.4rem;
    right: 0.4rem;
  }
  .help-box-container {
    margin-top: 0.4rem;
  }
  .progress-bar {
    margin-top: 1rem;
    margin-bottom: 1rem;
  }
  .current-message {
    margin-bottom: 1rem;
  }
</style>
