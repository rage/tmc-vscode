<script lang="ts">
  import { onMount, tick, untrack } from "svelte"

  import type {
    CourseDetailsPanel,
    CourseHomeAction,
    CourseHomeExercise,
    CourseHomeExerciseAction,
    CourseHomeView,
    RunnableCommand,
    WebviewError,
  } from "../../../shared/lib"
  import { backendName, SOFT_DEADLINE_PENALTY } from "../../../shared/lib"
  import type { BarAction } from "../components/ActionBar.svelte"
  import ActionBar from "../components/ActionBar.svelte"
  import ActionMenu from "../components/ActionMenu.svelte"
  import Button from "../components/Button.svelte"
  import ErrorNotice from "../components/ErrorNotice.svelte"
  import Meter from "../components/Meter.svelte"
  import PanelHeader from "../components/PanelHeader.svelte"
  import Spinner from "../components/Spinner.svelte"
  import ToolbarButton from "../components/ToolbarButton.svelte"
  import { announce, reducedMotion } from "../utilities/a11y.svelte"
  import { addMessageListener, createRequester, HOST_STATE_TIMEOUT_MS } from "../utilities/script"
  import { restoreScroll, uiState } from "../utilities/uiState.svelte"
  import { vscode } from "../utilities/vscode"
  import type { CourseNotice } from "./courseHome/CourseNotices.svelte"
  import CourseNotices from "./courseHome/CourseNotices.svelte"
  import CoursePart from "./courseHome/CoursePart.svelte"

  interface Props {
    panel: CourseDetailsPanel
  }

  /** The course home: a course's progress, news and exercises, and what to do with them. */
  let { panel }: Props = $props()

  let view = $state.raw<CourseHomeView | undefined>(undefined)
  let refreshing = $state(false)
  let refreshError = $state<WebviewError | undefined>(undefined)
  // Set when the request for this panel's data is answered with a failure, or goes
  // unanswered, so neither is a permanent spinner.
  let dataError = $state<WebviewError | undefined>(undefined)
  // Parts the student opened or closed, by key, over each part's default.
  const toggledParts = uiState<string[]>("toggledParts", [])

  const request = createRequester()

  const exercises = $derived(view?.parts.flatMap((part) => part.exercises) ?? [])
  const downloadableCount = $derived(
    exercises.filter((ex) => ex.status === "missing" || ex.status === "new").length,
  )
  const downloadingCount = $derived(exercises.filter((ex) => ex.status === "downloading").length)
  const onDiskCount = $derived(
    exercises.filter((ex) => ex.status === "opened" || ex.status === "closed").length,
  )
  const completedOpenCount = $derived(
    exercises.filter((ex) => ex.passed && ex.status === "opened").length,
  )
  const canDownload = $derived(view !== undefined && !view.isDisabled && view.isLoggedIn)

  async function requestData() {
    dataError = undefined
    const { id, type, courseId } = panel
    const outcome = await request(
      "requestCourseDetailsData",
      { sourcePanel: { id, type, courseId } },
      { timeoutMs: HOST_STATE_TIMEOUT_MS },
    )
    if (outcome.ok) {
      view = outcome.value
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
    view = message.view
  })

  async function refresh() {
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
      view = outcome.value
      announce("Course refreshed")
    } else {
      refreshError = outcome.error
    }
  }

  function runCourseAction(action: CourseHomeAction) {
    vscode.postMessage({
      type: "courseAction",
      sourcePanel: { id: panel.id, type: panel.type },
      action,
    })
  }

  function runExerciseAction(exercise: CourseHomeExercise, action: CourseHomeExerciseAction) {
    vscode.postMessage({
      type: "courseExerciseAction",
      sourcePanel: { id: panel.id, type: panel.type },
      exerciseId: exercise.id,
      action,
    })
  }

  function runCommand(command: RunnableCommand) {
    vscode.postMessage({ type: "runCommand", command })
  }

  function openWorkspace() {
    vscode.postMessage({ type: "openCourseWorkspace", courseId: panel.courseId })
  }

  // Not an `<a href>`: VS Code would open the backend-supplied URL itself, whatever its scheme.
  function openInBrowser(url: string) {
    vscode.postMessage({ type: "openLinkInBrowser", url })
  }

  function isPartExpanded(key: string, isDefaultOpen: boolean): boolean {
    return toggledParts.current.includes(key) !== isDefaultOpen
  }

  function togglePart(key: string) {
    const toggled = toggledParts.current
    toggledParts.current = toggled.includes(key)
      ? toggled.filter((other) => other !== key)
      : [...toggled, key]
  }

  /** Names a few exercises in a sentence, e.g. "a, b and 3 more". */
  function listNames(names: string[]): string {
    const shown = names.slice(0, 4)
    const rest = names.length - shown.length
    return rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(", ")
  }

  function plural(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? "" : "s"}`
  }

  const downloadAll: BarAction = $derived({
    label:
      downloadingCount > 0
        ? `Downloading ${plural(downloadingCount, "Exercise")}…`
        : `Download ${plural(downloadableCount, "Exercise")}`,
    icon: "cloud-download",
    disabled: downloadingCount > 0 || !canDownload,
    onclick: () => runCourseAction("downloadAllExercises"),
  })
  const openCourseWorkspace: BarAction = $derived({
    label: "Open Course Workspace",
    icon: "folder-opened",
    onclick: openWorkspace,
  })
  const closeCompleted: BarAction = $derived({
    label: `Close ${plural(completedOpenCount, "Completed Exercise")}`,
    icon: "close-all",
    onclick: () => runCourseAction("closeCompletedExercises"),
  })

  const notices = $derived.by((): CourseNotice[] => {
    if (!view) {
      return []
    }
    const site = backendName(view.backend)
    const candidates: (CourseNotice | false)[] = [
      view.isRestricted && {
        key: "restricted",
        tone: "warning",
        title: "Restricted Mode",
        detail: "Trust this course workspace to run tests, submit and share exercises.",
        action: { label: "Trust", onclick: () => runCommand("tmc.trustCourseWorkspace") },
      },
      !view.isLoggedIn && {
        key: "loggedOut",
        tone: "info",
        title: "Not logged in",
        detail: `Log in to ${backendName("mooc")} to download and submit exercises.`,
        action: { label: "Log In", onclick: () => runCommand("tmc.showMoocLogin") },
      },
      view.isLoggedIn &&
        view.isOffline && {
          key: "offline",
          tone: "warning",
          title: `${site} could not be reached`,
          detail: "Showing the exercises on this computer; deadlines may be out of date.",
        },
      view.isDisabled && {
        key: "disabled",
        tone: "warning",
        title: "This course is disabled",
        detail: "Its exercises cannot be downloaded or submitted.",
      },
      view.isExamMode && {
        key: "exam",
        tone: "info",
        title: "This is an exam",
        detail: "Submission results are not shown.",
      },
      view.newExercises.length > 0 && {
        key: "new",
        tone: "info",
        title: plural(view.newExercises.length, "new exercise"),
        detail: listNames(view.newExercises.map((ex) => ex.name)),
        action: {
          label: "Download",
          disabled: !canDownload,
          onclick: () => runCourseAction("downloadNewExercises"),
        },
        ondismiss: () => runCourseAction("dismissNewExercises"),
        dismissLabel: "Dismiss the new exercises",
      },
      view.updates.length > 0 && {
        key: "updates",
        tone: "info",
        title: view.updates.length === 1 ? "1 update" : `${view.updates.length} updates`,
        detail: `${listNames(view.updates.map((ex) => ex.name))}. Your own code is kept.`,
        action: {
          label: "Update",
          disabled: !canDownload,
          onclick: () => runCourseAction("updateExercises"),
        },
      },
      view.recentlyUpdated.length > 0 && {
        key: "updated",
        tone: "info",
        title: "Updated",
        detail: `${listNames(view.recentlyUpdated)} to the latest version.`,
        ondismiss: () => runCourseAction("dismissRecentUpdates"),
        dismissLabel: "Dismiss the update notice",
      },
    ]
    return candidates.filter((notice) => notice !== false)
  })

  // One primary per state: download first, then open the workspace, then work in it.
  const bar = $derived.by((): { primary?: BarAction; secondary: [] | [BarAction] } => {
    const hasDownloads = downloadableCount > 0 || downloadingCount > 0
    if (!view) {
      return { secondary: [] }
    }
    if (!view.isWorkspaceOpen) {
      return onDiskCount === 0 && hasDownloads
        ? { primary: downloadAll, secondary: [] }
        : { primary: openCourseWorkspace, secondary: hasDownloads ? [downloadAll] : [] }
    }
    const secondary: [] | [BarAction] = completedOpenCount > 0 ? [closeCompleted] : []
    return hasDownloads ? { primary: downloadAll, secondary } : { secondary }
  })

  const menuActions = $derived([
    { label: "Switch Course Workspace…", onselect: () => runCourseAction("switchCourseWorkspace") },
    { label: "Show in Courses View", onselect: () => runCourseAction("revealInCoursesView") },
    ...(view?.materialUrl
      ? [{ label: "Open Course Material", onselect: () => openInBrowser(view!.materialUrl!) }]
      : []),
    ...(view?.isWorkspaceOpen === false && completedOpenCount > 0
      ? [
          {
            label: "Close Completed Exercises",
            onselect: () => runCourseAction("closeCompletedExercises"),
          },
        ]
      : []),
  ])
</script>

<div class="course-home">
  {#if view}
    <PanelHeader title={view.title} subtitle="{view.organization} · {backendName(view.backend)}">
      {#snippet toolbar()}
        <ToolbarButton
          icon="refresh"
          label={refreshing ? "Refreshing…" : "Refresh"}
          aria-disabled={refreshing}
          class={refreshing && !reducedMotion.current ? "is-spinning" : undefined}
          onclick={refresh}
        />
        <ActionMenu actions={menuActions} />
      {/snippet}
    </PanelHeader>

    {#if view.description}
      <p class="description">{view.description}</p>
    {/if}
    <div class="summary">
      {#if view.availablePoints > 0}
        <div class="summary-points">
          <Meter label="Points" value={view.awardedPoints} max={view.availablePoints} />
        </div>
      {/if}
      {#if view.nextDeadline}
        <p class="summary-deadline">
          <span class="muted">Next deadline</span>
          <time datetime={view.nextDeadline.at} title={view.nextDeadline.absolute}>
            {view.nextDeadline.relative}
          </time>
          <span class="muted">· {view.nextDeadline.absolute}</span>
        </p>
      {/if}
    </div>

    <ActionBar primary={bar.primary} secondary={bar.secondary} />

    <CourseNotices {notices} />
    {#if refreshError}
      <ErrorNotice
        error={refreshError}
        title="Could not refresh this course"
        ondismiss={() => (refreshError = undefined)}
        dismissLabel="Dismiss refresh error"
      />
    {/if}

    <div role="status">
      {#if downloadingCount > 0}
        <vscode-progress-bar indeterminate class="downloading" aria-hidden="true"
        ></vscode-progress-bar>
        <span class="visually-hidden">Downloading {plural(downloadingCount, "exercise")}</span>
      {/if}
    </div>

    {#if view.parts.length === 0}
      <p class="muted">This course has no exercises yet.</p>
    {/if}
    {#each view.parts as part (part.key)}
      <CoursePart
        {part}
        isExpanded={isPartExpanded(part.key, part.isDefaultOpen)}
        ontoggle={() => togglePart(part.key)}
        onaction={runExerciseAction}
      />
    {/each}
    {#if view.hasSoftDeadlines}
      <p class="muted footnote">{SOFT_DEADLINE_PENALTY} A hard deadline cannot be exceeded.</p>
    {/if}
  {:else if dataError}
    <PanelHeader title="Could not load this course" />
    <ErrorNotice error={dataError}>
      {#snippet actions()}
        <Button onclick={() => void requestData()}>Retry</Button>
      {/snippet}
    </ErrorNotice>
  {:else}
    <PanelHeader title="Course Details" />
    <Spinner label="Loading the course…" />
  {/if}
</div>

<style>
  .course-home {
    max-width: var(--tmc-content-max-width, 720px);
  }
  .summary {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--tmc-space-2) var(--tmc-space-6);
  }
  .summary-points {
    flex: 1 1 240px;
    max-width: 360px;
  }
  .summary-deadline {
    margin: 0;
  }
  .description {
    margin: 0 0 var(--tmc-space-3);
  }
  .downloading {
    display: block;
    margin: var(--tmc-space-2) 0;
  }
  .footnote {
    margin-top: var(--tmc-space-4);
  }
  :global(.is-spinning) {
    animation: tmc-spin 1.5s linear infinite;
  }
  @keyframes tmc-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
