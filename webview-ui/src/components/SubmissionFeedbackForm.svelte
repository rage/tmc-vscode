<script lang="ts" module>
  export interface FeedbackAnswer {
    questionId: number
    answer: string
  }
</script>

<script lang="ts">
  import type { FeedbackQuestion } from "../shared/shared"
  import { uiState } from "../utilities/uiState.svelte"
  import Button from "./Button.svelte"
  import Notice from "./Notice.svelte"

  interface Props {
    /** The questions the course's teachers ask after a TMC submission. */
    questions: FeedbackQuestion[]
    /** `sending` disables the form until the host answers; `sent` replaces it with thanks. */
    status: "editing" | "sending" | "sent"
    /** Why the last send failed; the answers stay so the student can retry. */
    error?: string | undefined
    /** Receives only the answered questions. */
    onsend: (answers: FeedbackAnswer[]) => void
  }

  let { questions, status, error, onsend }: Props = $props()

  const formId = $props.id()
  // Keyed by question id; a draft the student would lose to a hidden panel otherwise.
  const answers = uiState<Record<string, string>>("feedbackAnswers", {})

  function setAnswer(questionId: number, answer: string): void {
    answers.current = { ...answers.current, [questionId]: answer }
  }

  const answered = $derived(
    questions
      .map((question) => ({
        questionId: question.id,
        answer: (answers.current[question.id] ?? "").trim(),
      }))
      .filter(({ answer }) => answer !== ""),
  )

  function scale(question: FeedbackQuestion): number[] {
    const lower = question.lower ?? 0
    const upper = question.upper ?? lower
    return Array.from({ length: Math.max(0, upper - lower + 1) }, (_, offset) => lower + offset)
  }
</script>

<section class="feedback" aria-labelledby="{formId}-heading">
  <h2 id="{formId}-heading">Give feedback</h2>
  {#if status === "sent"}
    <p>Thank you for your feedback.</p>
  {:else}
    {#each questions as question (question.id)}
      {@const questionId = `${formId}-question-${question.id}`}
      <div class="question">
        <p id={questionId}>{question.question}</p>
        {#if question.kind === "intrange"}
          <vscode-radio-group
            aria-labelledby={questionId}
            onchange={(event: Event) => {
              setAnswer(question.id, (event.target as HTMLInputElement).value)
            }}
          >
            {#each scale(question) as value (value)}
              <vscode-radio
                name={questionId}
                value={String(value)}
                label={String(value)}
                checked={answers.current[question.id] === String(value)}
                disabled={status === "sending"}
              ></vscode-radio>
            {/each}
          </vscode-radio-group>
        {:else}
          <vscode-textarea
            label={question.question}
            rows={3}
            value={answers.current[question.id] ?? ""}
            disabled={status === "sending"}
            oninput={(event: Event) => {
              setAnswer(question.id, (event.target as HTMLTextAreaElement).value)
            }}
          ></vscode-textarea>
        {/if}
      </div>
    {/each}
    {#if error}
      <Notice kind="error" title="Feedback could not be sent">{error}</Notice>
    {/if}
    <div class="actions">
      <Button
        secondary
        disabled={answered.length === 0 || status === "sending"}
        onclick={() => onsend(answered)}
      >
        {status === "sending" ? "Sending feedback…" : "Send feedback"}
      </Button>
    </div>
  {/if}
</section>

<style>
  .feedback {
    margin: var(--tmc-space-4) 0;
  }
  .question p {
    margin: var(--tmc-space-3) 0 var(--tmc-space-1);
  }
  vscode-textarea {
    width: 100%;
  }
  .actions {
    margin-top: var(--tmc-space-3);
  }
</style>
