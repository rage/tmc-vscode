<script lang="ts">
  import Button from "../components/Button.svelte"
  import CodeBlock from "../components/CodeBlock.svelte"
  import Disclosure from "../components/Disclosure.svelte"
  import Meter from "../components/Meter.svelte"
  import Notice from "../components/Notice.svelte"
  import PanelHeader from "../components/PanelHeader.svelte"
  import PasteHelpBox from "../components/PasteHelpBox.svelte"
  import Spinner from "../components/Spinner.svelte"
  import StatusIcon from "../components/StatusIcon.svelte"
  import type { FeedbackAnswer } from "../components/SubmissionFeedbackForm.svelte"
  import SubmissionFeedbackForm from "../components/SubmissionFeedbackForm.svelte"
  import TestResults from "../components/TestResults.svelte"
  import ToolbarButton from "../components/ToolbarButton.svelte"
  import type { ExerciseSubmissionPanel, SubmissionView } from "../shared/shared"
  import { unwrap } from "../shared/shared"
  import { announce } from "../utilities/a11y.svelte"
  import { addMessageListener, createRequester } from "../utilities/script"
  import { vscode } from "../utilities/vscode"

  interface Props {
    panel: ExerciseSubmissionPanel
  }

  let { panel }: Props = $props()

  const exerciseName = $derived(unwrap(panel.exercise).name)
  const sourcePanel = $derived({ id: panel.id, type: panel.type })
  const request = createRequester()

  // Undefined only until the host's first view arrives.
  let view = $state.raw<SubmissionView | undefined>(undefined)
  let feedbackStatus = $state<"editing" | "sending" | "sent">("editing")
  let feedbackError = $state<string | undefined>(undefined)
  let isKeepWaitingRequested = $state(false)
  let keepWaitingError = $state<string | undefined>(undefined)

  const isInProgress = $derived(
    view === undefined || view.phase === "uploading" || view.phase === "grading",
  )
  const primaryAction = $derived<"runInBackground" | "keepWaiting" | "close">(
    isInProgress ? "runInBackground" : view?.canKeepWaiting ? "keepWaiting" : "close",
  )

  // svelte-ignore state_referenced_locally -- the panel identity (id/type)
  // is fixed for the lifetime of the component, capturing the initial value is intended
  addMessageListener(panel, (message) => {
    const previous = view
    view = message.view
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
  function showInBrowser(url: string) {
    vscode.postMessage({ type: "openLinkInBrowser", url })
  }
  async function keepWaiting() {
    isKeepWaitingRequested = true
    keepWaitingError = undefined
    const outcome = await request("keepWaitingForGrading", { sourcePanel })
    isKeepWaitingRequested = false
    if (!outcome.ok) {
      keepWaitingError = outcome.error.message
    }
  }
  async function copyToClipboard(text: string) {
    const outcome = await request("copyToClipboard", { sourcePanel, text })
    announce(outcome.ok ? "Copied to the clipboard" : "Could not copy to the clipboard")
  }
  async function sendFeedback(feedbackAnswerUrl: string, answers: FeedbackAnswer[]) {
    feedbackStatus = "sending"
    feedbackError = undefined
    const outcome = await request("sendFeedback", { sourcePanel, feedbackAnswerUrl, answers })
    if (outcome.ok) {
      feedbackStatus = "sent"
      announce("Feedback sent")
    } else {
      feedbackStatus = "editing"
      feedbackError = outcome.error.message
    }
  }
</script>

<PanelHeader title={exerciseName} shouldFocusOnMount={false}>
  {#snippet actions()}
    <ToolbarButton icon="close" label="Close" onclick={closePanel} />
  {/snippet}
</PanelHeader>

{#if view !== undefined}
  <h2>{view.headline}</h2>
{/if}

{#if isInProgress}
  <div class="progress-bar">
    <vscode-progress-bar
      aria-label="Processing submission"
      indeterminate={view?.progressFraction === undefined}
      value={(view?.progressFraction ?? 0) * 100}
    ></vscode-progress-bar>
  </div>
  <ul class="progress-steps">
    {#each view?.progressSteps ?? [] as step, index (index)}
      <li>
        {#if index < (view?.progressSteps.length ?? 0) - 1}
          <StatusIcon status="passed" label="Done:" isLabelHidden />
          {step}
        {:else}
          <Spinner label={step} />
        {/if}
      </li>
    {/each}
  </ul>
{/if}

{#if view !== undefined}
  {#if view.explanation}
    <p>{view.explanation}</p>
  {/if}

  {#if view.error}
    <Notice kind="error">
      <p>{view.error.message}</p>
      {#if view.error.details}
        <CodeBlock code={view.error.details} label="Error details" oncopy={copyToClipboard} />
      {/if}
    </Notice>
  {/if}

  {#if view.points}
    <div class="points">
      <Meter label="Points" value={view.points.given} max={view.points.max} />
    </div>
  {/if}

  {#if view.feedbackText}
    <p class="feedback-text">{view.feedbackText}</p>
  {/if}

  <div class="actions">
    {#if primaryAction === "runInBackground"}
      <Button onclick={closePanel}>Run in background</Button>
    {:else if primaryAction === "keepWaiting"}
      <Button disabled={isKeepWaitingRequested} onclick={keepWaiting}>Keep waiting</Button>
      <Button secondary onclick={closePanel}>Close</Button>
    {:else}
      <Button onclick={closePanel}>Close</Button>
    {/if}
    {#if view.submissionUrl}
      {@const submissionUrl = view.submissionUrl}
      <Button secondary onclick={() => showInBrowser(submissionUrl)}>
        Show submission in browser
      </Button>
    {/if}
    {#if view.solutionUrl}
      {@const solutionUrl = view.solutionUrl}
      <Button secondary onclick={() => showInBrowser(solutionUrl)}>
        Show model solution in browser
      </Button>
    {/if}
  </div>
  {#if keepWaitingError}
    <Notice kind="error" title="Could not keep waiting">{keepWaitingError}</Notice>
  {/if}

  {#if view.canPaste}
    <PasteHelpBox course={panel.course} {sourcePanel} />
  {/if}

  {#if view.feedback}
    {@const feedbackAnswerUrl = view.feedback.answerUrl}
    <SubmissionFeedbackForm
      questions={view.feedback.questions}
      status={feedbackStatus}
      error={feedbackError}
      onsend={(answers) => sendFeedback(feedbackAnswerUrl, answers)}
    />
  {/if}

  {#if view.testCases.length > 0 || view.validations}
    <TestResults
      testResults={view.testCases}
      validationResult={view.validations
        ? {
            strategy: view.validations.strategy,
            validation_errors: view.validations.validationErrors,
          }
        : null}
      oncopy={copyToClipboard}
    />
  {/if}

  {#if view.valgrind}
    <Disclosure title="Valgrind output">
      <CodeBlock code={view.valgrind} label="Valgrind output" oncopy={copyToClipboard} />
    </Disclosure>
  {/if}
{/if}

<style>
  .progress-bar {
    margin: var(--tmc-space-4) 0;
  }
  .progress-steps {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .progress-steps li {
    display: flex;
    align-items: center;
    gap: var(--tmc-space-1);
    margin-bottom: var(--tmc-space-1);
  }
  .points {
    margin: var(--tmc-space-3) 0;
  }
  .feedback-text {
    white-space: pre-wrap;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--tmc-space-2);
    margin: var(--tmc-space-3) 0;
  }
</style>
