<script lang="ts">
    import { provideVSCodeDesignSystem, vsCodeButton } from "@vscode/webview-ui-toolkit";
    import { CourseData, MessageFromWebview } from "./shared";
    import { vscode } from "./utilities/vscode";

    provideVSCodeDesignSystem().register(vsCodeButton());

    export let courses: Array<CourseData>;
    export let tmcDataPath: string;
    export let tmcDataSize: string;

    const addNewCourse = () => {
        const message: MessageFromWebview = {
            type: "addCourse",
        };
        vscode.postMessage(message);
    };

    const changeTmcDataPath = () => {
        const message: MessageFromWebview = {
            type: "changeTmcDataPath",
        };
        vscode.postMessage(message);
    };

    const openCourseDetails = (courseId: number) => {
        const message: MessageFromWebview = {
            type: "openCourseDetails",
            courseId,
        };
        vscode.postMessage(message);
    };

    const removeCourse = (id: number) => {
        const message: MessageFromWebview = {
            type: "removeCourse",
            id,
        };
        vscode.postMessage(message);
    };

    const openWorkspace = (name: string) => {
        const message: MessageFromWebview = {
            type: "openCourseWorkspace",
            name,
        };
        vscode.postMessage(message);
    };

    const downloadExercises = (
        ids: Array<number>,
        courseName: string,
        organizationSlug: string,
        courseId: number,
    ) => {
        const message: MessageFromWebview = {
            type: "downloadExercises",
            ids,
            courseName,
            organizationSlug,
            courseId,
            mode: "download",
        };
        vscode.postMessage(message);
    };

    const clearNewExercises = (courseId: number) => {
        const message: MessageFromWebview = {
            type: "clearNewExercises",
            courseId,
        };
        vscode.postMessage(message);
    };
</script>

<div class="container">
    <div class="row pb-3">
        <div class="col-md-7">
            <h1>My Courses</h1>
            <div>
                <vscode-button
                    type="button"
                    class="btn btn-primary mb-4 mt-2"
                    id="add-new-course"
                    on:click={addNewCourse}
                    on:keypress={addNewCourse}
                >
                    Add new course
                </vscode-button>
            </div>
        </div>
    </div>

    <div class="col-md-5">
        <h5>TMC Exercises Location</h5>
        <div>
            Currently your exercises ({tmcDataSize}) are located at:
        </div>
        <pre>{tmcDataPath}</pre>
        <vscode-button
            class="btn btn-secondary btn-sm"
            id="change-tmc-datapath-btn"
            on:click={changeTmcDataPath}
            on:keypress={changeTmcDataPath}
        >
            Change path
        </vscode-button>
    </div>

    {#each courses as course}
        {@const completedPrc = (course.awardedPoints / course.availablePoints) * 100}
        <div
            class="row org-row border-current-color course-card"
            id={`course-${course.id}`}
            on:click={() => {
                openCourseDetails(course.id);
            }}
            on:keypress={() => {
                openCourseDetails(course.id);
            }}
        >
            <div class="col-md">
                <vscode-button
                    type="button"
                    class="close remove-course-btn"
                    aria-label="remove course"
                    on:click={() => removeCourse(course.id)}
                    on:keypress={() => removeCourse(course.id)}
                >
                    <span aria-hidden="true">&times;</span>
                </vscode-button>
                <h3>
                    {course.title} <small class="text-muted">{course.name}</small>
                </h3>
                <p>{course.description}</p>
                <div class="row">
                    <div class="col-md" id={`course-${course.id}-next-deadline`}>
                        <span
                            class="spinner-border spinner-border-sm"
                            role="status"
                            aria-hidden="true"
                        />
                    </div>
                    <div class="col-sm">
                        <vscode-button
                            type="button"
                            class="btn btn-primary open-workspace-btn"
                            aria-label="Open workspace"
                            on:click={() => openWorkspace(course.name)}
                            on:keypress={() => openWorkspace(course.name)}
                        >
                            Open workspace
                        </vscode-button>
                    </div>
                </div>
                <div>
                    Programming exercise progress:
                    <div class="progress">
                        <div
                            class="progress-bar bg-success"
                            role="progressbar"
                            aria-valuenow={completedPrc}
                            aria-valuemin={0}
                            aria-valuemax={100}
                        >
                            {completedPrc.toFixed(2)} %
                        </div>
                    </div>
                </div>
                {#if course.disabled}
                    <div role="alert" class="alert alert-info course-disabled-notification my-1">
                        This course has been disabled. Exercises cannot be downloaded or submitted.
                    </div>
                {:else if course.newExercises.length > 0}
                    <div
                        class="alert alert-info alert-dismissible mt-2 new-exercises-notification"
                        role="alert"
                    >
                        <span class="new-exercises-count">{course.newExercises.length}</span> new
                        exercises found for this course.
                        <vscode-button
                            type="button"
                            class="btn btn-success ml-1 download-new-exercises-btn"
                            on:click={() => {
                                downloadExercises(
                                    course.newExercises,
                                    course.name,
                                    course.organization,
                                    course.id,
                                );
                            }}
                            on:keypress={() => {
                                downloadExercises(
                                    course.newExercises,
                                    course.name,
                                    course.organization,
                                    course.id,
                                );
                            }}
                        >
                            Download them!
                        </vscode-button>
                        <vscode-button
                            type="button"
                            class="close clear-new-exercises-btn"
                            aria-label="Close"
                            on:click={() => clearNewExercises(course.id)}
                            on:keypress={() => clearNewExercises(course.id)}
                        >
                            &times;
                        </vscode-button>
                    </div>
                {/if}
            </div>
        </div>
    {/each}
    {#if courses.length === 0}
        <div class="row">
            <div class="col-md">Add courses to start completing exercises.</div>
        </div>
    {/if}
</div>
