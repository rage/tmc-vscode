<script lang="ts">
    // "Need help?" button that can be expanded for a prompt to submit to paste

    import { writable } from "svelte/store";
    import { vscode } from "../utilities/vscode";
    import {
        ExerciseSubmissionPanel,
        ExerciseTestsPanel,
        TargetPanel,
        TestCourse,
        TestExercise,
    } from "../shared/shared";

    export let hidden: boolean;
    export let course: TestCourse;
    export let exercise: TestExercise;
    export let sourcePanel: TargetPanel<ExerciseTestsPanel | ExerciseSubmissionPanel>;
    export let pasteUrl: string | undefined = undefined;
    export let pasteError: string | undefined = undefined;

    const pasting = writable<boolean>(false);
    const showHelp = writable<boolean>(false);

    function toggleShowHelp() {
        showHelp.update((val) => {
            return !val;
        });
    }
    function paste() {
        pasteUrl = undefined;
        pasteError = undefined;
        pasting.set(true);
        vscode.postMessage({
            type: "pasteExercise",
            course: course,
            exercise: exercise,
            requestingPanel: sourcePanel,
        });
    }
</script>

<vscode-button
    {hidden}
    appearance="secondary"
    on:click={toggleShowHelp}
    on:keypress={toggleShowHelp}
    enabled={false}
>
    Need help?
</vscode-button>
<div class="help" hidden={!$showHelp}>
    <h2>Submit to TMC Paste</h2>
    <div>
        You can submit your code to TMC Paste and share the link to the course discussion channel
        and ask for help.
    </div>
    <div class="paste-button-container">
        <vscode-button on:click={paste} on:keypress={paste}> Submit to TMC Paste </vscode-button>
    </div>
    {#if pasteUrl !== undefined}
        <div>
            Paste available at <a href={pasteUrl}>{pasteUrl}</a>
        </div>
    {/if}
    {#if pasteError !== undefined}
        <div>
            Failed to submit to TMC Paste: {pasteError}
        </div>
    {/if}
    {#if $pasting && pasteUrl === undefined && pasteError === undefined}
        <div>Sending to TMC Paste...</div>
        <vscode-progress-ring />
    {/if}
</div>

<style>
    .help {
        border: 1px solid;
        padding: 0.4rem;
        margin: 0.4rem;
    }
    .paste-button-container {
        margin-top: 0.4rem;
        margin-bottom: 0.4rem;
    }
</style>
