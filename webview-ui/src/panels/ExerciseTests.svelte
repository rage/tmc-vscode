<script lang="ts">
  import { onMount } from "svelte"

  import Button from "../components/Button.svelte"
  import PasteHelpBox from "../components/PasteHelpBox.svelte"
  import TestResults from "../components/TestResults.svelte"
  import type { ExerciseTestsPanel, TestResultData } from "../shared/shared"
  import { BaseError, assertUnreachable, unwrap } from "../shared/shared"
  import { addMessageListener } from "../utilities/script"
  import { vscode } from "../utilities/vscode"

  interface Props {
    panel: ExerciseTestsPanel
  }

  let { panel }: Props = $props()

  // common course/exercise fields, independent of the backend
  const course = $derived(unwrap(panel.course))
  const exercise = $derived(unwrap(panel.exercise))

  let testError = $state<BaseError | undefined>(undefined)
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

  onMount(() => {
    vscode.postMessage({
      type: "requestExerciseTestsData",
      sourcePanel: panel,
    })
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
  // Guards against a rapid double-click sending two submits; the submission
  // panel replaces this one, so the flag never needs resetting.
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

  <div class="close-button">
    <Button secondary aria-label="Close" onclick={closePanel}>
      <vscode-icon name="close" aria-hidden="true"></vscode-icon>
    </Button>
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
        <span class="help-box-container">
          <PasteHelpBox
            hidden={allSuccessful ?? true}
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
    <div role="status">
      <h2>Error while trying to run tests</h2>
      <code>
        {testError.details}
      </code>
    </div>
  {/if}

  <div>You can submit your answer with the button below.</div>
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
  code {
    white-space: pre-wrap;
  }
</style>
