<script lang="ts">
    import { derived, writable } from "svelte/store";
    import { CourseData, CourseDetailsPanel, assertUnreachable } from "../shared/shared";
    import { vscode } from "../utilities/vscode";
    import { addMessageListener, savePanelState } from "../utilities/script";
    import ExercisePart from "../components/ExercisePart.svelte";
    import { onMount } from "svelte";

    export let panel: CourseDetailsPanel;

    const totalDownloading = writable<number>(0);
    const refreshing = writable<boolean>(false);
    const checkedExercises = writable<Record<number, boolean>>({});
    const checkedExercisesCount = derived(checkedExercises, ($checkedExercises) => {
        return Object.values($checkedExercises).filter((checked) => checked).length;
    });

    onMount(() => {
        vscode.postMessage({
            type: "requestCourseDetailsData",
            sourcePanel: panel,
        });
    });
    addMessageListener(panel, (message) => {
        switch (message.type) {
            case "setCourseData": {
                panel.course = message.courseData;
                panel.disabled = message.courseData.disabled;
                savePanelState(panel);
                break;
            }
            case "setCourseGroups": {
                panel.offlineMode = message.offlineMode;
                panel.exerciseGroups = message.exerciseGroups;
                savePanelState(panel);
                break;
            }
            case "setCourseDisabledStatus": {
                if (message.courseId === panel.courseId) {
                    panel.disabled = message.disabled;
                    savePanelState(panel);
                }
                break;
            }
            case "exerciseStatusChange": {
                panel.exerciseStatuses[message.exerciseId] = message.status;
                savePanelState(panel);
                break;
            }
            case "setUpdateables": {
                panel.updateableExercises = message.exerciseIds;
                savePanelState(panel);
                break;
            }
            case "setCourseDisabledStatus": {
                panel.disabled = message.disabled;
                savePanelState(panel);
                break;
            }
            case "exerciseStatusChange": {
                panel.exerciseStatuses[message.exerciseId] = message.status;
                savePanelState(panel);
                break;
            }
            case "setCourseGroups": {
                panel.exerciseGroups = message.exerciseGroups;
                savePanelState(panel);
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
            ids: panel.updateableExercises ?? [],
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
    {panel.course?.title ?? "Loading course..."}
</nav>
<div class="header">
    {#if panel.course === undefined}
        <h2>Loading course...</h2>
    {:else}
        <h2>{panel.course.title} <small class="muted">({panel.course.name})</small></h2>
    {/if}

    <div>
        {panel.course?.description ?? "Loading description..."}
    </div>

    <div>
        <vscode-button
            class="refresh"
            aria-label="Refresh"
            on:click={() => panel.course !== undefined && refresh(panel.course.id)}
            on:keypress={() => panel.course !== undefined && refresh(panel.course.id)}
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
        Points gained: {panel.course
            ? `${panel.course.awardedPoints} / ${panel.course.availablePoints}`
            : "Loading points..."}
    </div>

    {#if panel.course?.materialUrl}
        <div>
            Material: <a href={panel.course.materialUrl}>{panel.course.materialUrl}</a>
        </div>
    {/if}

    <div class="open-workspace-button">
        <vscode-button
            aria-label="Open workspace"
            on:click={() => panel.course !== undefined && openWorkspace(panel.course.name)}
            on:keypress={() => panel.course !== undefined && openWorkspace(panel.course.name)}
        >
            Open workspace
        </vscode-button>
    </div>

    <div
        role="alert"
        hidden={panel.updateableExercises === undefined || panel.updateableExercises.length > 0}
    >
        Updates found for exercises
        <vscode-button
            on:click={() => panel.course !== undefined && updateExercises(panel.course)}
            on:keypress={() => panel.course !== undefined && updateExercises(panel.course)}
        >
            Update exercises
        </vscode-button>
    </div>
    {#if panel.offlineMode}
        <div role="alert">
            Unable to fetch exercise data from server. Displaying local exercises.
        </div>
    {/if}
    {#if panel.course?.perhapsExamMode}
        <div role="alert">This is an exam. Exercise submission results will not be shown.</div>
    {/if}
    {#if panel.disabled}
        <div role="alert">
            This course has been disabled. Exercises cannot be downloaded or submitted.
        </div>
    {/if}
</div>

{#if panel.exerciseGroups !== undefined}
    {#each panel.exerciseGroups as exerciseGroup}
        <ExercisePart
            {exerciseGroup}
            exerciseStatuses={panel.exerciseStatuses}
            bind:checkedExercises={$checkedExercises}
            onDownloadAll={(exercises) =>
                panel.course && downloadExercises(panel.course, exercises)}
            onOpenAll={(exercises) => panel.course && openExercises(panel.course.name, exercises)}
            onCloseAll={(exercises) => panel.course && closeExercises(panel.course.name, exercises)}
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
                        panel.course !== undefined &&
                        downloadExercises(panel.course, getCheckedExercises())}
                    on:keypress={() =>
                        panel.course !== undefined &&
                        downloadExercises(panel.course, getCheckedExercises())}
                >
                    Download
                </vscode-button>
                <vscode-button
                    class="action-bar-button"
                    on:click={() =>
                        panel.course !== undefined &&
                        openExercises(panel.course.name, getCheckedExercises())}
                    on:keypress={() =>
                        panel.course !== undefined &&
                        openExercises(panel.course.name, getCheckedExercises())}
                >
                    Open
                </vscode-button>
                <vscode-button
                    class="action-bar-button"
                    on:click={() =>
                        panel.course !== undefined &&
                        closeExercises(panel.course.name, getCheckedExercises())}
                    on:keypress={() =>
                        panel.course !== undefined &&
                        closeExercises(panel.course.name, getCheckedExercises())}
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
        margin-bottom: 0.8rem;
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
