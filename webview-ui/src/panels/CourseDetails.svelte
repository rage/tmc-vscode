<script lang="ts">
  import { onMount, tick, untrack } from "svelte"

  import type { CourseDetailsPanel, WebviewError } from "../../../shared/lib"
  import {
    isSoftDeadlineBinding,
    LocalCourseData,
    SOFT_DEADLINE_PENALTY,
    unwrap,
  } from "../../../shared/lib"
  import Button from "../components/Button.svelte"
  import ErrorNotice from "../components/ErrorNotice.svelte"
  import Meter from "../components/Meter.svelte"
  import Notice from "../components/Notice.svelte"
  import PanelHeader from "../components/PanelHeader.svelte"
  import Spinner from "../components/Spinner.svelte"
  import { announce, reducedMotion } from "../utilities/a11y.svelte"
  import { addMessageListener, createRequester, HOST_STATE_TIMEOUT_MS } from "../utilities/script"
  import { restoreScroll } from "../utilities/uiState.svelte"
  import { vscode } from "../utilities/vscode"

  interface Props {
    panel: CourseDetailsPanel
  }

  let { panel }: Props = $props()

  let courseData = $state<LocalCourseData | undefined>(undefined)
  let refreshing = $state<boolean>(false)
  let refreshError = $state<WebviewError | undefined>(undefined)
  // common course fields, independent of the course's backend
  const course = $derived(courseData === undefined ? undefined : unwrap(courseData))
  const hasSoftDeadlines = $derived(course?.exercises.some(isSoftDeadlineBinding) ?? false)
  const materialUrl = $derived(courseData?.kind === "tmc" ? courseData.data.materialUrl : null)
  const isExamMode = $derived(courseData !== undefined && LocalCourseData.isExamMode(courseData))
  const isDisabled = $derived(courseData !== undefined && LocalCourseData.isDisabled(courseData))

  const request = createRequester()

  // Set when the request for this panel's data is answered with a failure, or goes
  // unanswered, so neither is a permanent spinner.
  let dataError = $state<WebviewError | undefined>(undefined)

  const title = $derived(
    course?.title ?? (dataError ? "Could not load this course" : "Loading course…"),
  )

  async function requestData() {
    dataError = undefined
    const { id, type, courseId } = panel
    const outcome = await request(
      "requestCourseDetailsData",
      { sourcePanel: { id, type, courseId } },
      { timeoutMs: HOST_STATE_TIMEOUT_MS },
    )
    if (outcome.ok) {
      courseData = outcome.value
    } else {
      dataError = outcome.error
    }
    await tick()
    restoreScroll()
  }

  onMount(() => {
    void requestData()
  })
  // Its id and type are all the listener filters on, and they never change: a new panel remounts.
  const listeningPanel = untrack(() => panel)
  addMessageListener(listeningPanel, (message) => {
    courseData = message.courseData
  })

  async function refresh() {
    // `aria-disabled` rather than `disabled` while busy, so the button keeps focus.
    if (refreshing) {
      return
    }
    refreshing = true
    refreshError = undefined
    const outcome = await request("refreshCourseDetails", {
      sourcePanel: { id: panel.id, type: panel.type },
    })
    refreshing = false
    if (outcome.ok) {
      courseData = outcome.value
      announce("Course refreshed")
    } else {
      refreshError = outcome.error
    }
  }
  function openWorkspace() {
    vscode.postMessage({
      type: "openCourseWorkspace",
      courseId: panel.courseId,
    })
  }
  // Not an `<a href>`: VS Code would open the backend-supplied URL itself, whatever its scheme.
  function openInBrowser(url: string) {
    vscode.postMessage({ type: "openLinkInBrowser", url })
  }
  function runCourseAction(action: "downloadAllExercises" | "revealInCoursesView") {
    vscode.postMessage({
      type: "courseAction",
      sourcePanel: { id: panel.id, type: panel.type },
      action,
    })
  }
</script>

<PanelHeader {title}>
  {#snippet actions()}
    {#if course}
      <Button
        secondary
        icon="refresh"
        icon-spin={refreshing && !reducedMotion.current}
        aria-disabled={refreshing}
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
    {#if materialUrl}
      <p>
        <Button secondary icon="link-external" onclick={() => openInBrowser(materialUrl)}>
          Course material
        </Button>
      </p>
    {/if}
    {#if hasSoftDeadlines}
      <p class="muted">{SOFT_DEADLINE_PENALTY} A hard deadline cannot be exceeded.</p>
    {/if}
    <div class="actions">
      <Button onclick={openWorkspace}>Open Course Workspace</Button>
      <Button
        secondary
        icon="cloud-download"
        onclick={() => runCourseAction("downloadAllExercises")}
      >
        Download All Exercises
      </Button>
      <Button secondary onclick={() => runCourseAction("revealInCoursesView")}>
        Show in Courses View
      </Button>
    </div>
  </div>

  {#if refreshError}
    <ErrorNotice
      error={refreshError}
      title="Could not refresh this course"
      ondismiss={() => (refreshError = undefined)}
      dismissLabel="Dismiss refresh error"
    />
  {/if}
  {#if isExamMode}
    <Notice kind="info">
      <p>This is an exam. Exercise submission results will not be shown.</p>
    </Notice>
  {/if}
  {#if isDisabled}
    <Notice kind="warning">
      <p>This course has been disabled. Exercises cannot be downloaded or submitted.</p>
    </Notice>
  {/if}
{:else if dataError}
  <ErrorNotice error={dataError}>
    {#snippet actions()}
      <Button onclick={() => void requestData()}>Retry</Button>
    {/snippet}
  </ErrorNotice>
{:else}
  <Spinner label="Loading course" />
{/if}

<style>
  .course-summary {
    margin-bottom: var(--tmc-space-4);
  }
  .course-summary p {
    margin: 0;
  }
</style>
