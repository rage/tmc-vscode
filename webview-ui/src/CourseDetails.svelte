<script lang="ts">
    import { derived, writable } from "svelte/store";
    import {
        CourseData,
        CourseDetailsPanel,
        ExerciseGroup,
        ExerciseStatus,
        assertUnreachable,
    } from "./shared/shared";
    import { vscode } from "./utilities/vscode";
    import { addMessageListener, loadable } from "./utilities/script";
    import ExercisePart from "./components/ExercisePart.svelte";

    export let panel: CourseDetailsPanel;

    const course = loadable<CourseData>();
    const offlineMode = loadable<boolean>();
    const exerciseGroups = loadable<Array<ExerciseGroup>>();
    const updateableExercises = loadable<Array<number>>();
    const disabled = loadable<boolean>();
    const exerciseStatuses = writable<Record<number, ExerciseStatus>>({});
    const totalDownloading = writable<number>(0);
    const refreshing = writable<boolean>(false);
    const checkedExercises = writable<Record<number, boolean>>({});
    const checkedExercisesCount = derived(checkedExercises, ($checkedExercises) => {
        return Object.values($checkedExercises).filter((checked) => checked).length;
    });
    const pointsGained = derived(course, ($course) => {
        return $course ? `${$course.awardedPoints} / ${$course.availablePoints}` : undefined;
    });

    addMessageListener(panel, (message) => {
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
                    es[message.exerciseId] = message.status;
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
                    s[message.exerciseId] = message.status;
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
    function downloadExercises(course: CourseData, ids: Array<number>) {
        vscode.postMessage({
            type: "downloadExercises",
            ids,
            courseName: course.name,
            organizationSlug: course.organization,
            courseId: course.id,
            mode: "download",
        });
    }
    function openExercises(courseName: string, ids: Array<number>) {
        vscode.postMessage({
            type: "openExercises",
            ids,
            courseName,
        });
    }
    function closeExercises(courseName: string, ids: Array<number>) {
        vscode.postMessage({
            type: "closeExercises",
            ids,
            courseName,
        });
    }
    function clearSelectedExercises() {
        checkedExercises.set({});
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
    function getCheckedExercises(): Array<number> {
        return Object.entries($checkedExercises)
            .filter(([_, v]) => v)
            .map(([k, _]) => Number(k));
    }
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
    {$course?.title ?? "Loading course..."}
</nav>
<div class="header">
    {#if $course === undefined}
        <h2>Loading course...</h2>
    {:else}
        <h2>{$course.title} <small class="muted">({$course.name})</small></h2>
    {/if}

    <div>
        {$course?.description ?? "Loading description..."}
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
        Points gained: {$pointsGained ?? "Loading points..."}
    </div>

    {#if $course?.materialUrl}
        <div>
            Material: <a href={$course.materialUrl}>{$course.materialUrl}</a>
        </div>
    {/if}

    <div class="open-workspace-button">
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
        <ExercisePart
            {exerciseGroup}
            exerciseStatuses={$exerciseStatuses}
            bind:checkedExercises={$checkedExercises}
            onDownloadAll={(exercises) => $course && downloadExercises($course, exercises)}
            onOpenAll={(exercises) => $course && openExercises($course.name, exercises)}
            onCloseAll={(exercises) => $course && closeExercises($course.name, exercises)}
        />
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
                        $course !== undefined && downloadExercises($course, getCheckedExercises())}
                    on:keypress={() =>
                        $course !== undefined && downloadExercises($course, getCheckedExercises())}
                >
                    Download
                </vscode-button>
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
    .open-workspace-button {
        margin-top: 0.4rem;
        margin-bottom: 0.4rem;
    }
    .muted {
        opacity: 90%;
    }
</style>
