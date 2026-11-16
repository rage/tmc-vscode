<script lang="ts">
  import type { ComponentProps } from "svelte"
  import { tick } from "svelte"

  import type {
    ExerciseSection,
    ExerciseSubmissionPanel,
    FeedbackAnswer,
    SubmissionView,
    WebviewError,
  } from "../../../shared/lib"
  import type { BarAction } from "../components/ActionBar.svelte"
  import ActionBar from "../components/ActionBar.svelte"
  import type { MenuAction } from "../components/ActionMenu.svelte"
  import ActionMenu from "../components/ActionMenu.svelte"
  import CodeBlock from "../components/CodeBlock.svelte"
  import Disclosure from "../components/Disclosure.svelte"
  import ErrorNotice from "../components/ErrorNotice.svelte"
  import Meter from "../components/Meter.svelte"
  import PanelHeader from "../components/PanelHeader.svelte"
  import PasteHelpBox from "../components/PasteHelpBox.svelte"
  import StatusBanner from "../components/StatusBanner.svelte"
  import SubmissionFeedbackForm from "../components/SubmissionFeedbackForm.svelte"
  import TestResults from "../components/TestResults.svelte"
  import ToolbarButton from "../components/ToolbarButton.svelte"
  import { announce } from "../utilities/a11y.svelte"
  import { addMessageListener, createRequester } from "../utilities/script"
  import { restoreScroll, uiState } from "../utilities/uiState.svelte"
  import { vscode } from "../utilities/vscode"
  import SubmissionHistory from "./exerciseSubmission/SubmissionHistory.svelte"

  interface Props {
    panel: ExerciseSubmissionPanel
  }

  let { panel }: Props = $props()

  const sourcePanel = $derived({ id: panel.id, type: panel.type })
  const subtitle = $derived(
    panel.organization ? `${panel.courseTitle} · ${panel.organization}` : panel.courseTitle,
  )
  const request = createRequester()

  // Undefined only until the host's first view arrives.
  let view = $state.raw<SubmissionView | undefined>(undefined)
  let isFeedbackSending = $state(false)
  const feedbackStatus = $derived(
    view?.feedback?.isSent ? "sent" : isFeedbackSending ? "sending" : "editing",
  )
  let feedbackError = $state<WebviewError | undefined>(undefined)
  let isKeepWaitingRequested = $state(false)
  let keepWaitingError = $state<WebviewError | undefined>(undefined)
  let isHistoryOpen = $state(false)
  let isGetHelpOpen = $state(false)
  // Get help stays for a student who asked for it where the result would not offer it.
  const isGetHelpRequested = uiState("isGetHelpRequested", false)
  // The last section request handled, so one resent after a reload does not paste again.
  const handledSectionSerial = uiState("handledSectionSerial", 0)
  let pasteHelp = $state<ReturnType<typeof PasteHelpBox> | undefined>(undefined)

  const isInProgress = $derived(
    view === undefined || view.phase === "uploading" || view.phase === "grading",
  )
  const canRetry = $derived(
    (view?.phase === "finished" || view?.phase === "failed") && !view.isExercisePassed,
  )

  const runTests: BarAction = {
    label: "Run Tests",
    icon: "beaker",
    onclick: () => runExerciseAction("runTests"),
  }
  const submitAgain: BarAction = {
    label: "Submit Again",
    icon: "cloud-upload",
    onclick: () => runExerciseAction("submit"),
  }
  const submit: BarAction = { ...submitAgain, label: "Submit" }

  const openExercise: BarAction = {
    label: "Open Exercise",
    icon: "go-to-file",
    onclick: () => runExerciseAction("openExercise"),
  }
  const exerciseStateNote = $derived(
    view?.exerciseState === "notOnDisk"
      ? "This exercise is no longer on this computer. Open it to download it again."
      : view?.exerciseState === "removed"
        ? "This exercise was removed from the course, so it can no longer be submitted."
        : view?.submitRefusal,
  )
  const triesNote = $derived(
    view?.triesLeft === undefined || view.submitRefusal || isInProgress
      ? undefined
      : `${view.triesLeft} ${view.triesLeft === 1 ? "try" : "tries"} left on this exercise.`,
  )
  const showSolution = $derived.by((): BarAction | undefined => {
    const solutionUrl = view?.solutionUrl
    return solutionUrl
      ? {
          label: "Show Model Solution",
          icon: "lightbulb",
          onclick: () => showInBrowser(solutionUrl),
        }
      : undefined
  })

  // The error's own remedies, such as Log In, come before trying again.
  const remedies = $derived(
    (view?.error?.actions ?? []).map(
      ({ label, command }): BarAction => ({
        label,
        onclick: () => vscode.postMessage({ type: "runCommand", command }),
      }),
    ),
  )

  /** The state's one suggested next step and its alternative; the rest is in `menuActions`. */
  const barActions = $derived.by((): ComponentProps<typeof ActionBar> => {
    if (isInProgress) {
      return { secondary: [{ label: "Run in Background", onclick: closePanel }] }
    }
    const [remedy] = remedies
    if (view?.canKeepWaiting) {
      return {
        primary: { label: "Keep Waiting", disabled: isKeepWaitingRequested, onclick: keepWaiting },
        secondary: remedy ? [remedy] : [],
      }
    }
    if (view?.isExercisePassed && view.nextExercise) {
      const next = view.nextExercise.name
      // A failing submission after the pass: the student may want to fix what they broke.
      const isThisOneFailed = view.tone !== "passed" && !view.exerciseState
      return {
        primary: { label: `Next: ${next}`, onclick: () => runExerciseAction("openNextExercise") },
        secondary: isThisOneFailed
          ? view.submitRefusal
            ? [runTests]
            : [runTests, submitAgain]
          : showSolution
            ? [showSolution]
            : [],
      }
    }
    if (view?.exerciseState === "notOnDisk") {
      return { primary: openExercise }
    }
    if (view?.exerciseState === "removed") {
      return { secondary: [runTests] }
    }
    if (view?.submitRefusal) {
      return showSolution
        ? { primary: showSolution, secondary: [runTests] }
        : { secondary: [runTests] }
    }
    if (view?.phase === "testedLocally") {
      return { primary: submit }
    }
    if (view?.phase === "standing") {
      if (view.isExercisePassed) {
        return showSolution ? { primary: showSolution } : {}
      }
      return { primary: runTests, secondary: [submit] }
    }
    if (canRetry) {
      if (remedy) {
        return { primary: remedy, secondary: [submitAgain] }
      }
      // A failed submission never reached the tests, so sending it again comes first.
      return view?.phase === "failed"
        ? { primary: submitAgain, secondary: [runTests] }
        : { primary: runTests, secondary: [submitAgain] }
    }
    if (remedy) {
      return { primary: remedy }
    }
    return view?.isExercisePassed && showSolution ? { primary: showSolution } : {}
  })

  const isSolutionInBar = $derived(
    showSolution !== undefined &&
      [barActions.primary, ...(barActions.secondary ?? [])].includes(showSolution),
  )

  const menuActions = $derived.by((): MenuAction[] => {
    const submissionUrl = view?.submissionUrl
    const solutionUrl = view?.solutionUrl
    return [
      ...(submissionUrl
        ? [{ label: "Show Submission in Browser", onselect: () => showInBrowser(submissionUrl) }]
        : []),
      ...(solutionUrl && !isSolutionInBar
        ? [{ label: "Show Model Solution in Browser", onselect: () => showInBrowser(solutionUrl) }]
        : []),
      ...(view?.canPaste && !view.exerciseState
        ? [{ label: "Ask for Help…", onselect: () => openSection("getHelp") }]
        : []),
      ...(isHistoryShown
        ? [{ label: "Show History", onselect: () => openSection("history") }]
        : []),
    ]
  })

  const isHistoryShown = $derived(view !== undefined && view.exerciseState !== "removed")
  const isGetHelpShown = $derived(
    view !== undefined && !view.exerciseState && (view.canPaste || isGetHelpRequested.current),
  )
  const restoreRefusal = $derived(
    view?.exerciseState === "notOnDisk"
      ? "Open the exercise again to restore a submission over it."
      : undefined,
  )

  // svelte-ignore state_referenced_locally -- the panel identity (id/type)
  // is fixed for the lifetime of the component, capturing the initial value is intended
  addMessageListener(panel, (message) => {
    if (message.type === "openExerciseSection") {
      if (message.serial > handledSectionSerial.current) {
        handledSectionSerial.current = message.serial
        void openSection(message.section, message.shouldPaste)
      }
      return
    }
    const previous = view
    view = message.view
    if (previous === undefined) {
      void tick().then(restoreScroll)
    }
    const latestStep = view.progressSteps.at(-1)
    if (previous?.phase !== view.phase || previous.headline !== view.headline) {
      announce(view.headline)
    } else if (latestStep !== undefined && latestStep !== previous.progressSteps.at(-1)) {
      announce(latestStep)
    }
  })

  function closePanel() {
    vscode.postMessage({ type: "closeSidePanel" })
  }
  function runExerciseAction(action: "runTests" | "submit" | "openNextExercise" | "openExercise") {
    vscode.postMessage({ type: "exerciseAction", sourcePanel, action })
  }
  function showInBrowser(url: string) {
    vscode.postMessage({ type: "openLinkInBrowser", url })
  }
  /** Opens `section` and moves the focus to it, pasting there for `shouldPaste`. */
  async function openSection(section: ExerciseSection, shouldPaste = false) {
    if (section === "history") {
      isHistoryOpen = true
    } else {
      isGetHelpRequested.current = true
      isGetHelpOpen = true
    }
    await tick()
    const toggleId = section === "history" ? historyToggleId : getHelpToggleId
    document.querySelector<HTMLElement>(`[id="${toggleId}"]`)?.focus()
    if (shouldPaste) {
      await pasteHelp?.paste()
    }
  }
  async function keepWaiting() {
    isKeepWaitingRequested = true
    keepWaitingError = undefined
    const outcome = await request("keepWaitingForGrading", { sourcePanel })
    isKeepWaitingRequested = false
    if (!outcome.ok) {
      keepWaitingError = outcome.error
    }
  }
  async function copyToClipboard(text: string) {
    const outcome = await request("copyToClipboard", { sourcePanel, text })
    announce(outcome.ok ? "Copied to the clipboard" : "Could not copy to the clipboard")
  }
  async function sendFeedback(answers: FeedbackAnswer[]) {
    isFeedbackSending = true
    feedbackError = undefined
    const outcome = await request("sendFeedback", { sourcePanel, answers })
    isFeedbackSending = false
    if (outcome.ok) {
      announce("Feedback sent")
    } else {
      feedbackError = outcome.error
    }
  }

  const sectionIdPrefix = $props.id()
  const historyToggleId = `${sectionIdPrefix}-history`
  const getHelpToggleId = `${sectionIdPrefix}-get-help`
</script>

<PanelHeader title={panel.exerciseName} {subtitle} shouldFocusOnMount={false}>
  {#snippet toolbar()}
    <ActionMenu actions={menuActions} />
    <ToolbarButton icon="close" label="Close" onclick={closePanel} />
  {/snippet}
</PanelHeader>

<StatusBanner tone={view?.tone ?? "progress"} title={view?.headline ?? "Preparing the submission…"}>
  {#if isInProgress}
    <vscode-progress-bar
      aria-label="Processing submission"
      indeterminate={view?.progressFraction === undefined}
      value={(view?.progressFraction ?? 0) * 100}
    ></vscode-progress-bar>
    {#if view && view.progressSteps.length > 0}
      <ul class="progress-steps">
        {#each view.progressSteps as step, index (index)}
          {@const isDone = index < view.progressSteps.length - 1}
          <li>
            <vscode-icon
              class="step-icon"
              class:done={isDone}
              name={isDone ? "check" : "arrow-right"}
              aria-hidden="true"
            ></vscode-icon>
            {#if isDone}<span class="visually-hidden">Done:</span>{/if}
            <span>{step}</span>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
  {#if view?.points}
    <Meter label="Points" value={view.points.given} max={view.points.max} />
  {/if}
  {#if view?.explanation}
    <p>{view.explanation}</p>
  {/if}
  {#if view?.pendingReview}
    <p>{view.pendingReview}</p>
  {/if}
  {#if view?.feedbackText}
    <p class="feedback-text"><span class="muted">Grader feedback:</span> {view.feedbackText}</p>
  {/if}
  {#if view?.error}
    <div role="alert">
      <p>{view.error.message}</p>
      {#if view.error.details}
        <CodeBlock code={view.error.details} label="Error details" oncopy={copyToClipboard} />
      {/if}
    </div>
  {/if}
</StatusBanner>

{#if view !== undefined}
  {#if exerciseStateNote}
    <p class="muted">{exerciseStateNote}</p>
  {:else if triesNote}
    <p class="muted">{triesNote}</p>
  {/if}
  <ActionBar {...barActions} />
  {#if keepWaitingError}
    <ErrorNotice error={keepWaitingError} title="Could not keep waiting" />
  {/if}

  {#if view.testCases.length > 0 || view.validations}
    <TestResults
      testCases={view.testCases}
      validations={view.validations}
      oncopy={copyToClipboard}
    />
  {/if}

  {#if view.valgrind}
    <Disclosure title="Valgrind output" persistAs="valgrind">
      <CodeBlock code={view.valgrind} label="Valgrind output" oncopy={copyToClipboard} />
    </Disclosure>
  {/if}

  {#if view.feedback}
    <SubmissionFeedbackForm
      questions={view.feedback.questions}
      status={feedbackStatus}
      error={feedbackError}
      onsend={sendFeedback}
    />
  {/if}

  {#if isGetHelpShown || isHistoryShown}
    <div class="more">
      {#if isGetHelpShown}
        <Disclosure
          title="Get help"
          persistAs="getHelp"
          toggleId={getHelpToggleId}
          bind:open={isGetHelpOpen}
        >
          <PasteHelpBox
            bind:this={pasteHelp}
            backend={panel.backend}
            {sourcePanel}
            oncopy={copyToClipboard}
          />
        </Disclosure>
      {/if}
      {#if isHistoryShown}
        <Disclosure
          title="History"
          persistAs="history"
          toggleId={historyToggleId}
          bind:open={isHistoryOpen}
        >
          {#if isHistoryOpen}
            <SubmissionHistory {sourcePanel} {restoreRefusal} />
          {/if}
        </Disclosure>
      {/if}
    </div>
  {/if}
{/if}

<style>
  vscode-progress-bar {
    display: block;
    margin-top: var(--tmc-space-3);
  }
  .progress-steps {
    list-style: none;
    padding: 0;
  }
  .progress-steps li {
    display: flex;
    align-items: center;
    gap: var(--tmc-space-2);
    min-height: var(--tmc-list-row-height);
  }
  .step-icon {
    flex: none;
  }
  .done {
    color: var(--tmc-status-passed);
  }
  .feedback-text {
    white-space: pre-wrap;
  }
  .more {
    margin-top: var(--tmc-space-6);
  }
</style>
