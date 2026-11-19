<script lang="ts">
  import type { TestCase, TmcStyleValidationResult } from "../../../shared/langsSchema"
  import { withDistinctKeys } from "../../../shared/lib"
  import { uiState } from "../utilities/uiState.svelte"
  import Checkbox from "./Checkbox.svelte"
  import CodeBlock from "./CodeBlock.svelte"
  import Disclosure from "./Disclosure.svelte"
  import Section from "./Section.svelte"
  import StatusIcon from "./StatusIcon.svelte"

  interface Props {
    testCases: TestCase[]
    validations: TmcStyleValidationResult | undefined
    /** Copies a code block's text through the host. */
    oncopy?: ((text: string) => void) | undefined
  }

  /** A test run's results: failures first and open, passed tests on request, then code quality. */
  let { testCases, validations, oncopy }: Props = $props()

  const validationStrategy = $derived(validations?.strategy ?? "DISABLED")
  const validationErrorsEntries = $derived(Object.entries(validations?.validationErrors ?? {}))

  const passedCount = $derived(testCases.filter((tr) => tr.successful).length)
  // With every test passed, or none, there is nothing to filter.
  const isMixed = $derived(passedCount > 0 && passedCount < testCases.length)

  const showPassedTestsChecked = uiState("showPassedTests", false)
  const showPassedTests = $derived(!isMixed || showPassedTestsChecked.current)

  // Test names are not guaranteed unique, and a duplicate `{#each}` key throws.
  const rows = $derived(
    withDistinctKeys(testCases, (result) => result.name).toSorted(
      (a, b) => Number(a.item.successful) - Number(b.item.successful),
    ),
  )
</script>

{#if testCases.length > 0}
  <Section title="Tests">
    {#snippet actions()}
      <span class="muted">{passedCount} of {testCases.length} tests passed</span>
    {/snippet}
    {#if isMixed}
      <Checkbox
        checked={showPassedTestsChecked.current}
        oncheckedchange={(checked) => (showPassedTestsChecked.current = checked)}
      >
        Show passed tests
      </Checkbox>
    {/if}
    <ul class="results">
      {#each rows as { key, item: result } (key)}
        <li class:passed={result.successful} hidden={result.successful && !showPassedTests}>
          <h3 class="result-name">
            <StatusIcon
              status={result.successful ? "passed" : "failed"}
              label={result.successful ? "Passed" : "Failed"}
            />
            <span class="name">{result.name}</span>
          </h3>
          {#if !result.successful}
            <div class="failure">
              {#if result.message}
                <CodeBlock code={result.message} />
              {/if}
              {#if result.detailed_message}
                <CodeBlock code={result.detailed_message} label="Details" {oncopy} />
              {/if}
              {#if result.exception && result.exception.length > 0}
                <Disclosure title="Stack trace" headingLevel={4} persistAs="stackTrace:{key}">
                  <CodeBlock code={result.exception.join("\n")} label="Stack trace" {oncopy} />
                </Disclosure>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  </Section>
{/if}

{#if validationErrorsEntries.length > 0}
  <Section
    title={validationStrategy === "FAIL"
      ? "Code quality errors found"
      : "Code quality warnings found"}
  >
    <ul class="results">
      {#each validationErrorsEntries as [path, errors] (path)}
        <li>
          <h3 class="result-name">
            <StatusIcon
              status={validationStrategy === "FAIL" ? "failed" : "warning"}
              label={validationStrategy === "FAIL" ? "Error" : "Warning"}
            />
            <span class="name">{path}</span>
          </h3>
          <ul class="validation-errors failure">
            {#each errors as error, index (index)}
              <li>Line {error.line}, column {error.column}: {error.message}</li>
            {/each}
          </ul>
        </li>
      {/each}
    </ul>
  </Section>
{/if}

<style>
  .results,
  .validation-errors {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .results > li:not(.passed) {
    margin-bottom: var(--tmc-space-3);
  }
  .result-name {
    display: flex;
    align-items: center;
    gap: var(--tmc-space-2);
    min-height: var(--tmc-list-row-height);
    margin: 0;
  }
  .passed .result-name {
    font-weight: normal;
  }
  .name {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  /* Indented under the name, past the 16px status icon and its gap. */
  .failure {
    margin-left: calc(16px + var(--tmc-space-2));
  }
  .validation-errors {
    font-family: var(--tmc-font-mono);
    font-size: var(--tmc-font-size-mono);
  }
</style>
