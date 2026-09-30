<script lang="ts">
  import { onMount, tick, untrack } from "svelte"

  import Button from "../components/Button.svelte"
  import CodeBlock from "../components/CodeBlock.svelte"
  import Meter from "../components/Meter.svelte"
  import Notice from "../components/Notice.svelte"
  import PanelHeader from "../components/PanelHeader.svelte"
  import Spinner from "../components/Spinner.svelte"
  import type { CourseDetailsPanel, LocalCourseData, WebviewError } from "../shared/shared"
  import { unwrap } from "../shared/shared"
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
  const hasSoftDeadlines = $derived(courseData ? hasSoftDeadline(courseData) : false)

  const request = createRequester()

  // Set when the request for this panel's data is answered with a failure, or goes
  // unanswered, so neither is a permanent spinner.
  let dataError = $state<WebviewError | undefined>(undefined)

  const title = $derived(
    course?.title ?? (dataError ? "Could not load this course" : "Loading course…"),
  )

  /** Whether an exercise has a soft deadline before its hard one, which is when it binds. */
  function hasSoftDeadline(shown: LocalCourseData): boolean {
    return unwrap(shown).exercises.some(
      ({ softDeadline, deadline }) =>
        softDeadline !== null &&
        deadline !== null &&
        Date.parse(softDeadline) < Date.parse(deadline),
    )
  }

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
  function showExercises() {
    vscode.postMessage({ type: "runCommand", command: "tmc.myCourses" })
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
      <Button onclick={showExercises}>Show exercises</Button>
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
