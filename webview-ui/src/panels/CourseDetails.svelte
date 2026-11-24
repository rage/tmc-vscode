<script lang="ts">
  import { onMount, tick, untrack } from "svelte"

  import type {
    CourseDetailsPanel,
    CourseHomeAction,
    CourseHomeExerciseAction,
    CourseHomeView,
    ExerciseIdentifier,
    RunnableCommand,
    WebviewError,
  } from "../../../shared/lib"
  import {
    aiAssistanceSentence,
    aiPolicyRule,
    LOGGED_OUT_MESSAGE,
    NOT_LOGGED_IN_MESSAGE,
    offersLogIn,
    SOFT_DEADLINE_PENALTY,
    withoutLogIn,
  } from "../../../shared/lib"
  import type { BarAction } from "../components/ActionBar.svelte"
  import ActionBar from "../components/ActionBar.svelte"
  import ActionMenu from "../components/ActionMenu.svelte"
  import Button from "../components/Button.svelte"
  import ErrorNotice from "../components/ErrorNotice.svelte"
  import Meter from "../components/Meter.svelte"
  import PanelHeader from "../components/PanelHeader.svelte"
  import ScreenFailures from "../components/ScreenFailures.svelte"
  import Spinner from "../components/Spinner.svelte"
  import ToolbarButton from "../components/ToolbarButton.svelte"
  import { announce, reducedMotion } from "../utilities/a11y.svelte"
  import { listenForFailures } from "../utilities/screenFailures.svelte"
  import { addMessageListener, createRequester, HOST_STATE_TIMEOUT_MS } from "../utilities/script"
  import { restoreScroll, uiState } from "../utilities/uiState.svelte"
  import { vscode } from "../utilities/vscode"
  import type { CourseNotice, CourseNoticeAction } from "./courseHome/CourseNotices.svelte"
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
  // The logged-out notice carries the screen's one Log In.
  const isLogInShown = $derived(view !== undefined && isLoginNoticed(view))
  const canDownload = $derived(
    view !== undefined &&
      !view.isDisabled &&
      view.accessLoss === null &&
      !view.isNotEnrolled &&
      view.isLoggedIn,
  )

  function isLoginNoticed({ isLoggedIn, isSessionExpired }: CourseHomeView): boolean {
    return !isLoggedIn || isSessionExpired
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
    if (message.type === "setCourseHomeView") {
      // A refresh that failed before a login says nothing about the session after it.
      if (view && isLoginNoticed(view) && !isLoginNoticed(message.view)) {
        refreshError = undefined
      }
      view = message.view
    }
  })
  const screenFailures = listenForFailures(listeningPanel)

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
      // The course as it stands now replaces what earlier actions found.
      screenFailures.dismissAll()
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

  function runExerciseAction(exerciseId: ExerciseIdentifier, action: CourseHomeExerciseAction) {
    vscode.postMessage({
      type: "courseExerciseAction",
      sourcePanel: { id: panel.id, type: panel.type },
      exerciseId,
      action,
    })
  }

  function installExtension(extensionId: string) {
    vscode.postMessage({
      type: "installLanguageExtension",
      sourcePanel: { id: panel.id, type: panel.type },
      extensionId,
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
  const continueWithNext: BarAction | undefined = $derived(
    view?.nextExercise && (view.nextExercise.isOnDisk || (canDownload && !view.isOffline))
      ? {
          label: view.nextExercise.isOnDisk
            ? `Continue: ${view.nextExercise.name}`
            : `Download and Open: ${view.nextExercise.name}`,
          icon: view.nextExercise.isOnDisk ? "arrow-right" : "cloud-download",
          onclick: () => view?.nextExercise && runExerciseAction(view.nextExercise.id, "open"),
        }
      : undefined,
  )
  const closeCompleted: BarAction = $derived({
    label: `Close ${plural(completedOpenCount, "Completed Exercise")}`,
    icon: "close-all",
    onclick: () => runCourseAction("closeCompletedExercises"),
  })

  // Not passed and nothing left to do about it but wait for a teacher.
  const awaitingReview = $derived(
    (view?.parts ?? []).flatMap((part) =>
      part.exercises.flatMap((ex) =>
        !ex.passed && ex.pendingReview ? [{ name: ex.name, pendingReview: ex.pendingReview }] : [],
      ),
    ),
  )

  const notices = $derived.by((): CourseNotice[] => {
    if (!view) {
      return []
    }
    const findCourse: CourseNoticeAction = {
      label: "Find the Course",
      onclick: () => runCourseAction("findCourseOnline"),
    }
    const removeCourse: CourseNoticeAction = {
      label: "Remove Course",
      onclick: () => runCourseAction("removeCourse"),
    }
    const candidates: (CourseNotice | false)[] = [
      view.isRestricted && {
        key: "restricted",
        tone: "warning",
        title: "Restricted Mode",
        detail: "Trust this course workspace to run tests, submit and get help.",
        actions: [{ label: "Trust", onclick: () => runCommand("tmc.trustCourseWorkspace") }],
      },
      view.isSessionExpired && {
        key: "sessionExpired",
        tone: "warning",
        title: "Logged out",
        detail: LOGGED_OUT_MESSAGE,
        actions: [{ label: "Log In", onclick: () => runCommand("tmc.showMoocLogin") }],
      },
      !view.isLoggedIn &&
        !view.isSessionExpired && {
          key: "loggedOut",
          tone: "info",
          title: "Not logged in",
          detail: NOT_LOGGED_IN_MESSAGE,
          actions: [{ label: "Log In", onclick: () => runCommand("tmc.showMoocLogin") }],
        },
      view.isLoggedIn &&
        view.isOffline && {
          key: "offline",
          tone: "warning",
          title: "Could not reach the server",
          detail: "Showing the exercises on this computer; deadlines may be out of date.",
        },
      view.successor !== undefined && {
        key: "successor",
        tone: "info",
        title: "A new version of this course is available",
        detail: view.endedNote ?? "The course continues in a new version.",
        actions: [
          {
            label: "Add the New Version",
            onclick: () => runCourseAction("addSuccessorCourse"),
          },
        ],
      },
      view.successor === undefined &&
        view.endedNote !== undefined && {
          key: "ended",
          tone: "info",
          title: "This course has ended",
          detail: view.endedNote,
        },
      view.accessLoss === "forbidden" && {
        key: "accessLoss",
        tone: "warning",
        title: "You no longer have access to this course",
        detail:
          "It may have been hidden or closed. " +
          "Your exercises stay on this computer, and their tests still run.",
        actions: [findCourse, removeCourse],
      },
      view.accessLoss === "notFound" && {
        key: "accessLoss",
        tone: "warning",
        title: "This course no longer exists",
        detail:
          "It may have been removed or replaced by a new course. " +
          "Your exercises stay on this computer, and their tests still run.",
        actions: [findCourse, removeCourse],
      },
      view.isNotEnrolled &&
        !view.accessLoss && {
          key: "notEnrolled",
          tone: "warning",
          title: "You are not enrolled on this course",
          detail: "Enroll again to submit its exercises, then refresh the course.",
          actions: [{ ...findCourse, label: "Enroll Again" }, removeCourse],
        },
      view.isDisabled &&
        !view.accessLoss && {
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
        actions:
          canDownload && !view.isOffline
            ? [{ label: "Download", onclick: () => runCourseAction("downloadNewExercises") }]
            : [],
        ondismiss: () => runCourseAction("dismissNewExercises"),
        dismissLabel: "Dismiss the new exercises",
      },
      view.updates.length > 0 &&
        view.failedUpdates.length === 0 && {
          key: "updates",
          tone: "info",
          title: view.updates.length === 1 ? "1 update" : `${view.updates.length} updates`,
          detail: `${listNames(view.updates.map((ex) => ex.name))}. Your own code is kept.`,
          actions:
            canDownload && !view.isOffline
              ? [{ label: "Update", onclick: () => runCourseAction("updateExercises") }]
              : [],
        },
      view.failedUpdates.length > 0 && {
        key: "updates",
        tone: "warning",
        title: `Couldn't update ${plural(view.failedUpdates.length, "exercise")}`,
        detail: [
          `${listNames(view.failedUpdates.map((ex) => ex.name))}.`,
          ...new Set(view.failedUpdates.map((ex) => ex.reason).filter((reason) => reason !== "")),
        ].join(" "),
        actions:
          canDownload && !view.isOffline
            ? [{ label: "Try Again", onclick: () => runCourseAction("updateExercises") }]
            : [],
      },
      view.hasReachedLastExercise &&
        !view.isAllDone && {
          key: "lastExerciseReached",
          tone: "info",
          title: "You reached the last exercise",
          ...(view.nextExercise
            ? { detail: `${view.nextExercise.name} is still left to do.` }
            : {}),
          ondismiss: () => runCourseAction("dismissLastExerciseReached"),
          dismissLabel: "Dismiss the last exercise notice",
        },
      view.isAllDone &&
        !view.accessLoss &&
        !view.isNotEnrolled &&
        !view.isDisabled &&
        (awaitingReview.length > 0
          ? {
              key: "allDone",
              tone: "info",
              title: "Waiting for review",
              detail: awaitingReview
                .map(({ name, pendingReview }) => `${name} is ${pendingReview.label}.`)
                .join(" "),
            }
          : {
              key: "allDone",
              tone: "info",
              title: "Nothing left to do right now",
              detail: "Every exercise is passed or closed for submissions.",
            }),
      ...view.missingLanguageExtensions.map(
        ({ extensionId, installSentence }): CourseNotice => ({
          key: `extension:${extensionId}`,
          tone: "info",
          title: installSentence,
          actions: [{ label: "Install", onclick: () => installExtension(extensionId) }],
        }),
      ),
      view.aiPolicyChange !== null && {
        key: "aiPolicyChange",
        tone: "info",
        title: "AI policy changed",
        detail: view.aiPolicyChange,
        ondismiss: () => runCourseAction("dismissAiPolicyChange"),
        dismissLabel: "Dismiss the AI policy notice",
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
  const bar = $derived.by(
    (): {
      primary?: BarAction | undefined
      secondary: [] | [BarAction] | [BarAction, BarAction]
    } => {
      if (!view) {
        return { secondary: [] }
      }
      // Logged out or offline the download could only fail; the notices say why.
      const offersDownload =
        canDownload && !view.isOffline && (downloadableCount > 0 || downloadingCount > 0)
      if (!view.isWorkspaceOpen) {
        if (onDiskCount === 0) {
          return { primary: offersDownload ? downloadAll : undefined, secondary: [] }
        }
        return { primary: openCourseWorkspace, secondary: offersDownload ? [downloadAll] : [] }
      }
      // The new-exercises notice already offers the download when that is all there is to it.
      const isDownloadInNotice =
        downloadingCount === 0 && view.newExercises.length >= downloadableCount
      const download = offersDownload && !isDownloadInNotice ? downloadAll : undefined
      const close = completedOpenCount > 0 ? closeCompleted : undefined
      // Past the last exercise, the one left to do is behind the student: offered, not urged.
      if (view.hasReachedLastExercise && continueWithNext) {
        return {
          primary: download,
          secondary: close ? [continueWithNext, close] : [continueWithNext],
        }
      }
      const primary = continueWithNext ?? download
      const extra = primary === download ? undefined : download
      if (extra && close) {
        return { primary, secondary: [extra, close] }
      }
      const only = extra ?? close
      return { primary, secondary: only ? [only] : [] }
    },
  )

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
    <PanelHeader title={view.title} lang={view.languageCode} subtitle={view.organization}>
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
      <p class="description" lang={view.languageCode}>{view.description}</p>
    {/if}
    {#if view.isStaff}
      <p class="muted">You teach or assist on this course.</p>
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
            {view.nextDeadline.relative ?? view.nextDeadline.absolute}
          </time>
          {#if view.nextDeadline.relative}
            <span class="muted">· {view.nextDeadline.absolute}</span>
          {/if}
        </p>
      {/if}
    </div>

    {#if view.aiPolicy && view.aiPolicy.policy !== "not_set"}
      <p class="ai-policy">
        <span class="muted">AI use:</span>
        {aiPolicyRule(view.aiPolicy.policy)}
        <span class="muted">{aiAssistanceSentence(view.aiPolicy.isAiAllowed)}</span>
      </p>
    {/if}

    <ActionBar primary={bar.primary} secondary={bar.secondary} />

    <CourseNotices {notices} />
    <ScreenFailures failures={screenFailures} {isLogInShown} />
    <!-- A refresh refused for the lost session is what the logged-out notice says. -->
    {#if refreshError && !(isLogInShown && offersLogIn(refreshError))}
      <ErrorNotice
        error={isLogInShown ? withoutLogIn(refreshError) : refreshError}
        title="Refresh failed"
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
        lang={view.languageCode}
        isWorkspaceOpen={view.isWorkspaceOpen}
        canDownload={canDownload && !view.isOffline}
        isExpanded={isPartExpanded(part.key, part.isDefaultOpen)}
        ontoggle={() => togglePart(part.key)}
        onaction={(exercise, action) => runExerciseAction(exercise.id, action)}
        onopenmaterial={openInBrowser}
      />
    {/each}
    {#if view.hasSoftDeadlines}
      <p class="muted footnote">{SOFT_DEADLINE_PENALTY} A hard deadline cannot be exceeded.</p>
    {/if}
  {:else if dataError}
    <PanelHeader title="Could not load this course" />
    <ErrorNotice error={dataError}>
      {#snippet actions()}
        <Button onclick={() => void requestData()}>Try Again</Button>
      {/snippet}
    </ErrorNotice>
  {:else}
    <PanelHeader title="Course Home" />
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
  .ai-policy {
    margin: var(--tmc-space-2) 0 0;
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
