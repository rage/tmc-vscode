<script lang="ts">
  import Button from "../components/Button.svelte"
  import PasteHelpBox from "../components/PasteHelpBox.svelte"
  import TestResults from "../components/TestResults.svelte"
  import type { ExerciseTestsPanel, TestResultData, WebviewError } from "../shared/shared"
  import { assertUnreachable, unwrap } from "../shared/shared"
  import { addMessageListener } from "../utilities/script"
  import { vscode } from "../utilities/vscode"

  interface Props {
    panel: ExerciseTestsPanel
  }

  let { panel }: Props = $props()

  // common course/exercise fields, independent of the backend
  const course = $derived(unwrap(panel.course))
  const exercise = $derived(unwrap(panel.exercise))

  let testError = $state<WebviewError | undefined>(undefined)
  let pasteResult = $state<string | undefined>(undefined)
  let pasteError = $state<string | undefined>(undefined)
  let testResults = $state<TestResultData | undefined>(undefined)
  let tryingToRunTestsForExam = $state<boolean | undefined>(undefined)

  const successPoints = $derived(
    (testResults?.testResult.testResults ?? [])
      .filter((tr) => tr.successful)
      .map((tr) => tr.points.length)
      .reduce((prev, curr) => prev + curr, 0),
  )
  const totalPoints = $derived(
    (testResults?.testResult.testResults ?? [])
      .map((tr) => tr.points.length)
      .reduce((prev, curr) => prev + curr, 0),
  )
  const allSuccessful = $derived(
    testResults && !testResults.testResult.testResults.some((tr) => !tr.successful),
  )
  const validationsFailed = $derived.by(() => {
    const validationStrategy = testResults?.styleValidationResult?.strategy
    const validationErrors = Object.entries(
      testResults?.styleValidationResult?.validation_errors ?? {},
    ).length
    return validationStrategy === "FAIL" && validationErrors > 0
  })

  // svelte-ignore state_referenced_locally -- the panel identity (id/type)
  // is fixed for the lifetime of the component, capturing the initial value is intended
  addMessageListener(panel, (message) => {
    switch (message.type) {
      case "testResults": {
        testResults = message.testResults
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
      case "testError": {
        testError = message.error
        submitting = false
        break
      }
      case "submitFailed": {
        submitting = false
        break
      }
      case "willNotRunTestsForExam": {
        tryingToRunTestsForExam = true
        break
      }
      default:
        assertUnreachable(message)
    }
  })

  function closePanel() {
    vscode.postMessage({ type: "closeSidePanel" })
  }
  function cancelTests() {
    vscode.postMessage({ type: "cancelTests", testRunId: panel.testRunId })
    vscode.postMessage({
      type: "closeSidePanel",
    })
  }
  // Guards against a rapid double-click sending two submits. Normally the submission
  // panel replaces this one, but a submit that never starts leaves this panel on
  // screen, so `submitFailed` resets the flag.
  let submitting = $state(false)
  function submit() {
    if (submitting) {
      return
    }
    submitting = true
    vscode.postMessage({
      type: "submitExercise",
      course: panel.course,
      exercise: panel.exercise,
      exerciseUri: panel.exerciseUri,
    })
  }
</script>

<div class="close-button">
  <Button secondary aria-label="Close" onclick={closePanel}>
    <vscode-icon name="close" aria-hidden="true"></vscode-icon>
  </Button>
</div>

{#if !tryingToRunTestsForExam && !testError}
  <h1 class="exercise-heading">{exercise.name}</h1>
  <div role="status">
    {#if testResults === undefined}
      <h2>Running tests</h2>
    {:else if testResults.testResult.status === "PASSED"}
      <h2>Tests passed</h2>
    {:else if testResults.testResult.status === "TESTS_FAILED"}
      <h2>Tests failed</h2>
    {:else if testResults.testResult.status === "COMPILE_FAILED"}
      <h2>Compilation failed</h2>
    {:else if testResults.testResult.status === "TESTRUN_INTERRUPTED"}
      <h2>The test run was interrupted</h2>
    {:else if testResults.testResult.status === "GENERIC_ERROR"}
      <h2>An error occurred during the test run</h2>
    {:else}
      {assertUnreachable(testResults.testResult.status)}
    {/if}
    {#if validationsFailed}
      <h2>Code quality checks failed</h2>
    {/if}
  </div>

  {#if testResults === undefined}
    <div class="button-container">
      <Button secondary onclick={closePanel}>Run in background</Button>
      <Button secondary onclick={cancelTests}>Cancel</Button>
    </div>
    <vscode-progress-ring aria-label="Running tests"></vscode-progress-ring>
  {:else}
    {#if course.disabled}
      <div>
        Sending the solution or pasting to the server is not available for this exercise, because
        the course is disabled.
      </div>
    {:else}
      <div class="header-container">
        <Button onclick={submit} disabled={submitting}>Submit to server</Button>
        {#if !allSuccessful}
          <span class="help-box-container">
            <PasteHelpBox
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
          </span>
        {/if}
      </div>
    {/if}
    <TestResults
      {totalPoints}
      {successPoints}
      testResults={testResults.testResult.testResults}
      validationResult={testResults.styleValidationResult ?? null}
      solutionUrl={null}
    />
  {/if}
{:else}
  <h1 class="exercise-heading">{exercise.name}</h1>

  {#if testError}
    <div role="alert">
      <h2>Error while trying to run tests</h2>
      <div class="error-message">{testError.message}</div>
      {#if testError.details}
        <code>{testError.details}</code>
      {/if}
    </div>
    <div>
      The tests could not be run locally. You can still submit your answer to the server, or close
      this panel and try again.
    </div>
  {:else}
    <div>You can submit your answer with the button below.</div>
  {/if}
  <div class="exam-submission-button-container">
    <Button onclick={submit} disabled={submitting}>Submit to server</Button>
  </div>
{/if}

<style>
  .exercise-heading {
    /* leave room for the absolutely-positioned close button */
    padding-right: 2.5rem;
  }
  .close-button {
    position: absolute;
    top: 0.4rem;
    right: 0.4rem;
  }
  .button-container {
    margin-bottom: 0.4rem;
  }
  .help-box-container {
    margin-top: 0.4rem;
    margin-bottom: 0.4rem;
  }
  .header-container {
    display: flex;
  }
  .exam-submission-button-container {
    margin-top: 1rem;
    margin-bottom: 1rem;
  }
  .error-message,
  code {
    white-space: pre-wrap;
  }
</style>
