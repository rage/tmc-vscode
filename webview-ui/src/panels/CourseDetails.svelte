<script lang="ts">
  import { onMount, untrack } from "svelte"
  import { SvelteMap } from "svelte/reactivity"

  import Button from "../components/Button.svelte"
  import CodeBlock from "../components/CodeBlock.svelte"
  import ExercisePart from "../components/ExercisePart.svelte"
  import LinkButton from "../components/LinkButton.svelte"
  import Meter from "../components/Meter.svelte"
  import Notice from "../components/Notice.svelte"
  import PanelHeader from "../components/PanelHeader.svelte"
  import Spinner from "../components/Spinner.svelte"
  import type { CourseDetailsPanel, WebviewError } from "../shared/shared"
  import {
    assertUnreachable,
    makeMoocKind,
    makeTmcKind,
    match,
    unwrap,
    CourseIdentifier,
    ExerciseIdentifier,
  } from "../shared/shared"
  import { announce, reducedMotion } from "../utilities/a11y.svelte"
  import { addMessageListener, createPanelDataRequester } from "../utilities/script"
  import { vscode } from "../utilities/vscode"

  interface Props {
    panel: CourseDetailsPanel
  }

  let { panel }: Props = $props()

  let refreshing = $state<boolean>(false)
  let refreshError = $state<WebviewError | undefined>(undefined)
  // Membership is the checked state; the key keeps a tmc and a mooc exercise apart.
  const checkedExercises = new SvelteMap<string, ExerciseIdentifier>()
  const checkedExercisesCount = $derived(checkedExercises.size)
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
  const hasSoftDeadlines = $derived(
    panel.exerciseGroups?.some((group) => group.exercises.some((exercise) => !exercise.isHard)) ??
      false,
  )

  const panelData = createPanelDataRequester()

  // Set when the request for this panel's data is answered with a failure, or goes
  // unanswered; rendered where the exercise list would be, so neither is a permanent spinner.
  let dataError = $state<WebviewError | undefined>(undefined)

  const title = $derived(
    course?.title ?? (dataError ? "Could not load this course" : "Loading course…"),
  )

  async function requestData() {
    dataError = undefined
    dataError = await panelData.request((requestId) =>
      vscode.postMessage({
        type: "requestCourseDetailsData",
        requestId,
        sourcePanel: panel,
      }),
    )
  }

  onMount(() => {
    void requestData()
  })
  // Its id and type are all the listener filters on, and they never change: a new panel remounts.
  const listeningPanel = untrack(() => panel)
  addMessageListener(listeningPanel, (message) => {
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
        break
      }
      case "setExerciseStatuses": {
        // Broadcast to every CourseDetails panel; only apply it if it's for our course.
        if (
          CourseIdentifier.toString(message.courseId) !== CourseIdentifier.toString(panel.courseId)
        ) {
          break
        }
        const tmc = { ...panel.exerciseStatuses.tmc }
        const mooc = { ...panel.exerciseStatuses.mooc }
        for (const [exerciseId, status] of message.statuses) {
          match(
            exerciseId,
            (t) => (tmc[t.tmcExerciseId] = status),
            (m) => (mooc[m.moocExerciseId] = status),
          )
        }
        panel = { ...panel, exerciseStatuses: { tmc, mooc } }
        break
      }
      case "panelDataResult": {
        panelData.answer(message)
        break
      }
      case "refreshFinished": {
        refreshing = false
        refreshError = message.error
        if (message.ok) {
          announce("Course refreshed")
        }
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
  })

  function openMyCourses() {
    vscode.postMessage({
      type: "openMyCourses",
    })
  }
  function refresh() {
    // `aria-disabled` rather than `disabled` while busy, so the button keeps focus.
    if (refreshing) {
      return
    }
    refreshing = true
    refreshError = undefined
    vscode.postMessage({
      type: "refreshCourseDetails",
      id: panel.courseId,
      useCache: false,
    })
  }
  function openWorkspace() {
    vscode.postMessage({
      type: "openCourseWorkspace",
      courseId: panel.courseId,
    })
  }
  function downloadExercises(ids: Array<ExerciseIdentifier>) {
    vscode.postMessage({
      type: "downloadExercises",
      ids,
      courseId: panel.courseId,
      mode: "download",
    })
  }
  function openExercises(ids: Array<ExerciseIdentifier>) {
    vscode.postMessage({
      type: "openExercises",
      ids,
      courseId: panel.courseId,
    })
  }
  function closeExercises(ids: Array<ExerciseIdentifier>) {
    vscode.postMessage({
      type: "closeExercises",
      ids,
      courseId: panel.courseId,
    })
  }
  function clearSelectedExercises() {
    checkedExercises.clear()
  }
  function updateExercises() {
    vscode.postMessage({
      type: "downloadExercises",
      ids: panel.updateableExercises ?? [],
      courseId: panel.courseId,
      mode: "update",
    })
  }
  function getCheckedExercises(): Array<ExerciseIdentifier> {
    return [...checkedExercises.values()]
  }
</script>

<PanelHeader {title}>
  {#snippet breadcrumb()}
    <nav aria-label="Breadcrumb">
      <LinkButton onclick={openMyCourses}>My Courses</LinkButton>
      /
      <span aria-current="page">{course?.title ?? "Course"}</span>
    </nav>
  {/snippet}
  {#snippet actions()}
    {#if course}
      <Button
        secondary
        icon="refresh"
        icon-spin={refreshing && !reducedMotion.current}
        aria-disabled={refreshing}
        disabled={totalDownloading > 0}
        onclick={refresh}
      >
        {refreshing ? "Refreshing…" : "Refresh"}
      </Button>
    {/if}
  {/snippet}
</PanelHeader>

{#if course}
  <div class="course-summary stack">
    <p class="muted">{course.name}</p>
    {#if course.description}
      <p>{course.description}</p>
    {/if}
    <Meter label="Points" value={course.awardedPoints} max={course.availablePoints} />
    {#if course.materialUrl}
      <p><a href={course.materialUrl}>Course material</a></p>
    {/if}
    {#if hasSoftDeadlines}
      <p class="muted">
        A soft deadline can be exceeded: exercises submitted after it still count, but award only
        75% of the exercise points. A hard deadline cannot be exceeded.
      </p>
    {/if}
    <div class="actions">
      <Button secondary onclick={openWorkspace}>Open workspace</Button>
    </div>
  </div>

  {#if refreshError}
    <Notice
      kind="error"
      title="Could not refresh this course"
      ondismiss={() => (refreshError = undefined)}
      dismissLabel="Dismiss refresh error"
    >
      <p>{refreshError.message}</p>
    </Notice>
  {/if}
  {#if (panel.updateableExercises?.length ?? 0) > 0}
    <Notice kind="info" title="Updates found for exercises">
      {#snippet actions()}
        <Button secondary onclick={updateExercises}>Update exercises</Button>
      {/snippet}
    </Notice>
  {/if}
  {#if course.perhapsExamMode}
    <Notice kind="info">
      <p>This is an exam. Exercise submission results will not be shown.</p>
    </Notice>
  {/if}
  {#if course.disabled}
    <Notice kind="warning">
      <p>This course has been disabled. Exercises cannot be downloaded or submitted.</p>
    </Notice>
  {/if}
{/if}
{#if panel.offlineMode}
  <Notice kind="warning">
    <p>Unable to fetch exercise data from server. Displaying local exercises.</p>
  </Notice>
{/if}

{#if checkedExercisesCount > 0}
  <div class="selection-bar actions" role="region" aria-label="Selected exercises">
    <span>{checkedExercisesCount} selected</span>
    <Button onclick={() => downloadExercises(getCheckedExercises())}>Download</Button>
    <Button secondary onclick={() => openExercises(getCheckedExercises())}>Open</Button>
    <Button secondary onclick={() => closeExercises(getCheckedExercises())}>Close</Button>
    <Button secondary onclick={clearSelectedExercises}>Clear selection</Button>
  </div>
{/if}

{#if panel.exerciseGroups !== undefined}
  {#each panel.exerciseGroups as exerciseGroup (exerciseGroup.name)}
    <div class="exercise-part">
      <ExercisePart
        {exerciseGroup}
        exerciseStatuses={panel.exerciseStatuses}
        {checkedExercises}
        onDownloadAll={downloadExercises}
        onOpenAll={openExercises}
        onCloseAll={closeExercises}
      />
    </div>
  {/each}
{:else if dataError}
  <Notice kind="error">
    <p>{dataError.message}</p>
    {#if dataError.details}
      <CodeBlock code={dataError.details} label="Error details" />
    {/if}
    {#snippet actions()}
      <Button onclick={() => void requestData()}>Retry</Button>
    {/snippet}
  </Notice>
{:else}
  <Spinner label="Loading exercises" />
{/if}

<style>
  .course-summary {
    margin-bottom: var(--tmc-space-4);
  }
  .course-summary p {
    margin: 0;
  }
  /* Sticky above the parts, in DOM order before them, so it never covers a focused row. */
  .selection-bar {
    position: sticky;
    top: 0;
    z-index: 1;
    padding: var(--tmc-space-2) 0;
    background: var(--vscode-editor-background);
    border-bottom: 1px solid var(--tmc-surface-border);
  }
  .exercise-part {
    margin-bottom: var(--tmc-space-4);
  }
</style>
