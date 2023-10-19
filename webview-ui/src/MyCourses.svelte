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

<div class="container">
    <div>
        <div>
            <h1>My Courses</h1>
            <div>
                <vscode-button
                    appearance="secondary"
                    type="button"
                    on:click={addNewCourse}
                    on:keypress={addNewCourse}
                >
                    Add new course
                </vscode-button>
            </div>
        </div>
    </div>

    <div>
        <h5>TMC Exercises Location</h5>
        <div>
            Currently your exercises ({$tmcDataSize}) are located at:
        </div>
        <pre>{$tmcDataPath}</pre>
        <vscode-button
            appearance="secondary"
            on:click={changeTmcDataPath}
            on:keypress={changeTmcDataPath}
        >
            Change path
        </vscode-button>
    </div>

    {#each $courses ?? [] as course}
        {@const completedPrc = (course.awardedPoints / course.availablePoints) * 100}
        <div
            class="org-row border-current-color"
            on:click={() => {
                openCourseDetails(course.id);
            }}
            on:keypress={() => {
                openCourseDetails(course.id);
            }}
        >
            <div>
                <vscode-button
                    appearance="secondary"
                    type="button"
                    class="close"
                    aria-label="remove course"
                    on:click|stopPropagation={() => removeCourse(course.id)}
                    on:keypress|stopPropagation={() => removeCourse(course.id)}
                >
                    <span aria-hidden="true">&times;</span>
                </vscode-button>
                <h3>
                    {course.title} <small class="text-muted">{course.name}</small>
                </h3>
                <p>{course.description}</p>
                <div>
                    <div>
                        <!-- todo: spinner -->
                    </div>
                    <div>
                        <vscode-button
                            appearance="primary"
                            type="button"
                            aria-label="Open workspace"
                            on:click|stopPropagation={() => openWorkspace(course.name)}
                            on:keypress|stopPropagation={() => openWorkspace(course.name)}
                        >
                            Open workspace
                        </vscode-button>
                    </div>
                </div>
                <div>
                    Programming exercise progress:
                    <div class="progress">
                        <div
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
                            class="close"
                            aria-label="Close"
                            on:click={() => clearNewExercises(course.id)}
                            on:keypress={() => clearNewExercises(course.id)}
                        >
                            ×
                        </vscode-button>
                    </div>
                {/if}
            </div>
        </div>
    {/each}
    {#if $courses?.length === 0}
        <div>
            <div>Add courses to start completing exercises.</div>
        </div>
    {/if}
</div>
