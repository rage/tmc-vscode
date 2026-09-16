<script lang="ts">
  import { onMount } from "svelte"

  import Button from "../components/Button.svelte"
  import Card from "../components/Card.svelte"
  import ProgressBar from "../components/ProgressBar.svelte"
  import type {
    LocalCourseData as LocalCourseDataType,
    MyCoursesPanel,
    WebviewError,
  } from "../shared/shared"
  import {
    CourseIdentifier,
    ExerciseIdentifier,
    LocalCourseData,
    assertUnreachable,
    makeMoocKind,
    makeTmcKind,
    match,
    unwrap,
  } from "../shared/shared"
  import { addMessageListener } from "../utilities/script"
  import { vscode } from "../utilities/vscode"

  interface Props {
    panel: MyCoursesPanel
  }

  let { panel = $bindable() }: Props = $props()

  // Set when the extension host answers that it cannot assemble this panel's data;
  // rendered where the course list would be, so a failed load is not a permanent spinner.
  let dataError = $state<WebviewError | undefined>(undefined)

  function requestData() {
    dataError = undefined
    vscode.postMessage({
      type: "requestMyCoursesData",
      // `panel` is a `$state` proxy once a message has reassigned it; snapshot it or
      // posting fails structured clone with a `DataCloneError`
      sourcePanel: $state.snapshot(panel),
    })
  }

  onMount(requestData)
  // props aren't deeply reactive in Svelte 5, so panel is reassigned rather than mutated
  addMessageListener(panel, (message) => {
    switch (message.type) {
      case "setMyCourses": {
        panel = { ...panel, courses: message.courses }
        break
      }
      case "setTmcDataPath": {
        panel = { ...panel, tmcDataPath: message.tmcDataPath }
        break
      }
      case "setTmcDataSize": {
        panel = { ...panel, tmcDataSize: message.tmcDataSize }
        break
      }
      case "setNewExercises": {
        replaceCourse(message.courseId, (course) =>
          match(
            course,
            (tmc) =>
              makeTmcKind({
                ...tmc,
                newExercises: message.exerciseIds.flatMap((id) =>
                  id.kind === "tmc" ? [id.data.tmcExerciseId] : [],
                ),
              }),
            (mooc) =>
              makeMoocKind({
                ...mooc,
                newExercises: message.exerciseIds.flatMap((id) =>
                  id.kind === "mooc" ? [id.data.moocExerciseId] : [],
                ),
              }),
          ),
        )
        break
      }
      case "panelDataError": {
        dataError = message.error
        break
      }
      case "setCourseDisabledStatus": {
        replaceCourse(message.courseId, (course) =>
          match(
            course,
            (tmc) => makeTmcKind({ ...tmc, disabled: message.disabled }),
            (mooc) => makeMoocKind({ ...mooc, disabled: message.disabled }),
          ),
        )
        break
      }
      default:
        assertUnreachable(message)
    }
  })

  function replaceCourse(
    courseId: CourseIdentifier,
    replacement: (course: LocalCourseDataType) => LocalCourseDataType,
  ) {
    const courseKey = CourseIdentifier.toString(courseId)
    panel = {
      ...panel,
      courses: (panel.courses ?? []).map((course) =>
        CourseIdentifier.toString(LocalCourseData.getCourseId(course)) === courseKey
          ? replacement(course)
          : course,
      ),
    }
  }
  function addNewCourse() {
    vscode.postMessage({
      type: "addNewCourse",
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

        <!-- The region stays mounted and empty until there is something to say: a screen
             reader announces a change inside a region it already knows, not one inserted
             already populated. -->
        <div role="alert">
          {#if courseData.disabled}
            This course has been disabled. Exercises cannot be downloaded or submitted.
          {:else if courseData.newExercises.length > 0}
            {courseData.newExercises.length} new exercises found for this course.
            <Button
              onclick={() => downloadExercises(LocalCourseData.getNewExercises(course), courseId)}
            >
              Download them!
            </Button>
            <Button aria-label="Close" onclick={() => clearNewExercises(courseId)}>
              <vscode-icon name="close" aria-hidden="true"></vscode-icon>
            </Button>
          {/if}
        </div>
      </Card>
    {/each}
    {#if panel.courses.length === 0}
      <div>Add courses to start completing exercises.</div>
    {/if}
  {:else if dataError}
    <div role="alert">
      <h2>Could not load your courses</h2>
      <div class="error-message">{dataError.message}</div>
      {#if dataError.details}
        <code>{dataError.details}</code>
      {/if}
    </div>
    <Button onclick={requestData}>Retry</Button>
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
  .error-message,
  code {
    white-space: pre-wrap;
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
