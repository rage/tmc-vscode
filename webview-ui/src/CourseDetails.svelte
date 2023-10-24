<script lang="ts">
    import { derived, writable } from "svelte/store";
    import {
        CourseData,
        CourseDetailsPanel,
        ExerciseGroup,
        ExerciseStatus,
        assertUnreachable,
    } from "./shared";
    import { vscode } from "./utilities/vscode";
    import { addExtensionMessageListener, loadable } from "./utilities/script";

    export let panel: CourseDetailsPanel;

    const course = loadable<CourseData>();
    const offlineMode = loadable<boolean>();
    const exerciseGroups = loadable<Array<ExerciseGroup>>();
    const updateableExercises = loadable<Array<number>>();
    const disabled = loadable<boolean>();
    const exerciseStatuses = writable<Map<number, ExerciseStatus>>(new Map());

    addExtensionMessageListener(panel, (message) => {
        switch (message.type) {
            case "setCourseData": {
                course.set(message.courseData);
                disabled.update((d) => {
                    if (d === undefined) {
                        return message.courseData.disabled;
                    } else {
                        return d;
                    }
                });
                break;
            }
            case "setCourseGroups": {
                offlineMode.set(message.offlineMode);
                exerciseGroups.set(message.exerciseGroups);
                break;
            }
            case "setCourseDisabledStatus": {
                if (message.courseId === panel.courseId) {
                    disabled.set(message.disabled);
                }
                break;
            }
            case "exerciseStatusChange": {
                exerciseStatuses.update((es) => {
                    es.set(message.exerciseId, message.status);
                    return es;
                });
                break;
            }
            case "setUpdateables": {
                updateableExercises.set(message.exerciseIds);
                break;
            }
            case "setCourseDisabledStatus": {
                disabled.set(message.disabled);
                break;
            }
            case "exerciseStatusChange": {
                exerciseStatuses.update((s) => {
                    s.set(message.exerciseId, message.status);
                    return s;
                });
                break;
            }
            case "setCourseGroups": {
                exerciseGroups.set(message.exerciseGroups);
                break;
            }
            default:
                assertUnreachable(message);
        }
    });

    const totalDownloading = writable<number>(0);
    const refreshing = writable<boolean>(false);
    const expandedParts = writable<Record<string, boolean>>({});
    const checkedExercises = writable<Record<number, boolean>>({});
    const checkedExercisesCount = writable<number>(0);
    const pointsGained = derived(course, ($course) => {
        return $course ? `${$course.awardedPoints} / ${$course.availablePoints}` : undefined;
    });

    const getHardDeadlineInformation = (deadline: string) =>
        "This is a soft deadline and it can be exceeded." +
        "&#013Exercises can be submitted after the soft deadline has passed, " +
        "but you receive only 75% of the exercise points." +
        `&#013;Hard deadline for this exercise is: ${deadline}.` +
        "&#013;Hard deadline can not be exceeded.";

    function openMyCourses() {
        vscode.postMessage({
            type: "openMyCourses",
        });
    }

    function refresh(id: number) {
        refreshing.set(true);
        vscode.postMessage({
            type: "refreshCourseDetails",
            id,
            useCache: false,
        });
    }

    function openWorkspace(courseName: string) {
        vscode.postMessage({
            type: "openCourseWorkspace",
            courseName,
        });
    }

    function openExercises(courseName: string, ids: Array<number>) {
        vscode.postMessage({
            type: "openSelected",
            ids,
            courseName,
        });
    }

    function closeExercises(courseName: string, ids: Array<number>) {
        vscode.postMessage({
            type: "closeSelected",
            ids,
            courseName,
        });
    }

    function clearSelectedExercises() {
        checkedExercises.set({});
        checkedExercisesCount.set(0);
    }

    function updateExercises(course: CourseData) {
        vscode.postMessage({
            type: "downloadExercises",
            ids: $updateableExercises ?? [],
            courseName: course.name,
            organizationSlug: course.organization,
            courseId: course.id,
            mode: "update",
        });
    }

    const getCheckedExercises = (): Array<number> => {
        return Object.entries($checkedExercises)
            .filter(([_, v]) => v)
            .map(([k, _]) => Number(k));
    };
</script>

<nav>
    <a
        id="back-to-my-courses"
        role="button"
        tabindex="0"
        on:click={() => openMyCourses()}
        on:keypress={() => openMyCourses()}
    >
        My Courses
    </a>
    /
    {$course?.title ?? "loading course..."}
</nav>
<div class="header">
    <h2>{$course?.title ?? "loading course..."}</h2>

    <div>
        {$course?.description ?? "loading course..."}
    </div>

    <div>
        <vscode-button
            class="refresh"
            aria-label="Refresh"
            on:click={() => $course !== undefined && refresh($course.id)}
            on:keypress={() => $course !== undefined && refresh($course.id)}
            disabled={$refreshing || $totalDownloading > 0}
            appearance="secondary"
        >
            {#if $refreshing}
                Refreshing
            {:else}
                Refresh
            {/if}
        </vscode-button>
    </div>

    <div>
        Points gained: {$pointsGained ?? "loading points..."}
    </div>

    {#if $course?.materialUrl}
        <div>
            Material: <a href={$course.materialUrl}>{$course.materialUrl}</a>
        </div>
    {/if}

    <div>
        <vscode-button
            aria-label="Open workspace"
            on:click={() => $course !== undefined && openWorkspace($course.name)}
            on:keypress={() => $course !== undefined && openWorkspace($course.name)}
        >
            Open workspace
        </vscode-button>
    </div>
</div>

<div>
    <div
        role="alert"
        hidden={$updateableExercises === undefined || $updateableExercises.length > 0}
    >
        Updates found for exercises
        <vscode-button
            on:click={() => $course !== undefined && updateExercises($course)}
            on:keypress={() => $course !== undefined && updateExercises($course)}
        >
            Update exercises
        </vscode-button>
    </div>
    {#if $offlineMode}
        <div role="alert">
            Unable to fetch exercise data from server. Displaying local exercises.
        </div>
    {/if}
    {#if $course?.perhapsExamMode}
        <div role="alert">This is an exam. Exercise submission results will not be shown.</div>
    {/if}
    {#if $disabled}
        <div role="alert">
            This course has been disabled. Exercises cannot be downloaded or submitted.
        </div>
    {/if}
</div>

{#if $exerciseGroups !== undefined}
    {#each $exerciseGroups as exerciseGroup}
        <div class="part">
            <div class="part-header">
                <h2 class="part-title">
                    {exerciseGroup.name}
                </h2>
                <div class="part-buttons">
                    <vscode-button class="part-button" appearance="secondary">
                        Download ({exerciseGroup.exercises.filter((e) => {
                            const status = $exerciseStatuses.get(e.id);
                            return status !== "opened" && status !== "closed";
                        }).length})
                    </vscode-button>
                    <vscode-button
                        class="part-button"
                        on:click={() =>
                            $course !== undefined &&
                            openExercises(
                                $course.name,
                                exerciseGroup.exercises.map((e) => e.id),
                            )}
                        on:keypress={() =>
                            $course !== undefined &&
                            openExercises(
                                $course.name,
                                exerciseGroup.exercises.map((e) => e.id),
                            )}
                        appearance="secondary"
                    >
                        Open all
                    </vscode-button>
                    <vscode-button
                        class="part-button"
                        on:click={() =>
                            $course !== undefined &&
                            closeExercises(
                                $course.name,
                                exerciseGroup.exercises.map((e) => e.id),
                            )}
                        on:keypress={() =>
                            $course !== undefined &&
                            closeExercises(
                                $course.name,
                                exerciseGroup.exercises.map((e) => e.id),
                            )}
                        appearance="secondary"
                    >
                        Close all
                    </vscode-button>
                </div>
            </div>
            <div>
                <div>
                    Completed {exerciseGroup.exercises.filter((e) => e.passed).length} / {exerciseGroup
                        .exercises.length}
                </div>
                <div>
                    Downloaded {exerciseGroup.exercises.filter((e) => {
                        const status = $exerciseStatuses.get(e.id);
                        return status === "opened" || status === "closed";
                    }).length} / {exerciseGroup.exercises.length}
                </div>
                <div>
                    Opened {exerciseGroup.exercises.filter(
                        (e) => $exerciseStatuses.get(e.id) === "opened",
                    ).length} / {exerciseGroup.exercises.length}
                </div>
            </div>
            <div>
                <div>{exerciseGroup.nextDeadlineString}</div>
                <div class="show-exercises-container">
                    <vscode-button
                        on:click={() =>
                            ($expandedParts[exerciseGroup.name] =
                                !$expandedParts[exerciseGroup.name])}
                        on:keypress={() =>
                            ($expandedParts[exerciseGroup.name] =
                                !$expandedParts[exerciseGroup.name])}
                        appearance="secondary"
                    >
                        {#if $expandedParts[exerciseGroup.name]}
                            Hide exercises
                        {:else}
                            Show exercises
                        {/if}
                    </vscode-button>
                </div>
            </div>
            <div>
                <div hidden={!$expandedParts[exerciseGroup.name]}>
                    <hr />
                    <div>
                        <table class="table table-striped">
                            <thead>
                                <tr>
                                    <th>
                                        <input
                                            type="checkbox"
                                            on:change={(ev) => {
                                                const checked = ev.currentTarget.checked;
                                                const newCheckedExercises = $checkedExercises;
                                                for (const exerciseId of exerciseGroup.exercises.map(
                                                    (e) => e.id,
                                                )) {
                                                    newCheckedExercises[exerciseId] = checked;
                                                }
                                                $checkedExercises = newCheckedExercises;
                                                $checkedExercisesCount = Object.values(
                                                    newCheckedExercises,
                                                ).filter((v) => v).length;
                                            }}
                                        />
                                    </th>
                                    <th>Exercise</th>
                                    <th>Deadline</th>
                                    <th>Completed</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {#each exerciseGroup.exercises as exercise}
                                    <tr id={exercise.id.toString()}>
                                        <td>
                                            <input
                                                type="checkbox"
                                                value={exercise.id}
                                                on:change={(ev) => {
                                                    if (ev.currentTarget.checked) {
                                                        checkedExercisesCount.update(
                                                            (val) => val + 1,
                                                        );
                                                    } else {
                                                        checkedExercisesCount.update(
                                                            (val) => val - 1,
                                                        );
                                                    }
                                                }}
                                                bind:checked={$checkedExercises[exercise.id]}
                                            />
                                        </td>
                                        <td>{exercise.name}</td>
                                        <td>
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
                                                        &#9432;
                                                    </span>
                                                </div>
                                            {/if}
                                        </td>
                                        <td>
                                            {exercise.passed ? "✔" : "❌"}
                                        </td>
                                        <td>
                                            {$exerciseStatuses.get(exercise.id) ?? "Loading..."}
                                        </td>
                                    </tr>
                                {/each}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    {/each}
{:else}
    <vscode-progress-ring />
{/if}

{#if $checkedExercisesCount > 0}
    <div class="action-bar-container">
        <div class="action-bar">
            <div class="action-bar-text">
                Select action for {$checkedExercisesCount} selected items
            </div>
            <div class="action-bar-buttons">
                <vscode-button
                    class="action-bar-button"
                    on:click={() =>
                        $course !== undefined && openExercises($course.name, getCheckedExercises())}
                    on:keypress={() =>
                        $course !== undefined && openExercises($course.name, getCheckedExercises())}
                >
                    Open
                </vscode-button>
                <vscode-button
                    class="action-bar-button"
                    on:click={() =>
                        $course !== undefined &&
                        closeExercises($course.name, getCheckedExercises())}
                    on:keypress={() =>
                        $course !== undefined &&
                        closeExercises($course.name, getCheckedExercises())}
                >
                    Close
                </vscode-button>
                <vscode-button
                    class="action-bar-button"
                    appearance="secondary"
                    on:click={() => clearSelectedExercises()}
                    on:keypress={() => clearSelectedExercises()}
                >
                    Clear selection
                </vscode-button>
            </div>
        </div>
    </div>
{/if}

<style>
    .header {
        position: relative;
    }
    .refresh {
        position: absolute;
        top: 0rem;
        right: 0rem;
    }
    .part {
        border: 1px;
        border-style: inset;
        padding: 0.4rem;
        padding-top: 0rem;
        margin-top: 0.4rem;
        margin-bottom: 0.4rem;
    }
    .part-header {
        display: flex;
        flex-direction: column;
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
        width: 100%;
        box-sizing: border-box;
    }
    .show-exercises-container {
        padding: 0.4rem;
        display: flex;
        justify-content: center;
    }
    .action-bar-container {
        position: fixed;
        bottom: 0rem;
        left: 50%;
        right: 50%;
        justify-content: center;
        display: flex;
    }
    .action-bar {
        display: flex;
        flex-direction: column;
        background-color: var(--vscode-editor-background);
        padding: 1rem;
        border: 1px;
        border-style: inset;
    }
    .action-bar-text {
        text-align: center;
    }
    .action-bar-buttons {
        display: flex;
        justify-content: center;
    }
    .action-bar-button {
        margin: 0.4rem;
    }

    @media (orientation: landscape) {
        .part-header {
            flex-direction: row;
        }
        .part-buttons {
            flex-direction: row;
        }
        .part-button {
            width: auto;
        }
    }
</style>
