<script lang="ts">
  import { onMount } from "svelte"

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
  import { addMessageListener, loadable, savePanelState } from "../utilities/script"
  import { vscode } from "../utilities/vscode"

  interface Props {
    panel: MyCoursesPanel
  }

  let { panel = $bindable() }: Props = $props()

  const selectedOrganizationSlug = loadable<string>()

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
        selectedOrganizationSlug.set(message.slug)
        vscode.postMessage({
          type: "selectCourse",
          sourcePanel: { id: panel.id, type: panel.type },
          slug: message.slug,
        })
        break
      }
      case "selectedCourse": {
        vscode.postMessage({
          type: "addCourse",
          organizationSlug: message.organizationSlug,
          // the tmc course selection sends a plain tmc course id
          courseId: makeTmcKind({ courseId: message.courseId }),
          requestingPanel: { id: panel.id, type: panel.type },
        })
        // todo: only close side panel on success
        vscode.postMessage({
          type: "closeSidePanel",
        })
        break
      }
      case "selectedMoocCourse": {
        vscode.postMessage({
          type: "addMoocCourse",
          organizationSlug: message.organizationSlug,
          courseId: message.courseId,
          instanceId: message.instanceId,
          courseName: message.courseName,
          instanceName: message.instanceName,
          requestingPanel: { id: panel.id, type: panel.type },
        })
        // todo: only close side panel on success
        vscode.postMessage({
          type: "closeSidePanel",
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
  function openWorkspace(name: string) {
    vscode.postMessage({
      type: "openCourseWorkspace",
      courseName: name,
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
  <h1>My Courses</h1>

  <div class="top-container">
    <div>
      <div>
        Currently your exercises ({panel.tmcDataSize ?? "loading size..."}) are located at:
        <span class="data-path">{panel.tmcDataPath ?? "loading path..."}</span>
      </div>
      <vscode-button
        role="button"
        tabindex="0"
        class="change-path-button"
        secondary
        onclick={changeTmcDataPath}
        onkeypress={changeTmcDataPath}
      >
        Change path
      </vscode-button>
    </div>
  </div>

  {#if panel.courses !== undefined}
    {#each panel.courses as course}
      {@const courseData = unwrap(course)}
      {@const courseId = LocalCourseData.getCourseId(course)}
      {@const completed = ((courseData.awardedPoints / courseData.availablePoints) * 100).toFixed(
        2,
      )}
      <Card>
        <div
          role="button"
          tabindex="0"
          onclick={() => {
            openCourseDetails(courseId)
          }}
          onkeypress={() => {
            openCourseDetails(courseId)
          }}
        >
          <div class="course-header">
            <h3 class="course-title">
              {courseData.title} <small class="muted">({courseData.name})</small>
            </h3>
            <vscode-button
              role="button"
              tabindex="0"
              class="remove-button"
              secondary
              type="button"
              aria-label="remove course"
              onclick={(e: Event) => {
                e.stopPropagation()
                removeCourse(courseId)
              }}
              onkeypress={(e: Event) => {
                e.stopPropagation()
                removeCourse(courseId)
              }}
            >
              ×
            </vscode-button>
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
          <vscode-button
            role="button"
            tabindex="0"
            type="button"
            aria-label="Open workspace"
            onclick={(e: Event) => {
              e.stopPropagation()
              openWorkspace(courseData.name)
            }}
            onkeypress={(e: Event) => {
              e.stopPropagation()
              openWorkspace(courseData.name)
            }}
          >
            Open workspace
          </vscode-button>

          {#if courseData.disabled}
            <div role="alert">
              This course has been disabled. Exercises cannot be downloaded or submitted.
            </div>
          {:else if courseData.newExercises.length > 0}
            <div role="alert">
              {courseData.newExercises.length} new exercises found for this course.
              <vscode-button
                role="button"
                tabindex="0"
                type="button"
                onclick={() => {
                  downloadExercises(LocalCourseData.getNewExercises(course), courseId)
                }}
                onkeypress={() => {
                  downloadExercises(LocalCourseData.getNewExercises(course), courseId)
                }}
              >
                Download them!
              </vscode-button>
              <vscode-button
                role="button"
                tabindex="0"
                type="button"
                aria-label="Close"
                onclick={() => clearNewExercises(courseId)}
                onkeypress={() => clearNewExercises(courseId)}
              >
                ×
              </vscode-button>
            </div>
          {/if}
        </div>
      </Card>
    {/each}
    {#if panel.courses.length === 0}
      <div>Add courses to start completing exercises.</div>
    {/if}
  {:else}
    <vscode-progress-ring></vscode-progress-ring>
  {/if}
</div>

<div class="add-new-course-container">
  <vscode-button
    role="button"
    tabindex="0"
    class="add-new-course"
    type="button"
    onclick={addNewCourse}
    onkeypress={addNewCourse}
  >
    Add new course
  </vscode-button>
</div>

<style>
  .muted {
    opacity: 90%;
  }
  .add-new-course {
    margin-bottom: 0.4rem;
  }
  .course-header {
    display: flex;
  }
  .course-title {
    margin-top: 0.2rem;
    flex-grow: 1;
  }
  .data-path {
    white-space: normal;
    font-family: monospace;
  }
  .change-path-button {
    margin-top: 0.4rem;
  }
  .remove-button {
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
    .add-new-course {
      margin-bottom: 0rem;
    }
    .top-container {
      grid-auto-flow: column;
    }
  }
</style>
