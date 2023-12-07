<script lang="ts">
    import { writable } from "svelte/store";
    import { ExerciseSubmissionPanel, FeedbackQuestion, assertUnreachable } from "../shared/shared";
    import { addMessageListener, loadable } from "../utilities/script";
    import { vscode } from "../utilities/vscode";
    import { SubmissionFinished } from "../shared/langsSchema";
    import PasteHelpBox from "../components/PasteHelpBox.svelte";
    import TestResults from "../components/TestResults.svelte";
    import { onMount } from "svelte";

    export let panel: ExerciseSubmissionPanel;

    const submissionStatusUrl = loadable<string>();
    const progressPercent = writable<number>(0);
    const progressMessages = writable<Array<string>>([]);
    const submissionError = loadable<Error>();
    const submissionResult = loadable<SubmissionFinished>();
    const feedbackQuestions = loadable<Array<FeedbackQuestion>>();
    const pasteResult = loadable<string>();
    const pasteError = loadable<string>();

    onMount(() => {
        vscode.postMessage({
            type: "requestExerciseSubmissionData",
            sourcePanel: panel,
        });
    });
    addMessageListener(panel, (message) => {
        switch (message.type) {
            case "submissionStatusUrl": {
                submissionStatusUrl.set(message.url);
                break;
            }
            case "submissionStatusUpdate": {
                progressPercent.set(message.progressPercent);
                progressMessages.update((ms) => {
                    if (message.message !== undefined) {
                        ms.push(message.message);
                    }
                    return ms;
                });
                break;
            }
            case "submissionStatusError": {
                submissionError.set(message.error);
                break;
            }
            case "submissionResult": {
                submissionResult.set(message.result);
                feedbackQuestions.set(message.questions);
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
            default: {
                assertUnreachable(message);
            }
        }
    });

    function runInBackground() {
        vscode.postMessage({ type: "closeSidePanel" });
    }
    function showInBrowser(submissionUrl: string) {
        vscode.postMessage({
            type: "openLinkInBrowser",
            url: submissionUrl,
        });
    }
    function closePanel() {
        vscode.postMessage({ type: "closeSidePanel" });
    }
</script>

{#if $submissionResult === undefined}
    <h1>Processing submission...</h1>
{:else if $submissionResult.status === "ok"}
    {#if $submissionResult.all_tests_passed}
        <h1>All tests passed on the server</h1>
    {:else}
        <h1>Some tests failed on the server</h1>
    {/if}
{:else if $submissionResult.status === "hidden"}
    <h1>Processing the submission finished</h1>
{:else}
    <h1>Something went wrong</h1>
{/if}

<vscode-button
    class="close-button"
    appearance="secondary"
    on:click={closePanel}
    on:keypress={closePanel}
>
    ×
</vscode-button>

{#if $submissionResult && !$submissionResult.all_tests_passed}
    <div class="help-box-container">
        <PasteHelpBox
            hidden={false}
            course={panel.course}
            exercise={panel.exercise}
            sourcePanel={panel}
            pasteUrl={$pasteResult}
            pasteError={$pasteError}
        />
    </div>
{/if}

{#if $submissionResult === undefined}
    <div>
        <vscode-button
            appearance="secondary"
            on:click={runInBackground}
            on:keypress={runInBackground}
        >
            Run in background
        </vscode-button>
        <vscode-button
            appearance="secondary"
            on:click={() => $submissionStatusUrl && showInBrowser($submissionStatusUrl)}
            on:keypress={() => $submissionStatusUrl && showInBrowser($submissionStatusUrl)}
            enabled={$submissionStatusUrl !== undefined}
        >
            Show submission in browser
        </vscode-button>
    </div>

    <div>
        <progress value={$progressPercent} max={100} />
    </div>

    <div>
        {#each $progressMessages as message, idx}
            {#if idx < $progressMessages.length - 1}
                <div>✓ {message}</div>
            {:else}
                <div>{message}</div>
                <vscode-progress-ring />
            {/if}
        {/each}
    </div>
{:else}
    <TestResults
        totalPoints={panel.exercise.availablePoints}
        successPoints={$submissionResult.points.length}
        testResults={$submissionResult.test_cases ?? []}
    />
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
</style>
