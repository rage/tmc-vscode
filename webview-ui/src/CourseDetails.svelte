<script lang="ts">
    import { writable } from "svelte/store";
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
    const expandedParts = writable<Record<string, boolean>>(
        {}, //exerciseData.reduce((acc, ed) => ((acc[ed.name] = false), acc)),
    );
    const checkedExercises = writable<Record<number, boolean>>(
        {}, //exerciseData.flatMap((ed) => ed.exercises).reduce((acc, e) => ((acc[e.id] = false), acc)),
    );
    const checkedExercisesCount = writable<number>(0);

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
        //
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
</script>

<div class="container">
    <div>
        <nav aria-label="breadcrumb">
            <ol class="breadcrumb">
                <li>
                    <a
                        id="back-to-my-courses"
                        role="button"
                        tabindex="0"
                        on:click={() => openMyCourses()}
                        on:keypress={() => openMyCourses()}
                    >
                        My Courses
                    </a>
                </li>
                <li aria-current="page">
                    {$course?.title ?? "asd"}
                </li>
            </ol>
        </nav>
    </div>
    <div>
        <div>
            <h2>{$course?.title ?? ""}</h2>
            <span>{$course?.description ?? ""}</span>
        </div>
        <div>
            <vscode-button
                aria-label="Refresh"
                on:click={() => $course !== undefined && refresh($course.id)}
                on:keypress={() => $course !== undefined && refresh($course.id)}
                disabled={$refreshing || $totalDownloading > 0}
            >
                {#if $refreshing}
                    <!-- todo: spinner -->
                    Refreshing
                {:else}
                    Refresh
                {/if}
            </vscode-button>
        </div>
    </div>
    <div>
        Points gained: {$course?.awardedPoints} / {$course?.availablePoints}
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
        {#if offlineMode}
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
</div>

{#each $exerciseGroups ?? [] as exerciseGroup}
    <div class="container border-current-color">
        <div>
            <div>
                <h2>{exerciseGroup.name}</h2>
            </div>
            <div>
                <vscode-button>
                    Download ({exerciseGroup.exercises.filter((e) => {
                        const status = $exerciseStatuses.get(e.id);
                        return status !== "opened" && status !== "closed";
                    }).length})
                </vscode-button>
            </div>
            <div>
                <vscode-button
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
                >
                    Open all
                </vscode-button>
            </div>
            <div>
                <vscode-button
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
            <div>
                <vscode-button
                    on:click={() =>
                        ($expandedParts[exerciseGroup.name] = !$expandedParts[exerciseGroup.name])}
                    on:keypress={() =>
                        ($expandedParts[exerciseGroup.name] = !$expandedParts[exerciseGroup.name])}
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
                                <th class="min-w-5">
                                    <input
                                        class="checkbox-xl"
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
                                        }}
                                    />
                                </th>
                                <th class="min-w-40">Exercise</th>
                                <th class="min-w-30">Deadline</th>
                                <th class="min-w-10">Completed</th>
                                <th class="min-w-15">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {#each exerciseGroup.exercises as exercise}
                                <tr id={exercise.id.toString()}>
                                    <td class="min-w-5">
                                        <input
                                            class="checkbox-xl"
                                            type="checkbox"
                                            value={exercise.id}
                                            on:change={(ev) => {
                                                if (ev.currentTarget.checked) {
                                                    checkedExercisesCount.update((val) => val + 1);
                                                } else {
                                                    checkedExercisesCount.update((val) => val - 1);
                                                }
                                            }}
                                            bind:checked={$checkedExercises[exercise.id]}
                                        />
                                    </td>
                                    <td class="min-w-40">{exercise.name}</td>
                                    <td class="min-w-30">
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
                                    <td class="min-w-10">
                                        {exercise.passed ? "✔" : "❌"}
                                    </td>
                                    <td class="min-w-15">
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

<div class="container">
    <div class="border-current-color">
        Select action for {Object.values($checkedExercises).filter((v) => v).length} selected items
        <div>
            <div>
                <vscode-button
                    on:click={() =>
                        $course !== undefined &&
                        openExercises(
                            $course.name,
                            Object.entries($checkedExercises)
                                .filter(([_, v]) => v)
                                .map(([k, _]) => Number(k)),
                        )}
                    on:keypress={() =>
                        $course !== undefined &&
                        openExercises(
                            $course.name,
                            Object.entries($checkedExercises)
                                .filter(([_, v]) => v)
                                .map(([k, _]) => Number(k)),
                        )}
                >
                    Open
                </vscode-button>
            </div>
            <div>
                <vscode-button
                    on:click={() => $course !== undefined && closeExercises($course.name, [])}
                    on:keypress={() => $course !== undefined && closeExercises($course.name, [])}
                >
                    Close
                </vscode-button>
            </div>
            <div>
                <vscode-button
                    on:click={() => clearSelectedExercises()}
                    on:keypress={() => clearSelectedExercises()}
                >
                    Clear selection
                </vscode-button>
            </div>
        </div>
    </div>
</div>
