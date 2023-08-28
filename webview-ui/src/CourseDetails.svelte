<script lang="ts">
    import { vscode } from "./utilities/vscode";
    import { provideVSCodeDesignSystem, vsCodeButton } from "@vscode/webview-ui-toolkit";

    provideVSCodeDesignSystem().register(vsCodeButton());

    export let data: any;

    const getHardDeadlineInformation = (deadline) =>
        "This is a soft deadline and it can be exceeded." +
        "&#013Exercises can be submitted after the soft deadline has passed, " +
        "but you receive only 75% of the exercise points." +
        `&#013;Hard deadline for this exercise is: ${deadline}.` +
        "&#013;Hard deadline can not be exceeded.";

    const course = document.getElementById("course").dataset as any;
    function openExercises(ids) {
        vscode.postMessage({ type: "openSelected", ids, courseName: course.courseName } as any);
    }

    function closeExercises(ids) {
        vscode.postMessage({ type: "closeSelected", ids, courseName: course.courseName } as any);
    }
</script>

<div>
    <div class="w-100">
        <div class="container pt-0">
            <div class="row py-1">
                <div class="col-md">
                    <nav aria-label="breadcrumb">
                        <ol class="breadcrumb">
                            <li class="breadcrumb-item">
                                <a id="back-to-my-courses" href="#"> My Courses </a>
                            </li>
                            <li class="breadcrumb-item" aria-current="page">
                                {data.course.title}
                            </li>
                        </ol>
                    </nav>
                </div>
            </div>
            <div
                class="row py-1"
                id="course"
                data-course-id={data.course.id}
                data-course-name={data.course.name}
                data-course-org={data.course.organization}
                data-course-disabled={data.course.disabled}
            >
                <div class="col-md-10">
                    <h2>{data.course.title}</h2>
                    <span>{data.course.description}</span>
                </div>
                <div class="col-md-2">
                    <vscode-button class="btn btn-primary" id="refresh-button" aria-label="Refresh">
                        Refresh
                    </vscode-button>
                </div>
            </div>
            <div class="row py-1">
                <div class="col-md">
                    <span>
                        Points gained: {data.course.awardedPoints} / {data.course.availablePoints}
                    </span>
                </div>
            </div>
            {#if data.course.materialUrl}
                <div class="row py-1">
                    <div class="col-md">
                        Material: <a href={data.course.materialUrl}>{data.course.materialUrl}</a>
                    </div>
                </div>
            {/if}
            <div class="row py-1">
                <div class="col-md">
                    <vscode-button
                        class="btn btn-primary"
                        id="open-workspace"
                        aria-label="Open workspace"
                    >
                        Open workspace
                    </vscode-button>
                </div>
            </div>
            <div class="row py-1">
                <div class="col-md">
                    <div class="alert alert-warning update-notification" role="alert">
                        <span class="mr-2">Updates found for exercises</span>
                        <vscode-button class="btn btn-danger update-button"
                            >Update exercises</vscode-button
                        >
                    </div>
                    {#if data.offlineMode}
                        <div class="alert alert-warning" role="alert">
                            <span>
                                Unable to fetch exercise data from server. Displaying local
                                exercises.
                            </span>
                        </div>
                    {/if}
                    {#if data.course.perhapsExamMode}
                        <div class="alert alert-info" role="alert">
                            <span>
                                This is an exam. Exercise submission results will not be shown.
                            </span>
                        </div>
                    {/if}
                    <div role="alert" class="alert alert-info" id="course-disabled-notification">
                        This course has been disabled. Exercises cannot be downloaded or submitted.
                    </div>
                </div>
            </div>
        </div>
    </div>

    {#each data.exerciseData as exerciseGroup}
        <div class="container container-fluid border-current-color my-3 exercise-card">
            <div class="row">
                <div class="col-md">
                    <h2>{exerciseGroup.name}</h2>
                </div>
                <div class="col-md-2 my-1">
                    <vscode-button class="btn btn-success w-100 download-all">
                        Download (<span>0</span>)
                    </vscode-button>
                </div>
                <div class="col-md-2 my-1">
                    <vscode-button
                        class="btn btn-primary w-100 open-all"
                        data-exercises={exerciseGroup.exercises.map((e) => e.id)}
                    >
                        Open all
                    </vscode-button>
                </div>
                <div class="col-md-2 my-1">
                    <vscode-button
                        class="btn btn-primary w-100 close-all"
                        data-exercises={exerciseGroup.exercises.map((e) => e.id)}
                    >
                        Close all
                    </vscode-button>
                </div>
            </div>
            <div class="row py-1">
                <div class="col-md group-info" data-group-name={exerciseGroup.name}>
                    <div id={`completed-${exerciseGroup.name}`}>Completed 0/0</div>
                    <div id={`downloaded-${exerciseGroup.name}`}>Downloaded 0/0</div>
                    <div id={`opened-${exerciseGroup.name}`}>Opened 0/0</div>
                </div>
            </div>
            <div class="row pt-2">
                <div class="col-md-5">{exerciseGroup.nextDeadlineString}</div>
                <div class="col-md-2 text-center">
                    <vscode-button class="show-all-button" data-group-name={exerciseGroup.name}>
                        Show exercises
                    </vscode-button>
                </div>
            </div>
            <div class="row">
                <div class="col-md" id={`${exerciseGroup.name}-exercises`}>
                    <hr />
                    <div class="table-responsive-md">
                        <table class="table table-striped table-borderless exercise-table">
                            <thead id={`${exerciseGroup.name}-table-headers`}>
                                <tr>
                                    <th class="min-w-5 text-center">
                                        <input class="checkbox-xl" type="checkbox" />
                                    </th>
                                    <th class="min-w-40">Exercise</th>
                                    <th class="min-w-30">Deadline</th>
                                    <th class="min-w-10">Completed</th>
                                    <th class="min-w-15">Status</th>
                                </tr>
                            </thead>
                            <tbody class="exercise-tbody">
                                {#each exerciseGroup.exercises as exercise}
                                    <tr class="exercise-table-row" id={exercise.id}>
                                        <td class="min-w-5 text-center exercise-selector">
                                            <input
                                                class="checkbox-xl"
                                                type="checkbox"
                                                value={exercise.id}
                                            />
                                        </td>
                                        <td class="min-w-40 text-break">{exercise.name}</td>
                                        <td class="min-w-30">
                                            {#if exercise.isHard}
                                                {exercise.hardDeadlineString}
                                            {:else}
                                                <div>
                                                    {exercise.softDeadlineString}
                                                    <span
                                                        class="font-weight-bold"
                                                        title={getHardDeadlineInformation(
                                                            exercise.hardDeadlineString,
                                                        )}
                                                    >
                                                        &#9432;
                                                    </span>
                                                </div>
                                            {/if}
                                        </td>
                                        <td
                                            class="min-w-10 exercise-completed"
                                            data-exercise-completed={exercise.passed}
                                        >
                                            {exercise.passed ? "&#10004;" : "&#10060;"}
                                        </td>
                                        <td
                                            class="min-w-15 exercise-status"
                                            id={`exercise-${exercise.id}-status`}
                                            data-exercise-id={exercise.id}
                                        >
                                            loading...
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
    <div id="context-menu" class="container fixed-bottom">
        <div class="card border-current-color">
            <div class="card-body">
                Select action for <span id="selected-count">0</span> selected items
                <div class="row mt-2">
                    <div class="col-md-3">
                        <vscode-button class="btn btn-primary m-1 w-100" id="open-selected">
                            Open
                        </vscode-button>
                    </div>
                    <div class="col-md-3">
                        <vscode-button class="btn btn-primary m-1 w-100" id="close-selected">
                            Close
                        </vscode-button>
                    </div>
                    <div class="col-md-3">
                        <vscode-button class="btn btn-primary m-1 w-100" id="clear-all-selections">
                            Clear selection
                        </vscode-button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>
