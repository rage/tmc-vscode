<script lang="ts">
  import { onMount } from "svelte"

  import Button from "../components/Button.svelte"
  import PasteHelpBox from "../components/PasteHelpBox.svelte"
  import ProgressBar from "../components/ProgressBar.svelte"
  import TestResults from "../components/TestResults.svelte"
  import { ExerciseTaskSubmissionStatus, SubmissionFinished } from "../shared/langsSchema"
  import type { ExerciseSubmissionPanel } from "../shared/shared"
  import { assertUnreachable, unwrap } from "../shared/shared"
  import { addMessageListener } from "../utilities/script"
  import { vscode } from "../utilities/vscode"

  interface Props {
    panel: ExerciseSubmissionPanel
  }

  let { panel }: Props = $props()

  // common exercise fields, independent of the backend
  const exercise = $derived(unwrap(panel.exercise))
  const isMooc = $derived(panel.exercise.kind === "mooc")

  let submissionStatusUrl = $state<string | undefined>(undefined)
  let progressPercent = $state<number>(0)
  let progressMessages = $state<Array<string>>([])
  let submissionError = $state<Error | undefined>(undefined)
  let submissionResult = $state<SubmissionFinished | undefined>(undefined)
  let pasteResult = $state<string | undefined>(undefined)
  let pasteError = $state<string | undefined>(undefined)
  // mooc grading has no per-test breakdown, so it is stored separately and
  // rendered as a reduced result (overall progress, score, feedback text)
  let moocResult = $state<ExerciseTaskSubmissionStatus | undefined>(undefined)
  const moocGrading = $derived(
    moocResult !== undefined && moocResult !== "NoGradingYet" ? moocResult.Grading : undefined,
  )
  // Terminal = no more updates coming; only `FullyGraded`/`Failed` qualify, everything
  // else (including no result yet) can still change.
  const moocGradingIsTerminal = $derived(
    moocGrading?.grading_progress === "FullyGraded" || moocGrading?.grading_progress === "Failed",
  )

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
        submissionStatusUrl = message.url
        break
      }
      case "submissionStatusUpdate": {
        progressPercent = message.progressPercent
        if (message.message !== undefined) {
          progressMessages.push(message.message)
        }
        break
      }
      case "submissionStatusError": {
        submissionError = message.error
        break
      }
      case "submissionResult": {
        submissionResult = message.result
        break
      }
      case "moocSubmissionResult": {
        moocResult = message.result
        break
      }
      case "pasteResult": {
        pasteResult = message.pasteLink
        break
      }
      case "pasteError": {
        pasteError = message.error
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

<!-- Completed steps as ✓ lines, the latest step live with a spinner; shared by the mooc
     and tmc branches, differing only in the spinner's accessible label. -->
{#snippet progressList(ariaLabel: string)}
  {#each progressMessages as message, idx}
    {#if idx < progressMessages.length - 1}
      <div>✓ {message}</div>
    {:else}
      <div class="current-message">{message}</div>
      <vscode-progress-ring aria-label={ariaLabel}></vscode-progress-ring>
    {/if}
  {/each}
{/snippet}

<div class="close-button">
  <Button secondary aria-label="Close" onclick={closePanel}>
    <vscode-icon name="close" aria-hidden="true"></vscode-icon>
  </Button>
</div>

{#if isMooc}
  <!-- Reduced mooc result: overall grading progress, score, feedback text.
       Mooc grading has no per-test breakdown or feedback questions. -->
  <div role="status">
    {#if submissionError !== undefined}
      <h1>Submission failed</h1>
      <div class="feedback-text">{submissionError.message}</div>
    {:else if moocResult === undefined}
      <h1>Processing submission…</h1>
      <div class="progress-bar">
        <ProgressBar label={"Waiting for grading"} value={progressPercent} max={100} />
      </div>
      <div>{@render progressList("Waiting for grading")}</div>
    {:else if moocGrading === undefined}
      <h1>Grading has not started yet</h1>
    {:else}
      {#if moocGrading.grading_progress === "FullyGraded"}
        <h1>Exercise graded</h1>
      {:else if moocGrading.grading_progress === "Failed"}
        <h1>Grading failed</h1>
      {:else if moocGrading.grading_progress === "PendingManual"}
        <h1>Awaiting manual grading</h1>
      {:else}
        <h1>Grading still in progress</h1>
      {/if}
      {#if moocGrading.score_given !== null}
        <div class="mooc-score">Score: {moocGrading.score_given}</div>
      {/if}
      {#if moocGrading.feedback_text}
        <div class="feedback-text">{moocGrading.feedback_text}</div>
      {/if}
    {/if}
  </div>

  {#if submissionError === undefined && !moocGradingIsTerminal}
    <!-- Stays visible through every non-terminal state, including "PendingManual" which can
         still take a while, hiding only once grading is truly done. -->
    <div class="background-button">
      <Button secondary onclick={runInBackground}>Run in background</Button>
    </div>
  {/if}
{:else}
  <div role="status">
    {#if submissionResult === undefined}
      <h1>Processing submission…</h1>
    {:else if submissionResult.status === "ok"}
      {#if submissionResult.all_tests_passed}
        <h1>All tests passed on the server</h1>
      {:else}
        <h1>Some tests failed on the server</h1>
      {/if}
    {:else if submissionResult.status === "hidden"}
      <h1>Processing the submission finished</h1>
    {:else if submissionResult.status === "fail"}
      <!-- validation failure etc. -->
      <h1>Some tests failed on the server</h1>
    {:else}
      <h1>Something went wrong…</h1>
      <div>The submission could not be processed. Please try submitting again.</div>
    {/if}
  </div>

  {#if submissionResult && !submissionResult.all_tests_passed}
    <div class="help-box-container">
      <PasteHelpBox
        hidden={false}
        course={panel.course}
        exercise={panel.exercise}
        sourcePanel={{ id: panel.id, type: panel.type }}
        pasteUrl={pasteResult}
        {pasteError}
        onPaste={() => {
          pasteResult = undefined
          pasteError = undefined
        }}
      />
    </div>
  {/if}

  {#if submissionResult === undefined}
    <div>
      <Button secondary onclick={runInBackground}>Run in background</Button>
      <Button
        secondary
        onclick={() => submissionStatusUrl && showInBrowser(submissionStatusUrl)}
        disabled={submissionStatusUrl === undefined}
      >
        Show submission in browser
      </Button>
    </div>

    <div class="progress-bar">
      <ProgressBar label={"Running tests on the server"} value={progressPercent} max={100} />
    </div>

    <div role="status">{@render progressList("Running tests on the server")}</div>
  {:else}
    <TestResults
      totalPoints={exercise.availablePoints}
      successPoints={submissionResult.points.length}
      testResults={submissionResult.test_cases ?? []}
      validationResult={submissionResult.validations && {
        strategy: submissionResult.validations.strategy,
        validation_errors: submissionResult.validations.validationErrors,
      }}
      solutionUrl={submissionResult.solution_url}
    />
  {/if}
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
  .mooc-score {
    margin-bottom: 0.4rem;
  }
  .feedback-text {
    white-space: pre-wrap;
    margin-top: 0.4rem;
  }
  .background-button {
    margin-top: 0.4rem;
  }
</style>
