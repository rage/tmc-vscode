<script lang="ts">
    import { derived } from "svelte/store";
    import { ExerciseTestsPanel, TestResultData, assertUnreachable } from "../shared/shared";
    import { addMessageListener, loadable } from "../utilities/script";
    import { vscode } from "../utilities/vscode";
    import PasteHelpBox from "../components/PasteHelpBox.svelte";
    import TestResults from "../components/TestResults.svelte";
    import { onMount } from "svelte";

    export let panel: ExerciseTestsPanel;

    const testError = loadable<Error>();
    const pasteResult = loadable<string>();
    const pasteError = loadable<string>();
    const testResults = loadable<TestResultData>();
    const tryingToRunTestsForExam = loadable<boolean>();

    const successPoints = derived(testResults, ($testResults) => {
        return ($testResults?.testResult.testResults ?? [])
            .filter((tr) => tr.successful)
            .map((tr) => tr.points.length)
            .reduce((prev, curr) => prev + curr, 0);
    });
    const totalPoints = derived(testResults, ($testResults) => {
        return ($testResults?.testResult.testResults ?? [])
            .map((tr) => tr.points.length)
            .reduce((prev, curr) => prev + curr, 0);
    });
    const allSuccessful = derived(testResults, ($testResults) => {
        return (
            $testResults &&
            $testResults.testResult.testResults.find((tr) => !tr.successful) === undefined
        );
    });

    onMount(() => {
        vscode.postMessage({
            type: "requestExerciseTestsData",
            sourcePanel: panel,
        });
    });
    addMessageListener(panel, (message) => {
        switch (message.type) {
            case "testResults": {
                testResults.set(message.testResults);
                const allSuccessful =
                    message.testResults.testResult.testResults.find((tr) => !tr.successful) ===
                    undefined;
                break;
            }
            case "pasteResult": {
                pasteResult.set(message.pasteLink);
                break;
            }
            case "pasteError": {
                pasteError.set(message.error);
                break;
            }
            case "testError": {
                testError.set(message.error);
                break;
            }
            case "willNotRunTestsForExam": {
                tryingToRunTestsForExam.set(true);
                break;
            }
            default:
                assertUnreachable(message);
        }
    });

    function closePanel() {
        vscode.postMessage({ type: "closeSidePanel" });
    }
    function cancelTests() {
        vscode.postMessage({ type: "cancelTests", testRunId: panel.testRunId });
        vscode.postMessage({
            type: "closeSidePanel",
        });
    }
    function submit() {
        vscode.postMessage({
            type: "submitExercise",
            course: panel.course,
            exercise: panel.exercise,
            exerciseUri: panel.exerciseUri,
        });
    }
</script>

{#if !$tryingToRunTestsForExam}
    {#if $testResults === undefined}
        <h1>{panel.exercise.name}: Running tests</h1>
    {:else if $testResults.testResult.status === "PASSED"}
        <h1>{panel.exercise.name}: Tests passed</h1>
    {:else if $testResults.testResult.status === "TESTS_FAILED"}
        <h1>{panel.exercise.name}: Tests failed</h1>
    {:else if $testResults.testResult.status === "COMPILE_FAILED"}
        <h1>{panel.exercise.name}: Compilation failed</h1>
    {:else if $testResults.testResult.status === "TESTRUN_INTERRUPTED"}
        <h1>{panel.exercise.name}: The test run was interrupted</h1>
    {:else if $testResults.testResult.status === "GENERIC_ERROR"}
        <h1>{panel.exercise.name}: An error occurred during the test run</h1>
    {:else}
        {assertUnreachable($testResults.testResult.status)}
    {/if}

    <vscode-button
        role="button"
        tabindex="0"
        class="close-button"
        appearance="secondary"
        on:click={closePanel}
        on:keypress={closePanel}
    >
        ×
    </vscode-button>

    {#if $testResults === undefined}
        <div class="button-container">
            <vscode-button
                role="button"
                tabindex="0"
                appearance="secondary"
                on:click={closePanel}
                on:keypress={closePanel}
            >
                Run in background
            </vscode-button>
            <vscode-button
                role="button"
                tabindex="0"
                appearance="secondary"
                on:click={cancelTests}
                on:keypress={cancelTests}
            >
                Cancel
            </vscode-button>
        </div>
        <vscode-progress-ring />
    {:else}
        {#if panel.course.disabled}
            <div>
                Sending the solution or pasting to the TMC server is not available for this
                exercise, because the course is disabled.
            </div>
        {:else}
            <div class="header-container">
                <vscode-button role="button" tabindex="0" on:click={submit} on:keypress={submit}>
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
            solutionUrl={null}
        />
    {/if}
{:else}
    <h1>{panel.course.title}: {panel.exercise.name}</h1>
    <div>You can submit your answer with the button below.</div>
    <div class="exam-submission-button-container">
        <vscode-button role="button" tabindex="0" on:click={submit} on:keypress={submit}>
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
</style>
