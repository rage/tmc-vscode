<script lang="ts">
    import { writable } from "svelte/store";
    import { ExerciseGroup, ExerciseStatus } from "../shared/shared";
    import Checkbox from "./Checkbox.svelte";
    import Card from "./Card.svelte";

    export let exerciseGroup: ExerciseGroup;
    export let onDownloadAll: (exerciseIds: Array<number>) => void;
    export let onOpenAll: (exerciseIds: Array<number>) => void;
    export let onCloseAll: (exerciseIds: Array<number>) => void;
    export let checkedExercises: Record<number, boolean>;
    export let exerciseStatuses: Record<number, ExerciseStatus>;

    const expanded = writable<boolean>(false);

    const completedExercises = exerciseGroup.exercises.filter((e) => e.passed).length;
    const downloadedExercises = exerciseGroup.exercises.filter((e) => {
        const status = exerciseStatuses[e.id];
        return status === "opened" || status === "closed";
    }).length;
    const openedExercises = exerciseGroup.exercises.filter(
        (e) => exerciseStatuses[e.id] === "opened",
    ).length;
    const totalExercises = exerciseGroup.exercises.length;

    function getHardDeadlineInformation(deadline: string) {
        return (
            "This is a soft deadline and it can be exceeded." +
            "&#013Exercises can be submitted after the soft deadline has passed, " +
            "but you receive only 75% of the exercise points." +
            `&#013;Hard deadline for this exercise is: ${deadline}.` +
            "&#013;Hard deadline can not be exceeded."
        );
    }
    function allExercisesAreChecked(checkedExercises: Record<number, boolean>) {
        for (const exercise of exerciseGroup.exercises) {
            if (!checkedExercises[exercise.id]) {
                return false;
            }
        }
        return true;
    }
    function checkAllExercises(checked: boolean) {
        for (const exercise of exerciseGroup.exercises) {
            checkedExercises[exercise.id] = checked;
        }
    }
</script>

<Card>
    <div class="part-header">
        <h2 class="part-title">
            {exerciseGroup.name}
        </h2>
        <div class="part-buttons">
            <vscode-button
                class="part-button"
                appearance="secondary"
                on:click={() => onDownloadAll(exerciseGroup.exercises.map((e) => e.id))}
                on:keypress={() => onDownloadAll(exerciseGroup.exercises.map((e) => e.id))}
            >
                Download all
            </vscode-button>
            <vscode-button
                class="part-button"
                appearance="secondary"
                on:click={() => onOpenAll(exerciseGroup.exercises.map((e) => e.id))}
                on:keypress={() => onOpenAll(exerciseGroup.exercises.map((e) => e.id))}
            >
                Open all
            </vscode-button>
            <vscode-button
                class="part-button"
                appearance="secondary"
                on:click={() => onCloseAll(exerciseGroup.exercises.map((e) => e.id))}
                on:keypress={() => onCloseAll(exerciseGroup.exercises.map((e) => e.id))}
            >
                Close all
            </vscode-button>
        </div>
    </div>
    <div>
        <div>
            Completed: {completedExercises} / {totalExercises}
        </div>
        <div>
            Downloaded: {downloadedExercises} / {totalExercises}
        </div>
        <div>
            Opened: {openedExercises} / {totalExercises}
        </div>
    </div>
    <br />
    <div>{exerciseGroup.nextDeadlineString}</div>
    <div class="show-exercises-container">
        <vscode-button
            on:click={() => expanded.update((e) => !e)}
            on:keypress={() => expanded.update((e) => !e)}
            appearance="secondary"
        >
            {#if $expanded}
                Hide exercises
            {:else}
                Show exercises
            {/if}
        </vscode-button>
    </div>
    <div>
        <div hidden={!$expanded}>
            <vscode-divider />
            <div>
                <table class="exercise-table">
                    <thead>
                        <tr>
                            <th class="exercise-table-header checkbox-header">
                                <Checkbox
                                    checked={allExercisesAreChecked(checkedExercises)}
                                    onClick={(checked) => {
                                        checkAllExercises(checked);
                                    }}
                                />
                            </th>
                            <th class="exercise-table-header">Exercise</th>
                            <th class="exercise-table-header deadline-header">Deadline</th>
                            <th class="exercise-table-header completed-header">Completed</th>
                            <th class="exercise-table-header status-header">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {#each exerciseGroup.exercises as exercise}
                            <tr id={exercise.id.toString()} class="exercise-row">
                                <td class="exercise-table-cell">
                                    <Checkbox bind:checked={checkedExercises[exercise.id]} />
                                </td>
                                <td class="exercise-table-cell"> {exercise.name}</td>
                                <td class="exercise-table-cell">
                                    {#if exercise.isHard}
                                        {exercise.hardDeadlineString}
                                    {:else}
                                        <div>
                                            {exercise.softDeadlineString}
                                            <span
                                                title={getHardDeadlineInformation(
                                                    exercise.hardDeadlineString,
                                                )}
                                            >
                                                ⓘ
                                            </span>
                                            <span class="codicon codicon-add" />
                                        </div>
                                    {/if}
                                </td>
                                {#if exercise.passed}
                                    <td class="success-icon exercise-table-cell"> ✔ </td>
                                {:else}
                                    <td class="cross-icon exercise-table-cell"> ❌ </td>
                                {/if}
                                <td class="exercise-table-cell">
                                    <vscode-tag>
                                        {exerciseStatuses[exercise.id] ?? "Loading..."}
                                    </vscode-tag>
                                </td>
                            </tr>
                        {/each}
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</Card>

<style>
    .part-header {
        display: flex;
        flex-direction: column;
        text-transform: capitalize;
    }
    .part-title {
        flex-grow: 1;
    }
    .part-buttons {
        display: flex;
        align-items: center;
        flex-direction: column;
    }
    .part-button {
        margin: 0.4rem;
        width: 90%;
        box-sizing: border-box;
    }
    .show-exercises-container {
        padding: 0.4rem;
        display: flex;
        justify-content: center;
    }
    .success-icon {
        font-size: 1.3rem;
    }
    .cross-icon {
        font-size: 0.7rem;
    }
    .exercise-row:nth-child(odd) {
        background-color: var(--vscode-editor-background, #1f1f1f);
        border-radius: 0.4rem;
        overflow: hidden;
    }
    .exercise-table-header {
        padding: 0.8rem;
        overflow: hidden;
        text-align: left;
    }
    .exercise-table-cell {
        padding: 0.8rem;
        word-wrap: break-word;
        overflow: hidden;
    }
    .exercise-table {
        width: 100%;
        table-layout: fixed;
        border-collapse: collapse;
    }
    .checkbox-header {
        width: 1rem;
    }
    .deadline-header {
        width: 20%;
    }
    .completed-header {
        width: 4rem;
    }
    .status-header {
        width: 4rem;
    }

    @media (min-width: 30rem) {
        .part-header {
            flex-direction: row;
        }
        .part-buttons {
            flex-direction: row;
        }
        .part-button {
            width: auto;
        }
        .exercise-table {
            border-collapse: collapse;
        }
    }
</style>
