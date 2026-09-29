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
  import type { ExerciseTaskSubmissionStatus, SubmissionFinished } from "../shared/langsSchema"
  import type { ExerciseSubmissionPanel, FeedbackQuestion, WebviewError } from "../shared/shared"
  import { assertUnreachable, unwrap } from "../shared/shared"
  import { announce } from "../utilities/a11y.svelte"
  import { addMessageListener } from "../utilities/script"
  import { vscode } from "../utilities/vscode"

  interface Props {
    panel: ExerciseSubmissionPanel
  }

  let { panel }: Props = $props()

  const progressMessageLimit = 20

  // common exercise fields, independent of the backend
  const exercise = $derived(unwrap(panel.exercise))
  const isMooc = $derived(panel.exercise.kind === "mooc")

  let submissionStatusUrl = $state<string | undefined>(undefined)
  let progressFraction = $state<number>(0)
  // `id` keys the list: the same text can recur once another step came between.
  let progressSteps = $state.raw<{ id: number; text: string }[]>([])
  let nextProgressStepId = 0
  let submissionError = $state.raw<WebviewError | undefined>(undefined)
  let submissionResult = $state.raw<SubmissionFinished | undefined>(undefined)
  let feedbackQuestions = $state.raw<FeedbackQuestion[]>([])
  let feedbackStatus = $state<"editing" | "sending" | "sent">("editing")
  let feedbackError = $state<string | undefined>(undefined)
  let pasteResult = $state<string | undefined>(undefined)
  let pasteError = $state<string | undefined>(undefined)
  // The last message of a mooc submission: the CLI has stopped waiting once it arrives,
  // whether or not grading finished, so nothing updates the panel after it.
  let moocResult = $state.raw<ExerciseTaskSubmissionStatus | undefined>(undefined)
  const moocGrading = $derived(moocResult?.status === "grading" ? moocResult.grading : undefined)

  function moocHeadline(result: ExerciseTaskSubmissionStatus): string {
    if (result.status === "no-grading-yet") {
      return "Grading has not started yet"
    }
    switch (result.grading.grading_progress) {
      case "FullyGraded":
        return "Exercise graded"
      case "Failed":
        return "Grading failed"
      case "PendingManual":
        return "Awaiting manual grading"
      case "Pending":
      case "NotReady":
        return "Grading still in progress"
      default:
        return assertUnreachable(result.grading.grading_progress)
    }
  }

  function tmcHeadline(result: SubmissionFinished): string {
    switch (result.status) {
      case "ok":
        return result.all_tests_passed
          ? "All tests passed on the server"
          : "Some tests failed on the server"
      case "fail":
        return "Some tests failed on the server"
      case "hidden":
        return "Processing the submission finished"
      case "error":
        return "Something went wrong…"
      case "processing":
        return "Processing submission…"
      default:
        return assertUnreachable(result.status)
    }
  }

  function roundScore(score: number): number {
    return Math.round(score * 100) / 100
  }

  // svelte-ignore state_referenced_locally -- the panel identity (id/type)
  // is fixed for the lifetime of the component, capturing the initial value is intended
  addMessageListener(panel, (message) => {
    switch (message.type) {
      case "submissionStatusUrl": {
        submissionStatusUrl = message.url
        break
      }
      case "submissionStatusUpdate": {
        progressFraction = message.fraction
        // Mooc grading polls every 2 s for up to 3 minutes reporting the same text, so
        // only a changed message starts a new line; the cap bounds an alternating one.
        if (message.message !== undefined && message.message !== progressSteps.at(-1)?.text) {
          progressSteps = [
            ...progressSteps,
            { id: nextProgressStepId++, text: message.message },
          ].slice(-progressMessageLimit)
          announce(message.message)
        }
        break
      }
      case "submissionStatusError": {
        submissionError = message.error
        announce("Submission failed")
        break
      }
      case "submissionResult": {
        submissionResult = message.result
        feedbackQuestions = message.questions
        announce(tmcHeadline(message.result))
        break
      }
      case "moocSubmissionResult": {
        moocResult = message.result
        announce(moocHeadline(message.result))
        break
      }
      case "feedbackSent": {
        if (message.ok) {
          feedbackStatus = "sent"
          feedbackError = undefined
          announce("Feedback sent")
        } else {
          feedbackStatus = "editing"
          feedbackError = message.error ?? "Unknown error"
        }
        break
      }
      case "pasteResult": {
        pasteResult = message.pasteLink
        break
      }
      case "pasteError": {
        pasteError = message.error
        break
      }
      default: {
        assertUnreachable(message)
      }
    }
  })

  function closePanel() {
    vscode.postMessage({ type: "closeSidePanel" })
  }
  function showInBrowser(url: string) {
    vscode.postMessage({ type: "openLinkInBrowser", url })
  }
  function copyToClipboard(text: string) {
    vscode.postMessage({ type: "copyToClipboard", text })
  }
  function sendFeedback(feedbackAnswerUrl: string, answers: FeedbackAnswer[]) {
    feedbackStatus = "sending"
    feedbackError = undefined
    vscode.postMessage({
      type: "sendFeedback",
      sourcePanel: { id: panel.id, type: panel.type },
      feedbackAnswerUrl,
      answers,
    })
  }
</script>

{#snippet progressList()}
  <ul class="progress-steps">
    {#each progressSteps as step, index (step.id)}
      <li>
        {#if index < progressSteps.length - 1}
          <StatusIcon status="passed" label="Done:" isLabelHidden />
          {step.text}
        {:else}
          <Spinner label={step.text} />
        {/if}
      </li>
    {/each}
  </ul>
{/snippet}

<PanelHeader title={exercise.name} shouldFocusOnMount={false}>
  {#snippet actions()}
    <ToolbarButton icon="close" label="Close" onclick={closePanel} />
  {/snippet}
</PanelHeader>

{#if submissionError !== undefined}
  <!-- The error is the last message either backend posts, so it replaces the screen. -->
  <h2>Submission failed</h2>
  <Notice kind="error">
    <p>{submissionError.message}</p>
    {#if submissionError.details}
      <CodeBlock code={submissionError.details} label="Error details" oncopy={copyToClipboard} />
    {/if}
  </Notice>
{:else if isMooc}
  <!-- Mooc grading has no per-test breakdown or feedback questions. -->
  {#if moocResult === undefined}
    <h2>Processing submission…</h2>
    <div class="progress-bar">
      <vscode-progress-bar indeterminate aria-label="Waiting for grading"></vscode-progress-bar>
    </div>
    {@render progressList()}
    <div class="actions">
      <Button secondary onclick={closePanel}>Run in background</Button>
    </div>
  {:else}
    <h2>{moocHeadline(moocResult)}</h2>
    {#if moocGrading && moocGrading.score_given !== null}
      <div class="score">
        <Meter
          label="Score"
          value={roundScore(moocGrading.score_given)}
          max={exercise.availablePoints}
        />
      </div>
    {/if}
    {#if moocGrading?.feedback_text}
      <p class="feedback-text">{moocGrading.feedback_text}</p>
    {/if}
    {#if moocGrading?.grading_progress === "PendingManual"}
      <p>
        A teacher will grade this submission. The score will appear in the course progress once it
        has been graded.
      </p>
    {:else if moocGrading?.grading_progress !== "FullyGraded" && moocGrading?.grading_progress !== "Failed"}
      <p>
        Grading did not finish while VS Code was waiting. Your submission was received, and its
        score will appear in the course progress once it has been graded.
      </p>
    {/if}
    <div class="actions">
      <Button secondary onclick={closePanel}>Close</Button>
    </div>
  {/if}
{:else if submissionResult === undefined}
  <h2>Processing submission…</h2>
  <div class="progress-bar">
    <vscode-progress-bar aria-label="Running tests on the server" value={progressFraction * 100}
    ></vscode-progress-bar>
  </div>
  {@render progressList()}
  <div class="actions">
    <Button secondary onclick={closePanel}>Run in background</Button>
    <Button
      secondary
      onclick={() => submissionStatusUrl && showInBrowser(submissionStatusUrl)}
      disabled={submissionStatusUrl === undefined}
    >
      Show submission in browser
    </Button>
  </div>
{:else}
  <h2>{tmcHeadline(submissionResult)}</h2>
  {#if submissionResult.status === "error"}
    <Notice kind="error" title="The submission could not be processed">
      {#if submissionResult.error}
        <CodeBlock code={submissionResult.error} label="Server error" oncopy={copyToClipboard} />
      {/if}
      <p>Please try submitting again.</p>
    </Notice>
  {/if}

  <div class="actions">
    <Button
      secondary
      onclick={() => submissionResult && showInBrowser(submissionResult.submission_url)}
    >
      Show submission in browser
    </Button>
  </div>

  {#if !submissionResult.all_tests_passed}
    <PasteHelpBox
      course={panel.course}
      exercise={panel.exercise}
      sourcePanel={{ id: panel.id, type: panel.type }}
      pasteUrl={pasteResult}
      {pasteError}
      onPaste={() => {
        pasteResult = undefined
        pasteError = undefined
      }}
    />
  {/if}

  {#if feedbackQuestions.length > 0 && submissionResult.feedback_answer_url}
    {@const feedbackAnswerUrl = submissionResult.feedback_answer_url}
    <SubmissionFeedbackForm
      questions={feedbackQuestions}
      status={feedbackStatus}
      error={feedbackError}
      onsend={(answers) => sendFeedback(feedbackAnswerUrl, answers)}
    />
  {/if}

  <TestResults
    testResults={submissionResult.test_cases ?? []}
    points={{ awarded: submissionResult.points.length, available: exercise.availablePoints }}
    validationResult={submissionResult.validations && {
      strategy: submissionResult.validations.strategy,
      validation_errors: submissionResult.validations.validationErrors,
    }}
    solutionUrl={submissionResult.solution_url}
    oncopy={copyToClipboard}
  />

  {#if submissionResult.valgrind}
    <Disclosure title="Valgrind output">
      <CodeBlock
        code={submissionResult.valgrind}
        label="Valgrind output"
        oncopy={copyToClipboard}
      />
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
  .score {
    margin: var(--tmc-space-3) 0;
  }
  .feedback-text {
    white-space: pre-wrap;
  }
  .actions {
    margin: var(--tmc-space-3) 0;
  }
</style>
