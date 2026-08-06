<script lang="ts">
  import { onMount } from "svelte"

  import Button from "../components/Button.svelte"
  import TextField from "../components/TextField.svelte"
  import { Course, Organization } from "../shared/langsSchema"
  import type { SelectCoursePanel } from "../shared/shared"
  import { assertUnreachable } from "../shared/shared"
  import { addMessageListener, postMessageToWebview, resolveLogoPath } from "../utilities/script"
  import { vscode } from "../utilities/vscode"

  interface Props {
    panel: SelectCoursePanel
  }

  let { panel }: Props = $props()

  let organization = $state<Organization | undefined>(undefined)
  let courses = $state<Array<Course> | undefined>(undefined)
  let tmcBackendUrl = $state<string | undefined>(undefined)
  let filter = $state<string>("")
  let error = $state<string | undefined>(undefined)

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
        organization = message.organization
        break
      }
      case "setSelectableCourses": {
        courses = message.courses
        break
      }
      case "setTmcBackendUrl": {
        tmcBackendUrl = message.tmcBackendUrl
        break
      }
      case "requestSelectCourseDataError": {
        error = message.error
        break
      }
      default:
        assertUnreachable(message)
    }
  })

  function changeOrganization() {
    vscode.postMessage({
      type: "selectOrganization",
      sourcePanel: panel.requestingPanel,
    })
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

{#if error !== undefined}
  <div class="error" role="alert">Error: {error}</div>
{:else}
  {#if organization !== undefined && tmcBackendUrl !== undefined}
    <div class="org">
      <div class="org-img-container">
        <img
          class="org-img"
          src={resolveLogoPath(tmcBackendUrl, organization.logo_path)}
          alt={`Logo for ${organization.name}`}
        />
      </div>
      <div>
        <h1>{organization.name}</h1>
        <p>{organization.information}</p>
      </div>
    </div>
  {:else}
    <vscode-progress-ring aria-label="Loading"></vscode-progress-ring>
  {/if}

  <div>
    <div>
      <Button secondary onclick={changeOrganization}>Change organization</Button>
    </div>
  </div>

  <div>
    <div>
      <h2>Courses</h2>
      <div class="search-container">
        <TextField
          label="Search courses"
          placeholder="Search courses"
          icon="search"
          bind:value={filter}
        />
      </div>
    </div>
  </div>

  {#if courses !== undefined}
    {#if courses.length > 0}
      <div>
        {#each courses as course}
          <div
            role="button"
            tabindex="0"
            class="course-row"
            onclick={() => selectCourse(course.id)}
            onkeypress={() => selectCourse(course.id)}
            hidden={filter.length > 0 &&
              !course.name.toUpperCase().includes(filter.toUpperCase()) &&
              !course.title.toUpperCase().includes(filter.toUpperCase())}
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
      <div>No courses found for this organization.</div>
    {/if}
  {:else}
    <vscode-progress-ring aria-label="Loading"></vscode-progress-ring>
  {/if}
{/if}

<style>
  .org-img-container {
    padding: 0.4rem;
    width: 100%;
    text-align: center;
    background-color: var(--vscode-editorWidget-background, #d3d3d3);
  }
  .course-row {
    border: 1px solid var(--vscode-widget-border, transparent);
    border-radius: 0.4rem;
    cursor: pointer;
    padding: 0.4rem;
    margin-bottom: 1rem;
  }
  .course-row:hover {
    background-color: var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.1));
  }
  .course-row:focus-visible {
    outline: 1px solid var(--vscode-focusBorder, #007fd4);
    outline-offset: 2px;
  }
  .error {
    color: var(--vscode-notebookStatusErrorIcon-foreground, #f85149);
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
