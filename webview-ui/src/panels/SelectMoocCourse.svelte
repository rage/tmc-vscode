<script lang="ts">
  import { onMount } from "svelte"
  import { writable } from "svelte/store"

  import TextField from "../components/TextField.svelte"
  import { MoocCourse } from "../shared/langsSchema"
  import type { SelectMoocCoursePanel } from "../shared/shared"
  import { assertUnreachable } from "../shared/shared"
  import { addMessageListener, loadable, postMessageToWebview } from "../utilities/script"
  import { vscode } from "../utilities/vscode"

  interface Props {
    panel: SelectMoocCoursePanel
  }

  let { panel }: Props = $props()

  const courses = loadable<Array<MoocCourse>>()
  const error = loadable<string>()
  const filter = writable<string>("")

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
        courses.set(message.courseInstances)
        break
      }
      case "requestSelectMoocCourseDataError": {
        error.set(message.error)
        break
      }
      default:
        assertUnreachable(message)
    }
  })

  function filterCourses(query: string) {
    filter.set(query.toUpperCase())
  }
  // the langs CLI has no course-instance concept, so the course id doubles as the instance id
  function selectCourse(course: MoocCourse) {
    postMessageToWebview({
      type: "selectedMoocCourse",
      target: panel.requestingPanel,
      organizationSlug: course.organization_name,
      courseId: course.id,
      instanceId: course.id,
      courseName: course.name,
      instanceName: null,
    })
  }
</script>

{#if $error !== undefined}
  <div>Error: {$error}</div>
{:else}
  <h1>Enrolled courses</h1>
  <div class="search-container">
    <TextField placeholder="Search enrolled courses" onChange={(val) => filterCourses(val)} />
  </div>

  {#if $courses !== undefined}
    {#if $courses.length > 0}
      <div>
        {#each $courses as course}
          <div
            role="button"
            tabindex="0"
            class="course-row"
            onclick={() => selectCourse(course)}
            onkeypress={() => selectCourse(course)}
            hidden={$filter.length > 0 &&
              !course.name.toUpperCase().includes($filter) &&
              !course.slug.toUpperCase().includes($filter)}
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
        No enrolled courses found that contain TMC exercises. You can enroll on courses at
        https://courses.mooc.fi/.
      </div>
    {/if}
  {:else}
    <vscode-progress-ring></vscode-progress-ring>
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
