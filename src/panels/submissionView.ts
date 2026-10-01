import type { ExerciseTaskSubmissionStatus, SubmissionFinished } from "../shared/langsSchema"
import type { FeedbackQuestion, SubmissionView, WebviewError } from "../shared/shared"
import { assertUnreachable, isMoocScorePassing } from "../shared/shared"

/** The phases in which the backend is still working on the submission. */
export type InProgressPhase = "uploading" | "grading"

/** What the backend has reported about a submission it is still working on. */
export interface SubmissionProgress {
  /** 0..1; absent where the backend reports no meaningful fraction. */
  fraction?: number | undefined
  steps: readonly string[]
  submissionUrl?: string | undefined
}

const PROGRESS_STEP_LIMIT = 20

const emptyView = {
  progressSteps: [],
  testCases: [],
  canKeepWaiting: false,
  canPaste: false,
} satisfies Partial<SubmissionView>

/**
 * `steps` with `message` appended, capped to the newest {@link PROGRESS_STEP_LIMIT}.
 *
 * A message repeating the last step is dropped: mooc grading reports the same text on every
 * poll, and only a change is a new step.
 */
export function withProgressStep(steps: readonly string[], message: string | undefined): string[] {
  if (message === undefined || message === steps.at(-1)) {
    return [...steps]
  }
  return [...steps, message].slice(-PROGRESS_STEP_LIMIT)
}

/** A submission the backend is still receiving or grading. */
export function inProgressView(
  phase: InProgressPhase,
  progress: SubmissionProgress,
): SubmissionView {
  return {
    ...emptyView,
    phase,
    headline: phase === "uploading" ? "Sending submission…" : "Processing submission…",
    progressFraction: progress.fraction,
    progressSteps: [...progress.steps],
    submissionUrl: progress.submissionUrl,
  }
}

/** A submission that never reached the backend, or whose result could not be fetched. */
export function submitFailedView(error: WebviewError): SubmissionView {
  return { ...emptyView, phase: "failed", headline: "Submission failed", error }
}

/**
 * A mooc submission the backend received whose grading could not be checked.
 *
 * Unlike {@link submitFailedView}, the work was submitted, so waiting can be tried again.
 */
export function gradingUnavailableView(error: WebviewError): SubmissionView {
  return {
    ...emptyView,
    phase: "failed",
    headline: "Could not check the grading",
    explanation: "Your submission was received, but its grading could not be fetched.",
    error,
    canKeepWaiting: true,
  }
}

/**
 * A TMC server's answer to a submission.
 *
 * @param questions The result's `feedback_questions`, already parsed.
 * @param maxPoints The exercise's available points.
 */
export function tmcResultView(
  result: SubmissionFinished,
  questions: readonly FeedbackQuestion[],
  maxPoints: number,
): SubmissionView {
  const shared = {
    ...emptyView,
    testCases: result.test_cases ?? [],
    validations: result.validations ?? undefined,
    valgrind: result.valgrind || undefined,
    solutionUrl: result.solution_url ?? undefined,
    submissionUrl: result.submission_url,
    feedback:
      result.feedback_answer_url && questions.length > 0
        ? { questions: [...questions], isSent: false }
        : undefined,
    canPaste: result.all_tests_passed !== true,
  }
  const points = { given: result.points.length, max: maxPoints }
  switch (result.status) {
    case "ok":
    case "fail":
      return {
        ...shared,
        phase: "finished",
        headline:
          result.status === "ok" && result.all_tests_passed
            ? "All tests passed on the server"
            : "Some tests failed on the server",
        points,
      }
    case "hidden":
      return {
        ...shared,
        phase: "finished",
        headline: "Submission processed",
        explanation: "The server does not show the test results of this exercise.",
      }
    case "error":
      return {
        ...shared,
        phase: "failed",
        headline: "The server could not process the submission",
        error: {
          message: "Try submitting again.",
          ...(result.error ? { details: result.error } : {}),
        },
      }
    case "processing":
      return {
        ...shared,
        phase: "timedOut",
        headline: "Still processing on the server",
        explanation: "Open the submission in the browser to see its result.",
      }
    default:
      return assertUnreachable(result.status)
  }
}

/**
 * A mooc grading status, as `mooc wait-for-grading` left it.
 *
 * @param maxPoints The exercise's `score_maximum`.
 */
export function moocGradingView(
  status: ExerciseTaskSubmissionStatus,
  maxPoints: number,
): SubmissionView {
  const stillGrading = {
    phase: "timedOut",
    explanation:
      "VS Code stopped waiting before the grading finished. Your submission was received, " +
      "and its score will appear in the course progress once it has been graded.",
    canKeepWaiting: true,
  } as const
  if (status.status === "no-grading-yet") {
    return { ...emptyView, ...stillGrading, headline: "Grading has not started yet" }
  }
  const { grading } = status
  const given =
    grading.score_given === null ? undefined : Math.round(grading.score_given * 100) / 100
  const graded = {
    ...emptyView,
    points: given === undefined ? undefined : { given, max: maxPoints },
    feedbackText: grading.feedback_text ?? undefined,
  }
  switch (grading.grading_progress) {
    case "FullyGraded":
      return {
        ...graded,
        phase: "finished",
        headline: fullyGradedHeadline(given, maxPoints),
        canPaste: given === undefined || given < maxPoints,
      }
    case "Failed":
      return { ...graded, phase: "failed", headline: "Grading failed", canPaste: true }
    case "PendingManual":
      return {
        ...graded,
        phase: "manualReview",
        headline: "Awaiting manual grading",
        explanation:
          "A teacher will grade this submission. The score will appear in the course " +
          "progress once it has been graded.",
      }
    case "Pending":
    case "NotReady":
      return { ...graded, ...stillGrading, headline: "Grading still in progress" }
    default:
      return assertUnreachable(grading.grading_progress)
  }
}

/** The outcome a score tells, in the words `tmcResultView` uses for its tests. */
function fullyGradedHeadline(given: number | undefined, maxPoints: number): string {
  if (given === undefined || maxPoints <= 0) {
    return "Exercise graded"
  }
  return isMoocScorePassing(given, maxPoints)
    ? "All tests passed on the server"
    : "Some tests failed on the server"
}
