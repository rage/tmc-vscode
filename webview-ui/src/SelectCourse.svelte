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
        filter.set(query);
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

<div>
    {#if $organization && $tmcBackendUrl}
        <div class="org">
            <div>
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
    {#if $courses}
        <div>
            <div>
                {#each $courses as course}
                    <div
                        class="row org-row border-current-color course"
                        on:click={() => selectCourse(course.id)}
                        on:keypress={() => selectCourse(course.id)}
                        hidden={$filter.length > 0 &&
                            !course.name.toUpperCase().includes($filter.toUpperCase())}
                    >
                        <div class="col-md">
                            <h3>
                                {course.title} <small class="text-muted">({course.name})</small>
                            </h3>
                            <p>{course.description}</p>
                        </div>
                    </div>
                {/each}
            </div>
        </div>
    {/if}
</div>
