<script lang="ts">
  import { onMount } from "svelte"
  import { derived } from "svelte/store"

  import PasteHelpBox from "../components/PasteHelpBox.svelte"
  import TestResults from "../components/TestResults.svelte"
  import type { ExerciseTestsPanel, TestResultData } from "../shared/shared"
  import { BaseError, assertUnreachable, unwrap } from "../shared/shared"
  import { addMessageListener, loadable } from "../utilities/script"
  import { vscode } from "../utilities/vscode"

  interface Props {
    panel: ExerciseTestsPanel
  }

  let { panel }: Props = $props()

  // common course/exercise fields, independent of the backend
  const course = $derived(unwrap(panel.course))
  const exercise = $derived(unwrap(panel.exercise))

  const testError = loadable<BaseError>()
  const pasteResult = loadable<string>()
  const pasteError = loadable<string>()
  const testResults = loadable<TestResultData>()
  const tryingToRunTestsForExam = loadable<boolean>()

  const successPoints = derived(testResults, ($testResults) => {
    return ($testResults?.testResult.testResults ?? [])
      .filter((tr) => tr.successful)
      .map((tr) => tr.points.length)
      .reduce((prev, curr) => prev + curr, 0)
  })
  const totalPoints = derived(testResults, ($testResults) => {
    return ($testResults?.testResult.testResults ?? [])
      .map((tr) => tr.points.length)
      .reduce((prev, curr) => prev + curr, 0)
  })
  const allSuccessful = derived(testResults, ($testResults) => {
    return $testResults && !$testResults.testResult.testResults.some((tr) => !tr.successful)
  })
  const validationsFailed = derived(testResults, ($testResults) => {
    const validationStrategy = $testResults?.styleValidationResult?.strategy
    const validationErrors = Object.entries(
      $testResults?.styleValidationResult?.validation_errors ?? {},
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
        testResults.set(message.testResults)
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
      case "testError": {
        testError.set(message.error)
        break
      }
      case "willNotRunTestsForExam": {
        tryingToRunTestsForExam.set(true)
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
  function submit() {
    vscode.postMessage({
      type: "submitExercise",
      course: panel.course,
      exercise: panel.exercise,
      exerciseUri: panel.exerciseUri,
    })
  }
</script>

{#if !$tryingToRunTestsForExam && !$testError}
  <h1>{exercise.name}</h1>
  {#if $testResults === undefined}
    <h2>Running tests</h2>
  {:else if $testResults.testResult.status === "PASSED"}
    <h2>Tests passed</h2>
  {:else if $testResults.testResult.status === "TESTS_FAILED"}
    <h2>Tests failed</h2>
  {:else if $testResults.testResult.status === "COMPILE_FAILED"}
    <h2>Compilation failed</h2>
  {:else if $testResults.testResult.status === "TESTRUN_INTERRUPTED"}
    <h2>The test run was interrupted</h2>
  {:else if $testResults.testResult.status === "GENERIC_ERROR"}
    <h2>An error occurred during the test run</h2>
  {:else}
    {assertUnreachable($testResults.testResult.status)}
  {/if}
  {#if $validationsFailed}
    <h2>Code quality checks failed</h2>
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

  {#if $testResults === undefined}
    <div class="button-container">
      <vscode-button
        role="button"
        tabindex="0"
        secondary
        onclick={closePanel}
        onkeypress={closePanel}
      >
        Run in background
      </vscode-button>
      <vscode-button
        role="button"
        tabindex="0"
        secondary
        onclick={cancelTests}
        onkeypress={cancelTests}
      >
        Cancel
      </vscode-button>
    </div>
    <vscode-progress-ring></vscode-progress-ring>
  {:else}
    {#if course.disabled}
      <div>
        Sending the solution or pasting to the TMC server is not available for this exercise,
        because the course is disabled.
      </div>
    {:else}
      <div class="header-container">
        <vscode-button role="button" tabindex="0" onclick={submit} onkeypress={submit}>
          Send solution to server
        </vscode-button>
        <span class="help-box-container">
          <PasteHelpBox
            hidden={$allSuccessful ?? true}
            course={panel.course}
            exercise={panel.exercise}
            sourcePanel={panel}
            pasteUrl={$pasteResult}
            pasteError={$pasteError}
          />
        </span>
      </div>
    {/if}
    <TestResults
      totalPoints={$totalPoints}
      successPoints={$successPoints}
      testResults={$testResults.testResult.testResults}
      validationResult={$testResults.styleValidationResult ?? null}
      solutionUrl={null}
    />
  {/if}
{:else}
  <h1>{course.title}: {exercise.name}</h1>

  {#if $testError}
    <h2>Error while trying to run tests</h2>
    <code>
      {$testError.details}
    </code>
  {/if}

  <div>You can submit your answer with the button below.</div>
  <div class="exam-submission-button-container">
    <vscode-button role="button" tabindex="0" onclick={submit} onkeypress={submit}>
      Submit to server
    </vscode-button>
  </div>
{/if}

<style>
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
