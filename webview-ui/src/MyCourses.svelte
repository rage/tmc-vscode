<script lang="ts">
    import { CourseData, MyCoursesPanel, assertUnreachable } from "./shared";
    import { vscode } from "./utilities/vscode";
    import {
        addExtensionMessageListener,
        addWebviewMessageListener,
        loadable,
    } from "./utilities/script";

    export let panel: MyCoursesPanel;

    const courses = loadable<Array<CourseData>>();
    const tmcDataPath = loadable<string>();
    const tmcDataSize = loadable<string>();
    const selectedOrganizationSlug = loadable<string>();

    addExtensionMessageListener(panel, (message) => {
        switch (message.type) {
            case "setCourses": {
                courses.set(message.courses);
                break;
            }
            case "setTmcDataPath": {
                tmcDataPath.set(message.tmcDataPath);
                break;
            }
            case "setTmcDataSize": {
                tmcDataSize.set(message.tmcDataSize);
                break;
            }
            default:
                assertUnreachable(message);
        }
    });

    addWebviewMessageListener(panel, (message) => {
        switch (message.type) {
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
            default:
                assertUnreachable(message);
        }
    });

    function addNewCourse() {
        vscode.postMessage({
            type: "selectOrganization",
            sourcePanel: panel,
        });
    }

    function changeTmcDataPath() {
        vscode.postMessage({
            type: "changeTmcDataPath",
        });
    }

    function openCourseDetails(courseId: number) {
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
        ids: Array<number>,
        courseName: string,
        organizationSlug: string,
        courseId: number,
    ) {
        vscode.postMessage({
            type: "downloadExercises",
            ids,
            courseName,
            organizationSlug,
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
    <vscode-button
        class="add-new-course"
        type="button"
        on:click={addNewCourse}
        on:keypress={addNewCourse}
    >
        Add new course
    </vscode-button>

    <div class="bordered section">
        <div>
            Currently your exercises ({$tmcDataSize ?? "loading size..."}) are located at:
            <pre class="data-path">{$tmcDataPath ?? "loading path..."}</pre>
        </div>
        <vscode-button
            appearance="secondary"
            on:click={changeTmcDataPath}
            on:keypress={changeTmcDataPath}
        >
            Change path
        </vscode-button>
    </div>

    {#if $courses !== undefined}
        {#each $courses as course}
            {@const completed = ((course.awardedPoints / course.availablePoints) * 100).toFixed(2)}
            <div
                class="course"
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
                        class="remove-button"
                        appearance="secondary"
                        type="button"
                        aria-label="remove course"
                        on:click|stopPropagation={() => removeCourse(course.id)}
                        on:keypress|stopPropagation={() => removeCourse(course.id)}
                    >
                        <span aria-hidden="true">&times;</span>
                    </vscode-button>
                </div>
                <p>{course.description}</p>
                <vscode-button
                    class="open-workspace"
                    appearance="primary"
                    type="button"
                    aria-label="Open workspace"
                    on:click|stopPropagation={() => openWorkspace(course.name)}
                    on:keypress|stopPropagation={() => openWorkspace(course.name)}
                >
                    Open workspace
                </vscode-button>
                <div>
                    <label>
                        {`Programming exercise progress: ${completed}%`}
                        <div>
                            <meter
                                value={course.awardedPoints}
                                min={0}
                                max={course.availablePoints}
                            />
                        </div>
                    </label>
                </div>

                {#if course.disabled}
                    <div role="alert">
                        This course has been disabled. Exercises cannot be downloaded or submitted.
                    </div>
                {:else if course.newExercises.length > 0}
                    <div role="alert">
                        {course.newExercises.length} new exercises found for this course.
                        <vscode-button
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
        {/each}
        {#if $courses.length === 0}
            <div>Add courses to start completing exercises.</div>
        {/if}
    {:else}
        <vscode-progress-ring />
    {/if}
</div>

<style>
    .muted {
        opacity: 90%;
    }
    .add-new-course {
        margin-bottom: 0.4rem;
    }
    .open-workspace {
        margin-bottom: 0.4rem;
    }
    .course {
        cursor: pointer;
        padding: 0.4rem;
        margin-top: 0.4rem;
        margin-bottom: 0.4rem;
        border: 1px;
        border-style: inset;
    }
    .course-header {
        display: flex;
    }
    .course-title {
        flex-grow: 1;
    }
    .data-path {
        white-space: normal;
    }
    .remove-button {
        align-self: start;
        margin: 0.4rem;
    }
</style>
