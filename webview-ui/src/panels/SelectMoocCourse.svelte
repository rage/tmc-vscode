<script lang="ts">
  import { onMount } from "svelte"

  import TextField from "../components/TextField.svelte"
  import { MoocCourse } from "../shared/langsSchema"
  import type { SelectMoocCoursePanel } from "../shared/shared"
  import { assertUnreachable } from "../shared/shared"
  import { addMessageListener, postMessageToWebview } from "../utilities/script"
  import { vscode } from "../utilities/vscode"

  interface Props {
    panel: SelectMoocCoursePanel
  }

  let { panel }: Props = $props()

  let courses = $state<Array<MoocCourse> | undefined>(undefined)
  let error = $state<string | undefined>(undefined)
  let filter = $state<string>("")

  onMount(() => {
    vscode.postMessage({
      type: "requestSelectMoocCourseData",
      sourcePanel: panel,
    })
  })
  // svelte-ignore state_referenced_locally -- the panel identity (id/type)
  // is fixed for the lifetime of the component, capturing the initial value is intended
  addMessageListener(panel, (message) => {
    switch (message.type) {
      case "setSelectMoocCourseData": {
        courses = message.courseInstances
        break
      }
      case "requestSelectMoocCourseDataError": {
        error = message.error
        break
      }
      default:
        assertUnreachable(message)
    }
  })

  // the langs CLI has no course-instance concept, so the course id doubles as the instance id
  function selectCourse(course: MoocCourse) {
    postMessageToWebview({
      type: "selectedMoocCourse",
      target: panel.requestingPanel,
      instanceId: course.id,
      courseName: course.name,
    })
  }
</script>

{#if error !== undefined}
  <div class="error" role="alert">Error: {error}</div>
{:else}
  <h1>Enrolled courses</h1>
  <p class="explainer">
    These are the courses you're enrolled in on courses.mooc.fi. To add another, enroll in it at
    <a href="https://courses.mooc.fi/">courses.mooc.fi</a> first, then reopen this list.
  </p>
  <div class="search-container">
    <TextField
      label="Search enrolled courses"
      placeholder="Search enrolled courses"
      icon="search"
      bind:value={filter}
    />
  </div>

  {#if courses !== undefined}
    {#if courses.length > 0}
      <div>
        {#each courses as course}
          <div
            role="button"
            tabindex="0"
            class="course-row"
            onclick={() => selectCourse(course)}
            onkeypress={() => selectCourse(course)}
            hidden={filter.length > 0 &&
              !course.name.toUpperCase().includes(filter.toUpperCase()) &&
              !course.slug.toUpperCase().includes(filter.toUpperCase())}
          >
            <div>
              <h3>
                {course.name}
                <small class="course-slug">({course.slug})</small>
              </h3>
              {#if course.description}
                <p>{course.description}</p>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <div>
        No enrolled courses found. You can enroll on courses at
        <a href="https://courses.mooc.fi/">courses.mooc.fi</a>.
      </div>
    {/if}
  {:else}
    <vscode-progress-ring aria-label="Loading"></vscode-progress-ring>
  {/if}
{/if}

<style>
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
  .course-slug {
    opacity: 80%;
    word-wrap: break-word;
  }
  .search-container {
    padding: 0.4rem;
    margin-bottom: 0.4rem;
  }
  .explainer {
    padding: 0 0.4rem;
    opacity: 80%;
  }
  .error {
    color: var(--vscode-notebookStatusErrorIcon-foreground, #f85149);
  }

  [hidden] {
    display: none;
  }
</style>
