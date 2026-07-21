<script lang="ts">
  import { onMount } from "svelte"

  import Button from "../components/Button.svelte"
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

  // `refresh()` remounts the panel under a fresh id, so `refreshing` resets on its own
  // via `{#key}`.
  let refreshing = $state<boolean>(false)
  let checkedExercises = $state<{
    tmc: Record<TmcExerciseId, boolean>
    mooc: Record<MoocExerciseId, boolean>
  }>({ tmc: {}, mooc: {} })
  const checkedExercisesCount = $derived(
    [...Object.values(checkedExercises.tmc), ...Object.values(checkedExercises.mooc)].filter(
      Boolean,
    ).length,
  )
  // Derived from exercise statuses rather than tracked separately, since downloads report
  // progress back as `exerciseStatusChange` broadcasts, not a return value here.
  const totalDownloading = $derived(
    [
      ...Object.values(panel.exerciseStatuses.tmc),
      ...Object.values(panel.exerciseStatuses.mooc),
    ].filter((status) => status === "downloading").length,
  )
  // common course fields, independent of the course's backend
  const course = $derived(panel.course === undefined ? undefined : unwrap(panel.course))

  onMount(() => {
    vscode.postMessage({
      type: "requestCourseDetailsData",
      sourcePanel: panel,
    })
  })
  // props aren't deeply reactive in Svelte 5, so panel is reassigned rather than mutated
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
        // Broadcast to every CourseDetails panel; only apply it if it's for our course.
        if (
          CourseIdentifier.toString(message.courseId) !== CourseIdentifier.toString(panel.courseId)
        ) {
          break
        }
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
        // Broadcast to every CourseDetails panel; only apply it if it's for our course.
        if (
          CourseIdentifier.toString(message.courseId) === CourseIdentifier.toString(panel.courseId)
        ) {
          panel = { ...panel, updateableExercises: message.exerciseIds }
        }
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
    refreshing = true
    vscode.postMessage({
      type: "refreshCourseDetails",
      // `id` is nested in the `$state`-proxied `panel`; snapshot it or posting
      // fails structured clone with a `DataCloneError`
      id: $state.snapshot(id),
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
          backend: "tmc",
        })
      },
      (mooc) => {
        // The workspace file is created under the course slug; the backend tag disambiguates
        // it from a tmc course that happens to share the same slug.
        vscode.postMessage({
          type: "openCourseWorkspace",
          courseName: mooc.name,
          backend: "mooc",
        })
      },
    )
  }
  function downloadExercises(p: CourseDetailsPanel, ids: Array<ExerciseIdentifier>) {
    vscode.postMessage({
      type: "downloadExercises",
      // `ids`/`p.courseId` may be `$state` proxies once `panel` is reassigned;
      // snapshot before posting or it fails structured clone with a `DataCloneError`
      ids: $state.snapshot(ids),
      courseId: $state.snapshot(p.courseId),
      mode: "download",
    })
  }
  function openExercises(p: CourseDetailsPanel, ids: Array<ExerciseIdentifier>) {
    vscode.postMessage({
      type: "openExercises",
      ids: $state.snapshot(ids),
      courseId: $state.snapshot(p.courseId),
    })
  }
  function closeExercises(p: CourseDetailsPanel, ids: Array<ExerciseIdentifier>) {
    vscode.postMessage({
      type: "closeExercises",
      ids: $state.snapshot(ids),
      courseId: $state.snapshot(p.courseId),
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
          ids: $state.snapshot(p.updateableExercises ?? []),
          courseId: makeTmcKind({ courseId: tmc.id }),
          mode: "update",
        })
      },
      (mooc) => {
        vscode.postMessage({
          type: "downloadExercises",
          ids: $state.snapshot(p.updateableExercises ?? []),
          // mooc CourseIdentifier carries the course id in `instanceId`
          courseId: makeMoocKind({ instanceId: mooc.id }),
          mode: "update",
        })
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
    My courses
  </a>
  /
  {course?.title ?? "Loading course…"}
</nav>
<div class="header">
  {#if course === undefined}
    <h1 class="course-heading">Loading course…</h1>
  {:else}
    <h1 class="course-heading">{course.title} <small class="muted">({course.name})</small></h1>
  {/if}

  <div>
    {course?.description ?? "Loading description…"}
  </div>

  <div>
    <Button
      class="refresh"
      aria-label="Refresh"
      onclick={() => refresh(panel.courseId)}
      disabled={refreshing || totalDownloading > 0}
      secondary
    >
      {#if refreshing}
        Refreshing <vscode-icon name="loading" spin aria-hidden="true"></vscode-icon>
      {:else}
        Refresh
      {/if}
    </Button>
  </div>

  <div>
    Points gained: {course
      ? `${course.awardedPoints} / ${course.availablePoints}`
      : "Loading points…"}
  </div>

  {#if course?.materialUrl}
    <div>
      Material: <a href={course.materialUrl}>{course.materialUrl}</a>
    </div>
  {/if}

  <div class="open-workspace-button">
    <Button aria-label="Open workspace" onclick={() => openWorkspace(panel)}>Open workspace</Button>
  </div>

  <div
    role="alert"
    hidden={panel.updateableExercises === undefined || panel.updateableExercises.length === 0}
  >
    Updates found for exercises
    <Button onclick={() => updateExercises(panel)}>Update exercises</Button>
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
  <vscode-progress-ring aria-label="Loading"></vscode-progress-ring>
{/if}

{#if checkedExercisesCount > 0}
  <div class="action-bar-container">
    <div class="action-bar">
      <div class="action-bar-text">
        Select action for {checkedExercisesCount} selected items
      </div>
      <vscode-button-group class="action-bar-buttons">
        <Button onclick={() => downloadExercises(panel, getCheckedExercises())}>Download</Button>
        <Button onclick={() => openExercises(panel, getCheckedExercises())}>Open</Button>
        <Button onclick={() => closeExercises(panel, getCheckedExercises())}>Close</Button>
        <Button secondary onclick={() => clearSelectedExercises()}>Clear selection</Button>
      </vscode-button-group>
    </div>
  </div>
{/if}

<style>
  .header {
    position: relative;
    margin-bottom: 0.8rem;
  }
  /* Reserve space so a long title/description does not run under the absolutely-positioned
     Refresh button. */
  .course-heading {
    padding-right: 7rem;
  }
  /* Targets the <vscode-button> rendered inside the Button wrapper. */
  .header :global(.refresh) {
    position: absolute;
    top: 0rem;
    right: 0rem;
  }
  .action-bar-container {
    position: fixed;
    bottom: 0.8rem;
    left: 0;
    right: 0;
    justify-content: center;
    display: flex;
  }
  .action-bar {
    display: flex;
    flex-direction: column;
    background-color: var(--vscode-editorWidget-background, #252526);
    padding: 0.4rem;
    border: 1px solid var(--vscode-widget-border, transparent);
    border-radius: 0.4rem;
  }
  .action-bar-text {
    text-align: center;
  }
  .action-bar-buttons {
    display: block;
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
  .my-courses-link:hover {
    text-decoration: underline;
  }
  .my-courses-link:focus-visible {
    outline: 1px solid var(--vscode-focusBorder, #007fd4);
    outline-offset: 2px;
  }
</style>
