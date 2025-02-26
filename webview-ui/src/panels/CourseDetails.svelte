<script lang="ts">
    import { derived, writable } from "svelte/store";
    import {
        CourseDetailsPanel,
        assertUnreachable,
        match,
        matchOption,
        CourseIdentifier,
        ExerciseIdentifier,
        TmcExerciseId,
        MoocExerciseId,
    } from "../shared/shared";
    import { vscode } from "../utilities/vscode";
    import { addMessageListener, savePanelState } from "../utilities/script";
    import ExercisePart from "../components/ExercisePart.svelte";
    import { onMount } from "svelte";

    export let panel: CourseDetailsPanel;

    const totalDownloading = writable<number>(0);
    const refreshing = writable<boolean>(false);
    const checkedExercises = writable<{
        tmc: Record<TmcExerciseId, boolean>;
        mooc: Record<MoocExerciseId, boolean>;
    }>({ tmc: {}, mooc: {} });
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
                const title = match(
                    message.courseData,
                    (tmc) => tmc.title,
                    (mooc) => mooc.instanceId,
                );
                const slug = match(
                    message.courseData,
                    (tmc) => tmc.name,
                    (mooc) => mooc.instanceId,
                );
                const disabled = match(
                    message.courseData,
                    (tmc) => tmc.disabled,
                    (_) => false,
                );
                const awardedPoints = match(
                    message.courseData,
                    (tmc) => tmc.awardedPoints,
                    (mooc) => mooc.awardedPoints,
                );
                const availablePoints = match(
                    message.courseData,
                    (tmc) => tmc.availablePoints,
                    (mooc) => mooc.availablePoints,
                );
                const materialUrl = match(
                    message.courseData,
                    (tmc) => tmc.materialUrl,
                    (mooc) => mooc.materialUrl,
                );
                const perhapsExamMode = match(
                    message.courseData,
                    (tmc) => tmc.perhapsExamMode,
                    // todo: support exams in mooc
                    (_mooc) => false,
                );
                panel.course = {
                    title,
                    slug,
                    disabled,
                    courseData: message.courseData,
                    awardedPoints,
                    availablePoints,
                    materialUrl,
                    perhapsExamMode,
                };
                break;
            }
            case "setCourseGroups": {
                panel.offlineMode = message.offlineMode;
                panel.exerciseGroups = message.exerciseGroups;
                break;
            }
            case "setCourseDisabledStatus": {
                if (message.courseId === panel.courseId && panel.course) {
                    panel.course.disabled = message.disabled;
                }
                break;
            }
            case "exerciseStatusChange": {
                match(
                    message.exerciseId,
                    (tmc) => {
                        panel.exerciseStatuses.tmc[tmc.tmcExerciseId] = message.status;
                    },
                    (mooc) => {
                        panel.exerciseStatuses.mooc[mooc.moocExerciseId] = message.status;
                    },
                );
                break;
            }
            case "setUpdateables": {
                panel.updateableExercises = message.exerciseIds;
                break;
            }
            case "setCourseDisabledStatus": {
                if (panel.course) {
                    panel.course.disabled = message.disabled;
                }
                break;
            }
            case "setCourseGroups": {
                panel.exerciseGroups = message.exerciseGroups;
                break;
            }
            default:
                assertUnreachable(message);
        }
        savePanelState(panel);
    });

    function openMyCourses() {
        vscode.postMessage({
            type: "openMyCourses",
        });
    }
    function refresh(id: CourseIdentifier) {
        refreshing.set(true);
        vscode.postMessage({
            type: "refreshCourseDetails",
            id,
            useCache: false,
        });
    }
    function openWorkspace(panel: CourseDetailsPanel) {
        matchOption(
            panel.course?.courseData,
            (tmc) => {
                vscode.postMessage({
                    type: "openCourseWorkspace",
                    courseName: tmc.name,
                });
            },
            (mooc) => {
                throw new Error("todo");
            },
        );
    }
    function downloadExercises(panel: CourseDetailsPanel, ids: Array<ExerciseIdentifier>) {
        vscode.postMessage({
            type: "downloadExercises",
            ids,
            courseId: panel.courseId,
            mode: "download",
        });
    }
    function openExercises(panel: CourseDetailsPanel, ids: Array<ExerciseIdentifier>) {
        vscode.postMessage({
            type: "openExercises",
            ids,
            courseId: panel.courseId,
        });
    }
    function closeExercises(panel: CourseDetailsPanel, ids: Array<ExerciseIdentifier>) {
        vscode.postMessage({
            type: "closeExercises",
            ids,
            courseId: panel.courseId,
        });
    }
    function clearSelectedExercises() {
        checkedExercises.set({ tmc: {}, mooc: {} });
    }
    function updateExercises(panel: CourseDetailsPanel) {
        matchOption(
            panel.course?.courseData,
            (tmc) => {
                vscode.postMessage({
                    type: "downloadExercises",
                    ids: panel.updateableExercises ?? [],
                    courseId: { kind: "tmc", courseId: tmc.id },
                    mode: "update",
                });
            },
            (_mooc) => {
                throw new Error("todo");
            },
        );
    }
    function getCheckedExercises(): Array<ExerciseIdentifier> {
        const onlyCheckedExercises: Array<ExerciseIdentifier> = [];
        Object.entries($checkedExercises.tmc).forEach(([id, checked]) => {
            if (checked) {
                onlyCheckedExercises.push({ kind: "tmc", tmcExerciseId: parseInt(id, 10) });
            }
        });
        Object.entries($checkedExercises.mooc).forEach(([id, checked]) => {
            if (checked) {
                onlyCheckedExercises.push({ kind: "mooc", moocExerciseId: id });
            }
        });
        return onlyCheckedExercises;
    }
</script>

<nav>
    <a
        id="back-to-my-courses"
        role="button"
        class="my-courses-link"
        tabindex="0"
        on:click={() => openMyCourses()}
        on:keypress={() => openMyCourses()}
    >
        My Courses
    </a>
    /
    {matchOption(
        panel.course?.courseData,
        (tmc) => tmc.title,
        (_mooc) => "todo",
    ) ?? "Loading course..."}
</nav>
<div class="header">
    {#if panel.course === undefined}
        <h2>Loading course...</h2>
    {:else}
        <h2>{panel.course.title} <small class="muted">({panel.course.slug})</small></h2>
    {/if}

    <div>
        {matchOption(
            panel.course?.courseData,
            (tmc) => tmc.description,
            (mooc) => mooc.description,
        ) ?? "Loading description..."}
    </div>

    <div>
        <vscode-button
            role="button"
            tabindex="0"
            class="refresh"
            aria-label="Refresh"
            on:click={() => refresh(panel.courseId)}
            on:keypress={() => refresh(panel.courseId)}
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
            role="button"
            tabindex="0"
            aria-label="Open workspace"
            on:click={() => openWorkspace(panel)}
            on:keypress={() => openWorkspace(panel)}
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
            role="button"
            tabindex="0"
            on:click={() => updateExercises(panel)}
            on:keypress={() => updateExercises(panel)}
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
    {#if panel.course?.disabled}
        <div role="alert">
            This course has been disabled. Exercises cannot be downloaded or submitted.
        </div>
    {/if}
</div>

{#if panel.exerciseGroups !== undefined}
    {#each Object.values(panel.exerciseGroups.tmc).concat(Object.values(panel.exerciseGroups.mooc)) as exerciseGroup}
        <div class="exercise-part">
            <ExercisePart
                {exerciseGroup}
                exerciseStatuses={panel.exerciseStatuses}
                bind:checkedExercises={$checkedExercises}
                onDownloadAll={(exercises) => downloadExercises(panel, exercises)}
                onOpenAll={(exercises) => openExercises(panel, exercises)}
                onCloseAll={(exercises) => closeExercises(panel, exercises)}
            />
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
                    role="button"
                    tabindex="0"
                    class="action-bar-button"
                    on:click={() => downloadExercises(panel, getCheckedExercises())}
                    on:keypress={() => downloadExercises(panel, getCheckedExercises())}
                >
                    Download
                </vscode-button>
                <vscode-button
                    role="button"
                    tabindex="0"
                    class="action-bar-button"
                    on:click={() => openExercises(panel, getCheckedExercises())}
                    on:keypress={() => openExercises(panel, getCheckedExercises())}
                >
                    Open
                </vscode-button>
                <vscode-button
                    role="button"
                    tabindex="0"
                    class="action-bar-button"
                    on:click={() => closeExercises(panel, getCheckedExercises())}
                    on:keypress={() => closeExercises(panel, getCheckedExercises())}
                >
                    Close
                </vscode-button>
                <vscode-button
                    role="button"
                    tabindex="0"
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
        bottom: 0.8rem;
        left: 50%;
        right: 50%;
        justify-content: center;
        display: flex;
    }
    .action-bar {
        display: flex;
        flex-direction: column;
        background-color: var(--vscode-editor-background, #1f1f1f);
        padding: 0.4rem;
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
    .exercise-part {
        margin-bottom: 1rem;
    }
    .my-courses-link {
        cursor: pointer;
    }
</style>
