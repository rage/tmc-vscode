<script lang="ts">
    import { writable } from "svelte/store";
    import { SelectMoocCoursePanel, assertUnreachable } from "../shared/shared";
    import { addMessageListener, loadable, postMessageToWebview } from "../utilities/script";
    import { vscode } from "../utilities/vscode";
    import { CourseInstance } from "../shared/langsSchema";
    import TextField from "../components/TextField.svelte";
    import { onMount } from "svelte";

    export let panel: SelectMoocCoursePanel;

    const instances = loadable<Array<CourseInstance>>();
    const error = loadable<string>();
    const filter = writable<string>("");

    onMount(() => {
        vscode.postMessage({
            type: "requestSelectMoocCourseData",
            sourcePanel: panel,
        });
    });
    addMessageListener(panel, (message) => {
        switch (message.type) {
            case "setSelectMoocCourseData": {
                instances.set(message.courseInstances);
                break;
            }
            case "requestSelectMoocCourseDataError": {
                error.set(message.error);
                break;
            }
            default:
                assertUnreachable(message);
        }
    });

    function filterCourses(query: string) {
        filter.set(query.toUpperCase());
    }
    function selectCourse(
        courseId: string,
        instanceId: string,
        courseName: string,
        instanceName: string | null,
    ) {
        postMessageToWebview({
            type: "selectedMoocCourse",
            target: panel.requestingPanel,
            courseId,
            instanceId,
            courseName,
            instanceName,
        });
    }
</script>

{#if $error !== undefined}
    <div>Error: {$error}</div>
{:else}
    <h1>Enrolled courses</h1>
    <div class="search-container">
        <TextField placeholder="Search enrolled courses" onChange={(val) => filterCourses(val)} />
    </div>

    {#if $instances !== undefined}
        {#if $instances.length > 0}
            <div>
                {#each $instances as instance}
                    <div
                        role="button"
                        tabindex="0"
                        class="course-row"
                        on:click={() =>
                            selectCourse(
                                instance.course_id,
                                instance.id,
                                instance.course_name,
                                instance.instance_name,
                            )}
                        on:keypress={() =>
                            selectCourse(
                                instance.course_id,
                                instance.id,
                                instance.course_name,
                                instance.instance_name,
                            )}
                        hidden={$filter.length > 0 &&
                            !instance.course_name.toUpperCase().includes($filter) &&
                            !instance.instance_name?.toUpperCase().includes($filter)}
                    >
                        <div>
                            <h3>
                                {instance.course_name}
                                <small class="course-slug"
                                    >({instance.instance_name || "default instance"})
                                </small>
                            </h3>
                            <p>{instance.course_description}</p>
                            {#if instance.instance_description}
                                <p>{instance.instance_description}</p>
                            {/if}
                        </div>
                    </div>
                {/each}
            </div>
        {:else}
            <div>
                No enrolled courses found that contain TMC exercises. You can enroll on courses at
                https://courses.mooc.fi/.
            </div>
        {/if}
    {:else}
        <vscode-progress-ring />
    {/if}
{/if}

<style>
    .course-row {
        border: 1px;
        border-style: inset;
        cursor: pointer;
        padding: 0.4rem;
        margin-bottom: 1rem;
    }
    .course-slug {
        opacity: 80%;
        word-wrap: break-word;
    }
    .search-container {
        padding: 0.4rem;
        margin-bottom: 0.4rem;
    }

    [hidden] {
        display: none;
    }
</style>
