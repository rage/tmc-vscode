<script lang="ts">
  import { StyleValidationStrategy, TestCase, TestResult } from "../shared/langsSchema"
  import { vscode } from "../utilities/vscode"
  import Button from "./Button.svelte"
  import Checkbox from "./Checkbox.svelte"
  import ProgressBar from "./ProgressBar.svelte"

  // structural subset of both StyleValidationResult (local test runs) and
  // TmcStyleValidationResult (server submissions), which differ only in the
  // shape of fields this component does not use
  interface ValidationResult {
    strategy: StyleValidationStrategy
    validation_errors: Record<
      string,
      Array<{ column: number; line: number; message: string }>
    > | null
  }

  interface Props {
    totalPoints: number
    successPoints: number
    testResults: Array<TestResult | TestCase>
    validationResult: ValidationResult | null
    solutionUrl: string | null
  }

  let { totalPoints, successPoints, testResults, validationResult, solutionUrl }: Props = $props()

  const validationStrategy: StyleValidationStrategy = $derived(
    validationResult?.strategy ?? "DISABLED",
  )
  const validationErrors = $derived(validationResult?.validation_errors ?? {})
  const validationErrorsEntries = $derived(Object.entries(validationErrors))
  // validations pass if strategy is not set to fail, or if there are no validation errors
  const validationsPassed = $derived(
    validationStrategy !== "FAIL" || validationErrorsEntries.length === 0,
  )

  const allTestsFailed = $derived(!testResults.some((tr) => tr.successful))
  const allTestsPassed = $derived(!testResults.some((tr) => !tr.successful))
  const exercisePassed = $derived(allTestsPassed && validationsPassed)
  // if all tests failed or passed, no need to show the checkbox
  const alwaysShowPassedTests = $derived(allTestsFailed || exercisePassed)

  let showPassedTestsChecked = $state(false)
  const showPassedTests = $derived(alwaysShowPassedTests || showPassedTestsChecked)

  const pointsPercent = $derived(
    totalPoints > 0 ? ((successPoints / totalPoints) * 100.0).toFixed(2) : 0.0,
  )

  function showInBrowser(submissionUrl: string) {
    vscode.postMessage({
      type: "openLinkInBrowser",
      url: submissionUrl,
    })
  }
</script>

<div class="points-display">
  <ProgressBar label={`Points: ${pointsPercent}%`} value={successPoints} max={totalPoints} />
</div>
<div>
  <Checkbox hidden={alwaysShowPassedTests} bind:checked={showPassedTestsChecked}>
    Show passed tests
  </Checkbox>
</div>

<div class="solution-button-container" hidden={solutionUrl === null}>
  <Button onclick={() => solutionUrl && showInBrowser(solutionUrl)}>
    Show model solution in browser
  </Button>
</div>

<!-- FAIL vs. non-FAIL differ only in container/heading class and heading text, so
     share this snippet. -->
{#snippet validationBlock(
  path: string,
  errors: Array<{ column: number; line: number; message: string }>,
  containerClass: string,
  headingClass: string,
  heading: string,
)}
  <div class="test {containerClass}">
    <h2 class={headingClass}>{heading}</h2>
    <h3>File: {path}</h3>
    {#each errors as pathValidationError}
      <pre
        class="test-message">Line {pathValidationError.line}, column {pathValidationError.column}: {pathValidationError.message}</pre>
    {/each}
  </div>
{/snippet}

<div class="test-results-container">
  {#each validationErrorsEntries as [path, pathValidationErrors]}
    {#if validationStrategy === "FAIL"}
      {@render validationBlock(
        path,
        pathValidationErrors,
        "failed-container",
        "failed",
        "Code quality errors found",
      )}
    {:else}
      {@render validationBlock(
        path,
        pathValidationErrors,
        "warning-container",
        "warning",
        "Code quality warnings found",
      )}
    {/if}
  {/each}
  {#each testResults as testResult}
    {#if testResult.successful}
      <div class="test passed-container" hidden={!showPassedTests}>
        <h2 class="passed">Test passed!</h2>
        <h3>{testResult.name}</h3>
      </div>
    {:else}
      <div class="test failed-container">
        <h2 class="failed">Test failed</h2>
        <h3>{testResult.name}</h3>
        <pre class="test-message">{testResult.message}</pre>
      </div>
    {/if}
  {/each}
</div>

<style>
  .test {
    border: 1px dashed;
    border-left: 0.4rem solid;
    padding: 0.4rem;
    margin-top: 0.4rem;
    margin-bottom: 0.4rem;
  }
  .passed {
    color: var(--vscode-testing-iconPassed, #73c991);
  }
  .passed-container {
    border-color: var(--vscode-testing-iconPassed, #73c991);
  }
  .failed {
    color: var(--vscode-testing-iconFailed, #f14c4c);
  }
  .failed-container {
    border-color: var(--vscode-testing-iconFailed, #f14c4c);
  }
  .warning {
    color: var(--vscode-testing-iconQueued, #cca700);
  }
  .warning-container {
    border-color: var(--vscode-testing-iconQueued, #cca700);
  }
  .test-message {
    white-space: break-spaces;
  }
  .points-display {
    margin-top: 1rem;
    margin-bottom: 1rem;
  }
  .solution-button-container {
    margin-top: 1rem;
    margin-bottom: 1rem;
  }
  .test-results-container {
    margin-top: 1rem;
    margin-bottom: 1rem;
  }
</style>
