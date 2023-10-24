<script lang="ts">
    import { writable } from "svelte/store";
    import { Course, Organization, SelectCoursePanel, assertUnreachable } from "./shared";
    import {
        addExtensionMessageListener,
        loadable,
        postMessageToWebview,
    } from "./utilities/script";
    import { vscode } from "./utilities/vscode";

    export let panel: SelectCoursePanel;

    const organization = loadable<Organization>();
    const courses = loadable<Array<Course>>();
    const tmcBackendUrl = loadable<string>();
    const filter = writable<string>("");

    function resolveLogoPath(tmcBackendUrl: string, path: string): string {
        return !path.endsWith("missing.png")
            ? `${tmcBackendUrl}${path}`
            : `${tmcBackendUrl}/logos/small_logo/missing.png`;
    }

    function changeOrganization() {
        vscode.postMessage({
            type: "selectOrganization",
            sourcePanel: panel.requestingPanel,
        });
    }

    function filterCourses(query: string) {
        filter.set(query.toUpperCase());
    }

    function selectCourse(courseId: number) {
        postMessageToWebview(panel.requestingPanel, {
            type: "selectedCourse",
            organizationSlug: panel.organizationSlug,
            courseId,
        });
    }

    addExtensionMessageListener(panel, (message) => {
        switch (message.type) {
            case "setOrganization": {
                organization.set(message.organization);
                break;
            }
            case "setCourses": {
                courses.set(message.courses);
                break;
            }
            case "setTmcBackendUrl": {
                tmcBackendUrl.set(message.tmcBackendUrl);
                break;
            }
            default:
                assertUnreachable(message);
        }
    });
</script>

{#if $organization && $tmcBackendUrl}
    <div class="org">
        <div class="org-img-container">
            <img
                class="org-img"
                src={resolveLogoPath($tmcBackendUrl, $organization.logo_path)}
                alt={`Logo for ${$organization.name}`}
            />
        </div>
        <div>
            <h1>{$organization.name}</h1>
            <p>{$organization.information}</p>
        </div>
    </div>
{:else}
    <vscode-progress-ring />
{/if}

<div>
    <div>
        <vscode-button
            appearance="secondary"
            type="button"
            on:click={changeOrganization}
            on:keypress={changeOrganization}
        >
            Change organization
        </vscode-button>
    </div>
</div>

<div>
    <div>
        <h1>Courses</h1>
        <div>
            <input
                type="text"
                placeholder="Search courses"
                on:keyup={(ev) => filterCourses(ev.currentTarget.value)}
            />
        </div>
    </div>
</div>

{#if $courses !== undefined}
    <div>
        {#each $courses as course}
            <div
                class="course-row"
                on:click={() => selectCourse(course.id)}
                on:keypress={() => selectCourse(course.id)}
                hidden={$filter.length > 0 &&
                    !course.name.toUpperCase().includes($filter) &&
                    !course.title.toUpperCase().includes($filter)}
            >
                <div>
                    <h3>
                        {course.title} <small class="muted">({course.name})</small>
                    </h3>
                    <p>{course.description}</p>
                </div>
            </div>
        {/each}
    </div>
{:else}
    <vscode-progress-ring />
{/if}

<style>
    .org-img-container {
        padding: 0.4rem;
        width: 100%;
        text-align: center;
        background-color: white;
    }
    .course-row {
        border: 1px;
        border-style: inset;
        cursor: pointer;
        padding: 0.4rem;
        margin-top: 0.4rem;
        margin-bottom: 0.4rem;
    }
    .muted {
        opacity: 80%;
    }

    [hidden] {
        display: none;
    }
</style>
