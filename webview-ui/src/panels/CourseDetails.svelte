<script lang="ts">
  import { onMount } from "svelte"
  import { writable } from "svelte/store"

  import ExercisePart from "../components/ExercisePart.svelte"
  import type { CourseDetailsPanel, TmcExerciseId, MoocExerciseId } from "../shared/shared"
  import {
    assertUnreachable,
    makeMoocKind,
    makeTmcKind,
    match,
    unwrap,
    CourseIdentifier,
    ExerciseIdentifier,
  } from "../shared/shared"
  import { addMessageListener, savePanelState } from "../utilities/script"
  import { vscode } from "../utilities/vscode"

  interface Props {
    panel: CourseDetailsPanel
  }

  let { panel = $bindable() }: Props = $props()

  const totalDownloading = writable<number>(0)
  const refreshing = writable<boolean>(false)
  let checkedExercises = $state<{
    tmc: Record<TmcExerciseId, boolean>
    mooc: Record<MoocExerciseId, boolean>
  }>({ tmc: {}, mooc: {} })
  const checkedExercisesCount = $derived(
    [...Object.values(checkedExercises.tmc), ...Object.values(checkedExercises.mooc)].filter(
      Boolean,
    ).length,
  )
  // common course fields, independent of the course's backend
  const course = $derived(panel.course === undefined ? undefined : unwrap(panel.course))

  onMount(() => {
    vscode.postMessage({
      type: "requestCourseDetailsData",
      sourcePanel: panel,
    })
  })
  // note: props are not deeply reactive in Svelte 5,
  // so the panel is reassigned rather than mutated
  addMessageListener(panel, (message) => {
    switch (message.type) {
      case "setCourseData": {
        panel = { ...panel, course: message.courseData }
        break
      }
      case "setCourseGroups": {
        panel = {
          ...panel,
          offlineMode: message.offlineMode,
          exerciseGroups: message.exerciseGroups,
        }
        break
      }
      case "setCourseDisabledStatus": {
        const isThisCourse =
          CourseIdentifier.toString(message.courseId) === CourseIdentifier.toString(panel.courseId)
        if (isThisCourse && panel.course) {
          const updatedCourse = match(
            panel.course,
            (tmc) => makeTmcKind({ ...tmc, disabled: message.disabled }),
            (mooc) => makeMoocKind({ ...mooc, disabled: message.disabled }),
          )
          panel = { ...panel, course: updatedCourse }
        }
        break
      }
      case "exerciseStatusChange": {
        const exerciseStatuses = match(
          message.exerciseId,
          (tmc) => ({
            ...panel.exerciseStatuses,
            tmc: {
              ...panel.exerciseStatuses.tmc,
              [tmc.tmcExerciseId]: message.status,
            },
          }),
          (mooc) => ({
            ...panel.exerciseStatuses,
            mooc: {
              ...panel.exerciseStatuses.mooc,
              [mooc.moocExerciseId]: message.status,
            },
          }),
        )
        panel = { ...panel, exerciseStatuses }
        savePanelState(panel)
        break
      }
      case "setUpdateables": {
        panel = { ...panel, updateableExercises: message.exerciseIds }
        break
      }
      default:
        assertUnreachable(message)
    }
    savePanelState(panel)
  })

  function openMyCourses() {
    vscode.postMessage({
      type: "openMyCourses",
    })
  }
  function refresh(id: CourseIdentifier) {
    refreshing.set(true)
    vscode.postMessage({
      type: "refreshCourseDetails",
      id,
      useCache: false,
    })
  }
  function openWorkspace(p: CourseDetailsPanel) {
    if (p.course === undefined) {
      return
    }
    match(
      p.course,
      (tmc) => {
        vscode.postMessage({
          type: "openCourseWorkspace",
          courseName: tmc.name,
        })
      },
      () => {
        throw new Error("todo")
      },
    )
  }
  function downloadExercises(p: CourseDetailsPanel, ids: Array<ExerciseIdentifier>) {
    vscode.postMessage({
      type: "downloadExercises",
      ids,
      courseId: p.courseId,
      mode: "download",
    })
  }
  function openExercises(p: CourseDetailsPanel, ids: Array<ExerciseIdentifier>) {
    vscode.postMessage({
      type: "openExercises",
      ids,
      courseId: p.courseId,
    })
  }
  function closeExercises(p: CourseDetailsPanel, ids: Array<ExerciseIdentifier>) {
    vscode.postMessage({
      type: "closeExercises",
      ids,
      courseId: p.courseId,
    })
  }
  function clearSelectedExercises() {
    checkedExercises = { tmc: {}, mooc: {} }
  }
  function updateExercises(p: CourseDetailsPanel) {
    if (p.course === undefined) {
      return
    }
    match(
      p.course,
      (tmc) => {
        vscode.postMessage({
          type: "downloadExercises",
          ids: p.updateableExercises ?? [],
          courseId: makeTmcKind({ courseId: tmc.id }),
          mode: "update",
        })
      },
      (_mooc) => {
        throw new Error("todo")
      },
    )
  }
  function getCheckedExercises(): Array<ExerciseIdentifier> {
    const onlyCheckedExercises: Array<ExerciseIdentifier> = []
    Object.entries(checkedExercises.tmc).forEach(([id, checked]) => {
      if (checked) {
        onlyCheckedExercises.push(makeTmcKind({ tmcExerciseId: Math.trunc(Number(id)) }))
      }
    })
    Object.entries(checkedExercises.mooc).forEach(([id, checked]) => {
      if (checked) {
        onlyCheckedExercises.push(makeMoocKind({ moocExerciseId: id }))
      }
    })
    return onlyCheckedExercises
  }
</script>

<nav>
  <a
    id="back-to-my-courses"
    role="button"
    class="my-courses-link"
    tabindex="0"
    onclick={() => openMyCourses()}
    onkeypress={() => openMyCourses()}
  >
    My Courses
  </a>
  /
  {course?.title ?? "Loading course..."}
</nav>
<div class="header">
  {#if course === undefined}
    <h2>Loading course...</h2>
  {:else}
    <h2>{course.title} <small class="muted">({course.name})</small></h2>
  {/if}

  <div>
    {course?.description ?? "Loading description..."}
  </div>

  <div>
    <vscode-button
      role="button"
      tabindex="0"
      class="refresh"
      aria-label="Refresh"
      onclick={() => refresh(panel.courseId)}
      onkeypress={() => refresh(panel.courseId)}
      disabled={$refreshing || $totalDownloading > 0}
      appearance="secondary"
    >
      {#if $refreshing}
        Refreshing
      {:else}
        Refresh
      {/if}
    </vscode-button>
  </div>

  <div>
    Points gained: {course
      ? `${course.awardedPoints} / ${course.availablePoints}`
      : "Loading points..."}
  </div>

  {#if course?.materialUrl}
    <div>
      Material: <a href={course.materialUrl}>{course.materialUrl}</a>
    </div>
  {/if}

  <div class="open-workspace-button">
    <vscode-button
      role="button"
      tabindex="0"
      aria-label="Open workspace"
      onclick={() => openWorkspace(panel)}
      onkeypress={() => openWorkspace(panel)}
    >
      Open workspace
    </vscode-button>
  </div>

  <div
    role="alert"
    hidden={panel.updateableExercises === undefined || panel.updateableExercises.length > 0}
  >
    Updates found for exercises
    <vscode-button
      role="button"
      tabindex="0"
      onclick={() => updateExercises(panel)}
      onkeypress={() => updateExercises(panel)}
    >
      Update exercises
    </vscode-button>
  </div>
  {#if panel.offlineMode}
    <div role="alert">Unable to fetch exercise data from server. Displaying local exercises.</div>
  {/if}
  {#if course?.perhapsExamMode}
    <div role="alert">This is an exam. Exercise submission results will not be shown.</div>
  {/if}
  {#if course?.disabled}
    <div role="alert">
      This course has been disabled. Exercises cannot be downloaded or submitted.
    </div>
  {/if}
</div>

{#if panel.exerciseGroups !== undefined}
  {#each panel.exerciseGroups as exerciseGroup}
    <div class="exercise-part">
      <ExercisePart
        {exerciseGroup}
        exerciseStatuses={panel.exerciseStatuses}
        bind:checkedExercises
        onDownloadAll={(exercises) => downloadExercises(panel, exercises)}
        onOpenAll={(exercises) => openExercises(panel, exercises)}
        onCloseAll={(exercises) => closeExercises(panel, exercises)}
      />
    </div>
  {/each}
{:else}
  <vscode-progress-ring></vscode-progress-ring>
{/if}

{#if checkedExercisesCount > 0}
  <div class="action-bar-container">
    <div class="action-bar">
      <div class="action-bar-text">
        Select action for {checkedExercisesCount} selected items
      </div>
      <div class="action-bar-buttons">
        <vscode-button
          role="button"
          tabindex="0"
          class="action-bar-button"
          onclick={() => downloadExercises(panel, getCheckedExercises())}
          onkeypress={() => downloadExercises(panel, getCheckedExercises())}
        >
          Download
        </vscode-button>
        <vscode-button
          role="button"
          tabindex="0"
          class="action-bar-button"
          onclick={() => openExercises(panel, getCheckedExercises())}
          onkeypress={() => openExercises(panel, getCheckedExercises())}
        >
          Open
        </vscode-button>
        <vscode-button
          role="button"
          tabindex="0"
          class="action-bar-button"
          onclick={() => closeExercises(panel, getCheckedExercises())}
          onkeypress={() => closeExercises(panel, getCheckedExercises())}
        >
          Close
        </vscode-button>
        <vscode-button
          role="button"
          tabindex="0"
          class="action-bar-button"
          secondary
          onclick={() => clearSelectedExercises()}
          onkeypress={() => clearSelectedExercises()}
        >
          Clear selection
        </vscode-button>
      </div>
    </div>
  </div>
{/if}

<style>
  .header {
    position: relative;
    margin-bottom: 0.8rem;
  }
  .refresh {
    position: absolute;
    top: 0rem;
    right: 0rem;
  }
  .action-bar-container {
    position: fixed;
    bottom: 0.8rem;
    left: 50%;
    right: 50%;
    justify-content: center;
    display: flex;
  }
  .action-bar {
    display: flex;
    flex-direction: column;
    background-color: var(--vscode-editor-background, #1f1f1f);
    padding: 0.4rem;
    border: 1px;
    border-style: inset;
  }
  .action-bar-text {
    text-align: center;
  }
  .action-bar-buttons {
    display: flex;
    justify-content: center;
  }
  .action-bar-button {
    margin: 0.4rem;
  }
  .open-workspace-button {
    margin-top: 0.4rem;
    margin-bottom: 0.4rem;
  }
  .muted {
    opacity: 90%;
  }
  .exercise-part {
    margin-bottom: 1rem;
  }
  .my-courses-link {
    cursor: pointer;
  }
</style>
