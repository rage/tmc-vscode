<script lang="ts">
  import { onMount } from "svelte"
  import { writable } from "svelte/store"

  import TextField from "../components/TextField.svelte"
  import { Course, Organization } from "../shared/langsSchema"
  import type { SelectCoursePanel } from "../shared/shared"
  import { assertUnreachable } from "../shared/shared"
  import { addMessageListener, loadable, postMessageToWebview } from "../utilities/script"
  import { vscode } from "../utilities/vscode"

  interface Props {
    panel: SelectCoursePanel
  }

  let { panel }: Props = $props()

  const organization = loadable<Organization>()
  const courses = loadable<Array<Course>>()
  const tmcBackendUrl = loadable<string>()
  const filter = writable<string>("")
  const error = loadable<string>()

  onMount(() => {
    vscode.postMessage({
      type: "requestSelectCourseData",
      sourcePanel: panel,
    })
  })
  // svelte-ignore state_referenced_locally -- the panel identity (id/type)
  // is fixed for the lifetime of the component, capturing the initial value is intended
  addMessageListener(panel, (message) => {
    switch (message.type) {
      case "setOrganization": {
        organization.set(message.organization)
        break
      }
      case "setSelectableCourses": {
        courses.set(message.courses)
        break
      }
      case "setTmcBackendUrl": {
        tmcBackendUrl.set(message.tmcBackendUrl)
        break
      }
      case "requestSelectCourseDataError": {
        error.set(message.error)
        break
      }
      default:
        assertUnreachable(message)
    }
  })

  function resolveLogoPath(backendUrl: string, path: string): string {
    return !path.endsWith("missing.png")
      ? `${backendUrl}${path}`
      : `${backendUrl}/logos/small_logo/missing.png`
  }
  function changeOrganization() {
    vscode.postMessage({
      type: "selectOrganization",
      sourcePanel: panel.requestingPanel,
    })
  }
  function filterCourses(query: string) {
    filter.set(query.toUpperCase())
  }
  function selectCourse(courseId: number) {
    postMessageToWebview({
      type: "selectedCourse",
      target: panel.requestingPanel,
      organizationSlug: panel.organizationSlug,
      courseId,
    })
  }
</script>

{#if $organization !== undefined && $tmcBackendUrl !== undefined}
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
  <vscode-progress-ring></vscode-progress-ring>
{/if}

<div>
  <div>
    <vscode-button
      role="button"
      tabindex="0"
      secondary
      type="button"
      onclick={changeOrganization}
      onkeypress={changeOrganization}
    >
      Change organization
    </vscode-button>
  </div>
</div>

<div>
  <div>
    <h1>Courses</h1>
    <div class="search-container">
      <TextField placeholder="Search courses" onChange={(val) => filterCourses(val)} />
    </div>
  </div>
</div>

{#if $error !== undefined}
  <div>Error: {$error}</div>
{:else if $courses !== undefined}
  <div>
    {#each $courses as course}
      <div
        role="button"
        tabindex="0"
        class="course-row"
        onclick={() => selectCourse(course.id)}
        onkeypress={() => selectCourse(course.id)}
        hidden={$filter.length > 0 &&
          !course.name.toUpperCase().includes($filter) &&
          !course.title.toUpperCase().includes($filter)}
      >
        <div>
          <h3>
            {course.title} <small class="course-slug">({course.name})</small>
          </h3>
          <p>{course.description}</p>
        </div>
      </div>
    {/each}
  </div>
{:else}
  <vscode-progress-ring></vscode-progress-ring>
{/if}

<style>
  .org-img-container {
    padding: 0.4rem;
    width: 100%;
    text-align: center;
    background-color: #d3d3d3;
  }
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
