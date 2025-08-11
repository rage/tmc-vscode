<script lang="ts">
    import {
        CourseIdentifier,
        ExerciseIdentifier,
        MyCoursesPanel,
        assertUnreachable,
    } from "../shared/shared";
    import { vscode } from "../utilities/vscode";
    import { addMessageListener, loadable, savePanelState } from "../utilities/script";
    import { onMount } from "svelte";
    import ProgressBar from "../components/ProgressBar.svelte";
    import Card from "../components/Card.svelte";

    export let panel: MyCoursesPanel;

    const selectedOrganizationSlug = loadable<string>();

    onMount(() => {
        vscode.postMessage({
            type: "requestMyCoursesData",
            sourcePanel: panel,
        });
    });
    addMessageListener(panel, (message) => {
        switch (message.type) {
            case "setMyCourses": {
                panel.courses = message.courses;
                savePanelState(panel);
                break;
            }
            case "setTmcDataPath": {
                panel.tmcDataPath = message.tmcDataPath;
                savePanelState(panel);
                break;
            }
            case "setTmcDataSize": {
                panel.tmcDataSize = message.tmcDataSize;
                savePanelState(panel);
                break;
            }
            case "selectedOrganization": {
                selectedOrganizationSlug.set(message.slug);
                vscode.postMessage({
                    type: "selectCourse",
                    sourcePanel: panel,
                    slug: message.slug,
                });
                break;
            }
            case "selectedCourse": {
                vscode.postMessage({
                    type: "addCourse",
                    organizationSlug: message.organizationSlug,
                    courseId: message.courseId,
                    requestingPanel: panel,
                });
                // todo: only close side panel on success
                vscode.postMessage({
                    type: "closeSidePanel",
                });
                break;
            }
            case "selectedMoocCourse": {
                vscode.postMessage({
                    type: "addMoocCourse",
                    organizationSlug: message.organizationSlug,
                    courseId: message.courseId,
                    instanceId: message.instanceId,
                    courseName: message.courseName,
                    instanceName: message.instanceName,
                    requestingPanel: panel,
                });
                // todo: only close side panel on success
                vscode.postMessage({
                    type: "closeSidePanel",
                });
                break;
            }
            case "setNewExercises": {
                const courses = panel.courses ?? [];
                const course = courses.find((c) => c.id === message.courseId);
                if (course) {
                    course.newExercises = message.exerciseIds;
                    savePanelState(panel);
                }
                break;
            }
            case "setCourseDisabledStatus": {
                const courses = panel.courses ?? [];
                const course = courses.find((c) => c.id === message.courseId);
                if (course) {
                    course.disabled = message.disabled;
                    savePanelState(panel);
                }
                break;
            }
            case "setNextCourseDeadline": {
                panel.courseDeadlines[message.courseId] = message.deadline;
                savePanelState(panel);
                break;
            }
            default:
                assertUnreachable(message);
        }
    });

    function addNewCourse() {
        vscode.postMessage({
            type: "selectPlatform",
            sourcePanel: panel,
        });
    }
    function changeTmcDataPath() {
        vscode.postMessage({
            type: "changeTmcDataPath",
        });
    }
    function openCourseDetails(courseId: CourseIdentifier) {
        vscode.postMessage({
            type: "openCourseDetails",
            courseId,
        });
    }
    function removeCourse(id: number) {
        vscode.postMessage({
            type: "removeCourse",
            id,
        });
    }
    function openWorkspace(name: string) {
        vscode.postMessage({
            type: "openCourseWorkspace",
            courseName: name,
        });
    }
    function downloadExercises(
        ids: Array<ExerciseIdentifier>,
        courseName: string,
        organizationSlug: string,
        courseId: CourseIdentifier,
    ) {
        vscode.postMessage({
            type: "downloadExercises",
            ids,
            courseId,
            mode: "download",
        });
    }
    function clearNewExercises(courseId: number) {
        vscode.postMessage({
            type: "clearNewExercises",
            courseId,
        });
    }
</script>

<div>
    <h1>My Courses</h1>

    <div class="top-container">
        <div>
            <div>
                Currently your exercises ({panel.tmcDataSize ?? "loading size..."}) are located at:
                <span class="data-path">{panel.tmcDataPath ?? "loading path..."}</span>
            </div>
            <vscode-button
                role="button"
                tabindex="0"
                class="change-path-button"
                appearance="secondary"
                on:click={changeTmcDataPath}
                on:keypress={changeTmcDataPath}
            >
                Change path
            </vscode-button>
        </div>
    </div>

    {#if panel.courses !== undefined && panel.moocCourses !== undefined}
        {#each panel.courses as course}
            {@const completed = ((course.awardedPoints / course.availablePoints) * 100).toFixed(2)}
            <Card>
                <div
                    role="button"
                    tabindex="0"
                    on:click={() => {
                        openCourseDetails(course.id);
                    }}
                    on:keypress={() => {
                        openCourseDetails(course.id);
                    }}
                >
                    <div class="course-header">
                        <h3 class="course-title">
                            {course.title} <small class="muted">({course.name})</small>
                        </h3>
                        <vscode-button
                            role="button"
                            tabindex="0"
                            class="remove-button"
                            appearance="secondary"
                            type="button"
                            aria-label="remove course"
                            on:click|stopPropagation={() => removeCourse(course.id)}
                            on:keypress|stopPropagation={() => removeCourse(course.id)}
                        >
                            ×
                        </vscode-button>
                    </div>
                    {#if course.description}
                        <p class="course-description">{course.description}</p>
                    {/if}
                    <div class="progress-bar-container">
                        <ProgressBar
                            label={`Programming exercise progress: ${completed}%`}
                            value={course.awardedPoints}
                            max={course.availablePoints}
                        />
                    </div>
                    <vscode-button
                        role="button"
                        tabindex="0"
                        appearance="primary"
                        type="button"
                        aria-label="Open workspace"
                        on:click|stopPropagation={() => openWorkspace(course.name)}
                        on:keypress|stopPropagation={() => openWorkspace(course.name)}
                    >
                        Open workspace
                    </vscode-button>

                    {#if course.disabled}
                        <div role="alert">
                            This course has been disabled. Exercises cannot be downloaded or
                            submitted.
                        </div>
                    {:else if course.newExercises.length > 0}
                        <div role="alert">
                            {course.newExercises.length} new exercises found for this course.
                            <vscode-button
                                role="button"
                                tabindex="0"
                                type="button"
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
                                role="button"
                                tabindex="0"
                                type="button"
                                aria-label="Close"
                                on:click={() => clearNewExercises(course.id)}
                                on:keypress={() => clearNewExercises(course.id)}
                            >
                                ×
                            </vscode-button>
                        </div>
                    {/if}
                </div>
            </Card>
        {/each}
        {#each panel.moocCourses as moocCourse}
            <div>mooc course {moocCourse.instanceId}</div>
        {/each}
        {#if panel.courses.length === 0}
            <div>Add courses to start completing exercises.</div>
        {/if}
    {:else}
        <vscode-progress-ring />
    {/if}
</div>

<div class="add-new-course-container">
    <vscode-button
        role="button"
        tabindex="0"
        class="add-new-course"
        type="button"
        on:click={addNewCourse}
        on:keypress={addNewCourse}
    >
        Add new course
    </vscode-button>
</div>

<style>
    .muted {
        opacity: 90%;
    }
    .add-new-course {
        margin-bottom: 0.4rem;
    }
    .course-header {
        display: flex;
    }
    .course-title {
        margin-top: 0.2rem;
        flex-grow: 1;
    }
    .data-path {
        white-space: normal;
        font-family: monospace;
    }
    .change-path-button {
        margin-top: 0.4rem;
    }
    .remove-button {
        align-self: start;
        margin: 0.4rem;
    }
    .top-container {
        display: grid;
        grid-auto-flow: row;
        grid-auto-columns: 1fr;
        margin-bottom: 0.8rem;
    }
    .add-new-course-container {
        align-self: end;
    }
    .progress-bar-container {
        margin-bottom: 0.8rem;
    }
    .course-description {
        margin-top: 0rem;
    }

    @media (orientation: landscape) {
        .add-new-course {
            margin-bottom: 0rem;
        }
        .top-container {
            grid-auto-flow: column;
        }
    }
</style>
