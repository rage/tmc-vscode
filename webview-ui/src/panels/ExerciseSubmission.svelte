<script lang="ts">
  import type { ComponentProps } from "svelte"
  import { tick } from "svelte"

  import type {
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
  const isPasteHelpOpen = uiState("showPasteHelp", false)

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
      return {
        primary: { label: `Next: ${next}`, onclick: () => runExerciseAction("openNextExercise") },
      }
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
    return remedy ? { primary: remedy } : {}
  })

  const menuActions = $derived.by((): MenuAction[] => {
    const submissionUrl = view?.submissionUrl
    const solutionUrl = view?.solutionUrl
    return [
      ...(submissionUrl
        ? [{ label: "Show Submission in Browser", onselect: () => showInBrowser(submissionUrl) }]
        : []),
      ...(solutionUrl
        ? [{ label: "Show Model Solution in Browser", onselect: () => showInBrowser(solutionUrl) }]
        : []),
      ...(view?.canPaste ? [{ label: "Ask for Help…", onselect: openPasteHelp }] : []),
    ]
  })

  // svelte-ignore state_referenced_locally -- the panel identity (id/type)
  // is fixed for the lifetime of the component, capturing the initial value is intended
  addMessageListener(panel, (message) => {
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
  function runExerciseAction(action: "runTests" | "submit" | "openNextExercise") {
    vscode.postMessage({ type: "exerciseAction", sourcePanel, action })
  }
  function showInBrowser(url: string) {
    vscode.postMessage({ type: "openLinkInBrowser", url })
  }
  async function openPasteHelp() {
    isPasteHelpOpen.current = true
    await tick()
    document.querySelector<HTMLElement>(`[id="${pasteHelpHeadingId}"]`)?.focus()
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

  const pasteHelpHeadingId = $props.id()
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

  {#if view.canPaste && isPasteHelpOpen.current}
    <PasteHelpBox
      backend={panel.backend}
      {sourcePanel}
      headingId={pasteHelpHeadingId}
      oncopy={copyToClipboard}
      onhide={() => (isPasteHelpOpen.current = false)}
    />
  {/if}

  {#if view.feedback}
    <SubmissionFeedbackForm
      questions={view.feedback.questions}
      status={feedbackStatus}
      error={feedbackError}
      onsend={sendFeedback}
    />
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
</style>
