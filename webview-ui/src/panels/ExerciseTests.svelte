<script lang="ts">
  import Button from "../components/Button.svelte"
  import CodeBlock from "../components/CodeBlock.svelte"
  import Disclosure from "../components/Disclosure.svelte"
  import Notice from "../components/Notice.svelte"
  import PanelHeader from "../components/PanelHeader.svelte"
  import PasteHelpBox from "../components/PasteHelpBox.svelte"
  import Spinner from "../components/Spinner.svelte"
  import TestResults from "../components/TestResults.svelte"
  import ToolbarButton from "../components/ToolbarButton.svelte"
  import type { RunStatus } from "../shared/langsSchema"
  import type { ExerciseTestsPanel, TestResultData, WebviewError } from "../shared/shared"
  import { assertUnreachable, unwrap } from "../shared/shared"
  import { announce } from "../utilities/a11y.svelte"
  import { addMessageListener } from "../utilities/script"
  import { awardedPoints } from "../utilities/testPoints"
  import { vscode } from "../utilities/vscode"

  interface Props {
    panel: ExerciseTestsPanel
  }

  let { panel }: Props = $props()

  // common course/exercise fields, independent of the backend
  const course = $derived(unwrap(panel.course))
  const exercise = $derived(unwrap(panel.exercise))

  let testError = $state.raw<WebviewError | undefined>(undefined)
  let pasteResult = $state<string | undefined>(undefined)
  let pasteError = $state<string | undefined>(undefined)
  let testResults = $state.raw<TestResultData | undefined>(undefined)
  let tryingToRunTestsForExam = $state<boolean | undefined>(undefined)
  // Guards against a rapid double-click sending two submits. Normally the submission
  // panel replaces this one, but a submit that never starts leaves this panel on
  // screen, so `submitFailed` resets the flag.
  let submitting = $state(false)

  const results = $derived(testResults?.testResult.testResults ?? [])
  const allSuccessful = $derived(testResults && !results.some((tr) => !tr.successful))
  const validationsFailed = $derived.by(() => {
    const validationStrategy = testResults?.styleValidationResult?.strategy
    const validationErrors = Object.entries(
      testResults?.styleValidationResult?.validation_errors ?? {},
    ).length
    return validationStrategy === "FAIL" && validationErrors > 0
  })
  // A mooc exercise's available points are a score maximum, not point names, so only a TMC
  // exercise's local points can be compared against them.
  const points = $derived(
    panel.exercise.kind === "tmc" && results.length > 0
      ? { awarded: awardedPoints(results).size, available: exercise.availablePoints }
      : undefined,
  )
  const stdout = $derived(testResults?.testResult.logs.stdout ?? "")
  const stderr = $derived(testResults?.testResult.logs.stderr ?? "")
  // Compiler errors arrive only as output, with no test results.
  const isOutputOpenInitially = $derived(
    testResults?.testResult.status === "COMPILE_FAILED" || results.length === 0,
  )

  function statusHeadline(status: RunStatus): string {
    switch (status) {
      case "PASSED":
        return "Tests passed"
      case "TESTS_FAILED":
        return "Tests failed"
      case "COMPILE_FAILED":
        return "Compilation failed"
      case "TESTRUN_INTERRUPTED":
        return "The test run was interrupted"
      case "GENERIC_ERROR":
        return "An error occurred during the test run"
      default:
        return assertUnreachable(status)
    }
  }

  // svelte-ignore state_referenced_locally -- the panel identity (id/type)
  // is fixed for the lifetime of the component, capturing the initial value is intended
  addMessageListener(panel, (message) => {
    switch (message.type) {
      case "testResults": {
        testResults = message.testResults
        const { status, testResults: run } = message.testResults.testResult
        const passed = run.filter((tr) => tr.successful).length
        announce(
          run.length > 0
            ? `${statusHeadline(status)}. ${passed} of ${run.length} tests passed.`
            : statusHeadline(status),
        )
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
  function copyToClipboard(text: string) {
    vscode.postMessage({ type: "copyToClipboard", text })
  }
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

<PanelHeader title={exercise.name} shouldFocusOnMount={false}>
  {#snippet actions()}
    <ToolbarButton icon="close" label="Close" onclick={closePanel} />
  {/snippet}
</PanelHeader>

{#if !tryingToRunTestsForExam && !testError}
  {#if testResults === undefined}
    <h2>Running tests</h2>
    <Spinner label="Running tests" isLabelHidden />
    <div class="actions">
      <Button secondary onclick={closePanel}>Run in background</Button>
      <Button secondary onclick={cancelTests}>Cancel</Button>
    </div>
  {:else}
    <h2>{statusHeadline(testResults.testResult.status)}</h2>
    {#if validationsFailed}
      <h2>Code quality checks failed</h2>
    {/if}
    {#if testResults.styleValidationError}
      <Notice kind="warning" title="Code quality checks could not be run">
        {testResults.styleValidationError}
      </Notice>
    {/if}

    {#if course.disabled}
      <p>
        Sending the solution or pasting to the server is not available for this exercise, because
        the course is disabled.
      </p>
    {:else}
      <div class="actions">
        <Button onclick={submit} disabled={submitting}>Submit to server</Button>
      </div>
      {#if !allSuccessful}
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
      {/if}
    {/if}
    <TestResults
      testResults={results}
      {points}
      validationResult={testResults.styleValidationResult ?? null}
      solutionUrl={null}
      oncopy={copyToClipboard}
    />
    {#if stdout || stderr}
      <Disclosure title="Output" open={isOutputOpenInitially}>
        {#if stdout}
          <CodeBlock code={stdout} label="Standard output" oncopy={copyToClipboard} />
        {/if}
        {#if stderr}
          <CodeBlock code={stderr} label="Standard error" oncopy={copyToClipboard} />
        {/if}
      </Disclosure>
    {/if}
  {/if}
{:else}
  {#if testError}
    <Notice kind="error" title="Error while trying to run tests">
      <p>{testError.message}</p>
      {#if testError.details}
        <CodeBlock code={testError.details} label="Error details" oncopy={copyToClipboard} />
      {/if}
    </Notice>
    <p>
      The tests could not be run locally. You can still submit your answer to the server, or close
      this panel and try again.
    </p>
  {:else}
    <p>You can submit your answer with the button below.</p>
  {/if}
  <div class="actions">
    <Button onclick={submit} disabled={submitting}>Submit to server</Button>
  </div>
{/if}

<style>
  .actions {
    margin: var(--tmc-space-3) 0;
  }
</style>
