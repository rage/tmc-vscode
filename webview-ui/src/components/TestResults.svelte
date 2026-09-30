<script lang="ts">
  import { StyleValidationStrategy, TestCase, TestResult } from "../shared/langsSchema"
  import Checkbox from "./Checkbox.svelte"
  import CodeBlock from "./CodeBlock.svelte"
  import Disclosure from "./Disclosure.svelte"
  import StatusIcon from "./StatusIcon.svelte"

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
    testResults: Array<TestResult | TestCase>
    validationResult: ValidationResult | null
    /** Copies a code block's text through the host. */
    oncopy?: ((text: string) => void) | undefined
  }

  let { testResults, validationResult, oncopy }: Props = $props()

  const validationStrategy: StyleValidationStrategy = $derived(
    validationResult?.strategy ?? "DISABLED",
  )
  const validationErrorsEntries = $derived(
    Object.entries(validationResult?.validation_errors ?? {}),
  )
  // validations pass if strategy is not set to fail, or if there are no validation errors
  const validationsPassed = $derived(
    validationStrategy !== "FAIL" || validationErrorsEntries.length === 0,
  )

  const passedCount = $derived(testResults.filter((tr) => tr.successful).length)
  const allTestsFailed = $derived(passedCount === 0)
  const allTestsPassed = $derived(passedCount === testResults.length)
  const exercisePassed = $derived(allTestsPassed && validationsPassed)
  // if all tests failed or passed, no need to show the checkbox
  const alwaysShowPassedTests = $derived(allTestsFailed || exercisePassed)

  let showPassedTestsChecked = $state(false)
  const showPassedTests = $derived(alwaysShowPassedTests || showPassedTestsChecked)

  // Test names are not guaranteed unique, and a duplicate `{#each}` key throws.
  const rows = $derived.by(() => {
    const seen = new Map<string, number>()
    return testResults.map((result) => {
      const occurrence = seen.get(result.name) ?? 0
      seen.set(result.name, occurrence + 1)
      return { key: occurrence === 0 ? result.name : `${result.name}#${occurrence}`, result }
    })
  })

  function detailedMessage(result: TestResult | TestCase): string | null {
    return "detailed_message" in result ? result.detailed_message : null
  }
</script>

{#if testResults.length > 0}
  <p>{passedCount} of {testResults.length} tests passed</p>
{/if}
{#if validationErrorsEntries.length > 0}
  <h2>
    {validationStrategy === "FAIL" ? "Code quality errors found" : "Code quality warnings found"}
  </h2>
  <ul class="results">
    {#each validationErrorsEntries as [path, errors] (path)}
      <li>
        <h3 class="result-name">
          <StatusIcon
            status={validationStrategy === "FAIL" ? "failed" : "warning"}
            label={validationStrategy === "FAIL" ? "Error" : "Warning"}
            isLabelHidden
          />
          {path}
        </h3>
        <ul class="validation-errors">
          {#each errors as error, index (index)}
            <li>Line {error.line}, column {error.column}: {error.message}</li>
          {/each}
        </ul>
      </li>
    {/each}
  </ul>
{/if}

{#if testResults.length > 0}
  <h2>Tests</h2>
  <Checkbox
    hidden={alwaysShowPassedTests}
    checked={showPassedTestsChecked}
    oncheckedchange={(checked) => (showPassedTestsChecked = checked)}
  >
    Show passed tests
  </Checkbox>
  <ul class="results">
    {#each rows as { key, result } (key)}
      <li hidden={result.successful && !showPassedTests}>
        <h3 class="result-name">
          <StatusIcon
            status={result.successful ? "passed" : "failed"}
            label={result.successful ? "Passed" : "Failed"}
            isLabelHidden
          />
          {result.name}
        </h3>
        {#if !result.successful}
          {#if result.message}
            <CodeBlock code={result.message} />
          {/if}
          {@const details = detailedMessage(result)}
          {#if details}
            <CodeBlock code={details} label="Details" {oncopy} />
          {/if}
          {#if result.exception && result.exception.length > 0}
            <Disclosure title="Stack trace" headingLevel={4}>
              <CodeBlock code={result.exception.join("\n")} label="Stack trace" {oncopy} />
            </Disclosure>
          {/if}
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .results,
  .validation-errors {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .results > li {
    margin-bottom: var(--tmc-space-3);
  }
  .result-name {
    display: flex;
    align-items: center;
    gap: var(--tmc-space-1);
    margin-bottom: var(--tmc-space-1);
  }
  .validation-errors {
    font-family: var(--tmc-font-mono);
    font-size: var(--tmc-font-size-mono);
  }
</style>
