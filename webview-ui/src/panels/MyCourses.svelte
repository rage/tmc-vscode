<script lang="ts">
  import { onMount } from "svelte"

  import Button from "../components/Button.svelte"
  import Card from "../components/Card.svelte"
  import ProgressBar from "../components/ProgressBar.svelte"
  import type { LocalCourseData as LocalCourseDataType, MyCoursesPanel } from "../shared/shared"
  import {
    CourseIdentifier,
    ExerciseIdentifier,
    LocalCourseData,
    assertUnreachable,
    makeTmcKind,
    match,
    unwrap,
  } from "../shared/shared"
  import { addMessageListener, savePanelState } from "../utilities/script"
  import { vscode } from "../utilities/vscode"

  interface Props {
    panel: MyCoursesPanel
  }

  let { panel = $bindable() }: Props = $props()

  onMount(() => {
    vscode.postMessage({
      type: "requestMyCoursesData",
      sourcePanel: panel,
    })
  })
  // props aren't deeply reactive in Svelte 5, so panel is reassigned rather than mutated
  addMessageListener(panel, (message) => {
    switch (message.type) {
      case "setMyCourses": {
        panel = { ...panel, courses: message.courses }
        savePanelState(panel)
        break
      }
      case "setTmcDataPath": {
        panel = { ...panel, tmcDataPath: message.tmcDataPath }
        savePanelState(panel)
        break
      }
      case "setTmcDataSize": {
        panel = { ...panel, tmcDataSize: message.tmcDataSize }
        savePanelState(panel)
        break
      }
      case "selectedOrganization": {
        vscode.postMessage({
          type: "selectCourse",
          sourcePanel: { id: panel.id, type: panel.type },
          slug: message.slug,
        })
        break
      }
      case "selectedCourse": {
        // Extension closes the selection side panel only on success, so a failed add
        // leaves it open for retry.
        vscode.postMessage({
          type: "addCourse",
          organizationSlug: message.organizationSlug,
          // the tmc course selection sends a plain tmc course id
          courseId: makeTmcKind({ courseId: message.courseId }),
          requestingPanel: { id: panel.id, type: panel.type },
        })
        break
      }
      case "selectedMoocCourse": {
        vscode.postMessage({
          type: "addMoocCourse",
          instanceId: message.instanceId,
          courseName: message.courseName,
          requestingPanel: { id: panel.id, type: panel.type },
        })
        break
      }
      case "setNewExercises": {
        const course = findCourse(message.courseId)
        if (course) {
          match(
            course,
            (tmc) => {
              tmc.newExercises = message.exerciseIds.flatMap((id) =>
                id.kind === "tmc" ? [id.data.tmcExerciseId] : [],
              )
            },
            (mooc) => {
              mooc.newExercises = message.exerciseIds.flatMap((id) =>
                id.kind === "mooc" ? [id.data.moocExerciseId] : [],
              )
            },
          )
          panel = { ...panel }
          savePanelState(panel)
        }
        break
      }
      case "setCourseDisabledStatus": {
        const course = findCourse(message.courseId)
        if (course) {
          unwrap(course).disabled = message.disabled
          panel = { ...panel }
          savePanelState(panel)
        }
        break
      }
      case "setNextCourseDeadline": {
        panel = {
          ...panel,
          courseDeadlines: {
            ...panel.courseDeadlines,
            [CourseIdentifier.toString(message.courseId)]: message.deadline,
          },
        }
        savePanelState(panel)
        break
      }
      default:
        assertUnreachable(message)
    }
  })

  function findCourse(courseId: CourseIdentifier): LocalCourseDataType | undefined {
    const courseKey = CourseIdentifier.toString(courseId)
    return (panel.courses ?? []).find(
      (c) => CourseIdentifier.toString(LocalCourseData.getCourseId(c)) === courseKey,
    )
  }
  function addNewCourse() {
    vscode.postMessage({
      type: "selectPlatform",
      // only `{id, type}` is expected by the schema; the full `panel` prop is `$state`-backed
      // and risks a `DataCloneError` once reassigned (e.g. by `setMyCourses`)
      sourcePanel: { id: panel.id, type: panel.type },
    })
  }
  function changeTmcDataPath() {
    vscode.postMessage({
      type: "changeTmcDataPath",
    })
  }
  function openCourseDetails(courseId: CourseIdentifier) {
    vscode.postMessage({
      type: "openCourseDetails",
      courseId,
    })
  }
  function removeCourse(id: CourseIdentifier) {
    vscode.postMessage({
      type: "removeCourse",
      id,
    })
  }
  function openWorkspace(name: string, backend: "tmc" | "mooc") {
    vscode.postMessage({
      type: "openCourseWorkspace",
      courseName: name,
      backend,
    })
  }
  function downloadExercises(ids: Array<ExerciseIdentifier>, courseId: CourseIdentifier) {
    vscode.postMessage({
      type: "downloadExercises",
      ids,
      courseId,
      mode: "download",
    })
  }
  function clearNewExercises(courseId: CourseIdentifier) {
    vscode.postMessage({
      type: "clearNewExercises",
      courseId,
    })
  }
</script>

<div>
  <h1>My courses</h1>

  <div class="top-container">
    <div>
      <div>
        Currently your exercises ({panel.tmcDataSize ?? "loading size…"}) are located at:
        <span class="data-path">{panel.tmcDataPath ?? "loading path…"}</span>
      </div>
      <Button class="change-path-button" secondary onclick={changeTmcDataPath}>Change path</Button>
    </div>
  </div>

  {#if panel.courses !== undefined}
    {#each panel.courses as course}
      {@const courseData = unwrap(course)}
      {@const courseId = LocalCourseData.getCourseId(course)}
      {@const completed =
        courseData.availablePoints > 0
          ? ((courseData.awardedPoints / courseData.availablePoints) * 100).toFixed(2)
          : "0.00"}
      <Card>
        <div class="course-header">
          <h3 class="course-title">
            <!-- A native button avoids nesting interactive controls inside an interactive
                 ancestor, which would collapse the whole card into one giant "button" for AT. -->
            <button
              type="button"
              class="course-title-button"
              onclick={() => openCourseDetails(courseId)}
            >
              {courseData.title} <small class="muted">({courseData.name})</small>
            </button>
          </h3>
          <Button
            class="remove-button"
            secondary
            aria-label="remove course"
            onclick={() => removeCourse(courseId)}
          >
            <vscode-icon name="close" aria-hidden="true"></vscode-icon>
          </Button>
        </div>
        {#if courseData.description}
          <p class="course-description">{courseData.description}</p>
        {/if}
        <div class="progress-bar-container">
          <ProgressBar
            label={`Programming exercise progress: ${completed}%`}
            value={courseData.awardedPoints}
            max={courseData.availablePoints}
          />
        </div>
        <Button
          aria-label="Open workspace"
          onclick={() => openWorkspace(courseData.name, course.kind)}
        >
          Open workspace
        </Button>

        {#if courseData.disabled}
          <div role="alert">
            This course has been disabled. Exercises cannot be downloaded or submitted.
          </div>
        {:else if courseData.newExercises.length > 0}
          <div role="alert">
            {courseData.newExercises.length} new exercises found for this course.
            <Button
              onclick={() => downloadExercises(LocalCourseData.getNewExercises(course), courseId)}
            >
              Download them!
            </Button>
            <Button aria-label="Close" onclick={() => clearNewExercises(courseId)}>
              <vscode-icon name="close" aria-hidden="true"></vscode-icon>
            </Button>
          </div>
        {/if}
      </Card>
    {/each}
    {#if panel.courses.length === 0}
      <div>Add courses to start completing exercises.</div>
    {/if}
  {:else}
    <vscode-progress-ring aria-label="Loading"></vscode-progress-ring>
  {/if}
</div>

<div class="add-new-course-container">
  <Button class="add-new-course" onclick={addNewCourse}>Add new course</Button>
</div>

<style>
  .muted {
    opacity: 90%;
  }
  /* targets the <vscode-button> rendered inside the Button wrapper */
  .add-new-course-container :global(.add-new-course) {
    margin-bottom: 0.4rem;
  }
  .course-header {
    display: flex;
  }
  .course-title {
    margin-top: 0.2rem;
    flex-grow: 1;
  }
  /* Resets the native button to look like plain heading text. */
  .course-title-button {
    all: unset;
    cursor: pointer;
    color: inherit;
    font: inherit;
    display: inline;
  }
  .course-title-button:hover {
    text-decoration: underline;
  }
  .course-title-button:focus-visible {
    outline: 1px solid var(--vscode-focusBorder, #007fd4);
    outline-offset: 2px;
  }
  .data-path {
    white-space: normal;
    font-family: monospace;
  }
  .top-container :global(.change-path-button) {
    margin-top: 0.4rem;
  }
  .course-header :global(.remove-button) {
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
    .add-new-course-container :global(.add-new-course) {
      margin-bottom: 0rem;
    }
    .top-container {
      grid-auto-flow: column;
    }
  }
</style>
