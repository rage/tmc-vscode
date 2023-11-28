<script lang="ts">
    import { derived, writable } from "svelte/store";
    import { TestCase, TestResult } from "../shared/langsSchema";
    import Checkbox from "./Checkbox.svelte";

    export let totalPoints: number;
    export let successPoints: number;
    export let testResults: Array<TestResult | TestCase>;

    const allTestsFailed = testResults.find((tr) => tr.successful) === undefined;
    const allTestsPassed = testResults.find((tr) => !tr.successful) === undefined;
    // if all tests failed or passed, no need to show the checkbox
    const alwaysShowPassedTests = allTestsFailed || allTestsPassed;

    const showPassedTestsChecked = writable<boolean>(false);
    const showPassedTests = derived(showPassedTestsChecked, ($showPassedTestsChecked) => {
        return alwaysShowPassedTests || $showPassedTestsChecked;
    });

    const pointsPercent =
        totalPoints > 0 ? ((successPoints / totalPoints) * 100.0).toFixed(2) : 0.0;
</script>

<div>
    <label>
        Points: {pointsPercent}%
        <meter min={0} value={successPoints} max={totalPoints} />
    </label>
</div>
<div>
    <Checkbox hidden={alwaysShowPassedTests} bind:checked={$showPassedTestsChecked}>
        Show passed tests
    </Checkbox>
</div>

{#each testResults as testResult}
    {#if testResult.successful}
        <div class="test passed-container" hidden={!$showPassedTests}>
            <h2 class="passed">PASS:</h2>
            <h3>{testResult.name}</h3>
        </div>
    {:else}
        <div class="test failed-container">
            <h2 class="failed">FAIL:</h2>
            <h3>{testResult.name}</h3>
            <pre class="test-message">{testResult.message}</pre>
        </div>
    {/if}
{/each}

<style>
    .test {
        border: 1px dashed;
        border-left: 0.4rem solid;
        padding: 0.4rem;
        margin: 0.4rem;
    }
    .passed {
        color: var(--vscode-notebookStatusSuccessIcon-foreground);
    }
    .passed-container {
        border-color: var(--vscode-notebookStatusSuccessIcon-foreground);
    }
    .failed {
        color: var(--vscode-notebookStatusErrorIcon-foreground);
    }
    .failed-container {
        border-color: var(--vscode-notebookStatusErrorIcon-foreground);
    }
    .test-message {
        white-space: break-spaces;
    }
</style>
