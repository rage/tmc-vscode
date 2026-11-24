import type {
  ExerciseStanding,
  ExerciseTaskSubmissionStatus,
  GradingTestRun,
  SubmissionFinished,
  TestCase,
} from "../../shared/langsSchema"
import type {
  FeedbackQuestion,
  LocalCourseExercise,
  SubmissionView,
  WebviewError,
} from "../../shared/lib"
import {
  arePointsHeldForReview,
  assertUnreachable,
  pendingReviewSentence,
  unwrap,
} from "../../shared/lib"

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
    tone: "progress",
    progressFraction: progress.fraction,
    progressSteps: [...progress.steps],
    submissionUrl: progress.submissionUrl,
  }
}

/**
 * An exercise's results screen with no submission to show: where the exercise stands as its
 * course last reported it.
 *
 * @param solutionUrl The model solution's page, once the backend shows it to the student.
 */
export function standingView(
  exercise: LocalCourseExercise,
  solutionUrl: string | undefined,
): SubmissionView {
  const { passed, awardedPoints, availablePoints, attempted } = unwrap(exercise)
  const isOutOfTries = exercise.kind === "mooc" && exercise.data.outOfTries === true
  const arePointsHeld =
    exercise.kind === "mooc" && arePointsHeldForReview(exercise.data.pendingReview, awardedPoints)
  const wasSubmitted = attempted === true || awardedPoints > 0
  return {
    ...emptyView,
    phase: "standing",
    headline: passed ? "Passed" : arePointsHeld ? "Waiting for review" : "Not passed",
    // As the grading of its latest submission read, so the screen looks the same reopened.
    tone: passed
      ? "passed"
      : isOutOfTries
        ? "failed"
        : wasSubmitted && !arePointsHeld
          ? scoreTone(awardedPoints)
          : "info",
    ...(wasSubmitted && !passed ? { wasSubmitted: true } : {}),
    points:
      availablePoints > 0 && !arePointsHeld
        ? { given: awardedPoints, max: availablePoints }
        : undefined,
    ...(arePointsHeld && availablePoints > 0 ? { heldPointsMax: availablePoints } : {}),
    solutionUrl,
    canPaste: !passed,
    isExercisePassed: passed,
  }
}

/**
 * Every test passed in the student's own run, so submitting is the next step.
 *
 * @param localPassAt See {@link SubmissionView.localPassAt}.
 */
export function testedLocallyView(localPassAt: number): SubmissionView {
  return {
    ...emptyView,
    phase: "testedLocally",
    headline: "Tests pass on your computer",
    tone: "passed",
    explanation: "Submit the exercise to have it graded.",
    localPassAt,
  }
}

/** A submission that never reached the backend, or whose result could not be fetched. */
export function submitFailedView(error: WebviewError): SubmissionView {
  return { ...emptyView, phase: "failed", headline: "Submission failed", tone: "failed", error }
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
    tone: "warning",
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
    case "fail": {
      const isPassed = result.status === "ok" && result.all_tests_passed === true
      return {
        ...shared,
        phase: "finished",
        headline: isPassed ? "Passed" : "Not passed",
        tone: isPassed ? "passed" : scoreTone(points.given),
        points,
      }
    }
    case "hidden":
      return {
        ...shared,
        phase: "finished",
        headline: "Submission processed",
        tone: "info",
        explanation: "The server does not show the test results of this exercise.",
      }
    case "error":
      return {
        ...shared,
        phase: "failed",
        headline: "The server could not process the submission",
        tone: "failed",
        error: { message: "Try submitting again." },
        ...(result.error ? { serverOutput: result.error } : {}),
      }
    case "processing":
      return {
        ...shared,
        phase: "timedOut",
        headline: "Still processing on the server",
        tone: "info",
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
    tone: "info",
    explanation:
      "VS Code stopped waiting before the grading finished. Your submission was received, " +
      "and its score will appear in the course progress once it has been graded.",
    canKeepWaiting: true,
  } as const
  if (status.status === "no-grading-yet") {
    return { ...emptyView, ...stillGrading, headline: "Grading has not started yet" }
  }
  if (status.status === "grading-hidden") {
    return {
      ...emptyView,
      phase: "finished",
      headline: "Submission received",
      tone: "info",
      explanation: "Its result is shown once the exam ends.",
    }
  }
  if (status.status === "unrecognized") {
    return {
      ...emptyView,
      phase: "finished",
      headline: "Submission received",
      tone: "info",
      explanation:
        "This version of TestMyCode cannot show its grading. See its result on the course page.",
    }
  }
  const { grading } = status
  const given =
    grading.score_given === null ? undefined : Math.round(grading.score_given * 100) / 100
  const graded = {
    ...emptyView,
    points: given === undefined ? undefined : { given, max: maxPoints },
    feedbackText: grading.feedback_text ?? undefined,
    testCases: grading.test_results?.test_results.map((result) => toTestCase(result)) ?? [],
    ...testRunFailure(grading.test_results),
  }
  const standing = grading.exercise_progress?.standing
  // A pass may come from an earlier submission; a short score is about this one.
  const isBelowMax = given !== undefined && given < maxPoints
  const isPassedEarlier = standing === "Passed" && isBelowMax
  const pendingReview = grading.exercise_progress?.pending_teacher_review ?? null
  const progressPoints = grading.exercise_progress?.score_given ?? 0
  const reviewNote =
    pendingReview === null
      ? {}
      : { pendingReview: pendingReviewSentence(pendingReview, progressPoints) }
  switch (grading.grading_progress) {
    case "FullyGraded":
      if (arePointsHeldForReview(pendingReview, progressPoints)) {
        // Only the grading's own score tells how the tests went.
        return {
          ...graded,
          phase: "finished",
          headline: isBelowMax ? "Some tests failed" : "All tests passed",
          tone: isBelowMax ? scoreTone(given) : "passed",
          points: undefined,
          heldPointsMax: maxPoints,
          ...reviewNote,
          canPaste: true,
        }
      }
      return {
        ...graded,
        ...reviewNote,
        phase: "finished",
        // The exercise's outcome, as its standing reads in a later session too.
        headline: isPassedEarlier
          ? "Passed"
          : isBelowMax
            ? "Not passed"
            : fullyGradedHeadline(standing),
        // This score does not count, so it is no failure, and a meter of it would read as lost points.
        tone: isPassedEarlier ? "info" : isBelowMax ? scoreTone(given) : fullyGradedTone(standing),
        ...(isPassedEarlier ? { points: undefined } : {}),
        ...fullyGradedExplanation(standing, isBelowMax),
        canPaste: standing !== "Passed" || isBelowMax,
      }
    case "Failed":
      return {
        ...graded,
        phase: "failed",
        headline: "Grading failed",
        tone: "failed",
        canPaste: true,
      }
    case "PendingManual":
      return {
        ...graded,
        phase: "manualReview",
        headline: "Awaiting manual grading",
        tone: "info",
        explanation:
          "A teacher will grade this submission. The score will appear in the course " +
          "progress once it has been graded.",
      }
    case "Pending":
    case "NotReady":
      return { ...graded, ...stillGrading, headline: "Grading still in progress" }
    case "Unrecognized":
      return {
        ...graded,
        phase: "finished",
        headline: "Submission graded",
        tone: "info",
        explanation:
          "This version of TestMyCode cannot show this grading. See its result on the course page.",
      }
    default:
      return assertUnreachable(grading.grading_progress)
  }
}

/** A mooc test result as the TMC result's test case the panel renders. */
function toTestCase({
  name,
  successful,
  message,
  exception,
}: GradingTestRun["test_results"][number]): TestCase {
  return { name, successful, message, exception, detailed_message: null }
}

/** Why the server's test run produced no test results, with the output that tells. */
function testRunFailure(
  run: GradingTestRun | null,
): Pick<SubmissionView, "error" | "serverOutput"> {
  const message =
    run?.status === "COMPILE_FAILED"
      ? "Your code did not compile on the server."
      : run?.status === "GENERIC_ERROR"
        ? "The tests could not be run on the server."
        : undefined
  if (message === undefined) {
    return {}
  }
  const output = Object.values(run?.logs ?? {})
    .filter((log) => log.trim() !== "")
    .join("\n\n")
  return output === "" ? { error: { message } } : { error: { message }, serverOutput: output }
}

function fullyGradedExplanation(
  standing: ExerciseStanding | null | undefined,
  isBelowMax: boolean,
): { explanation?: string } {
  if (standing === "OutOfTries") {
    return { explanation: "That was your last try, so this score is final." }
  }
  if (standing === "Passed" && isBelowMax) {
    return {
      explanation:
        "This submission failed some tests. You keep the points of your earlier passing submission.",
    }
  }
  return {}
}

/** A score short of the maximum: some points read as partial success, none as a failure. */
function scoreTone(given: number): SubmissionView["tone"] {
  return given > 0 ? "warning" : "failed"
}

/** The tone of {@link fullyGradedHeadline}. */
function fullyGradedTone(standing: ExerciseStanding | null | undefined): SubmissionView["tone"] {
  switch (standing) {
    case "Passed":
      return "passed"
    case "Attempted":
    case "OutOfTries":
      return "failed"
    default:
      return "info"
  }
}

/** The outcome the backend's standing tells, for a submission scored in full or not at all. */
function fullyGradedHeadline(standing: ExerciseStanding | null | undefined): string {
  switch (standing) {
    case "Passed":
      return "Passed"
    case "Attempted":
    case "OutOfTries":
      return "Not passed"
    default:
      return "Graded"
  }
}

/**
 * `view` with the exercise as it now stands, which the submit action that built it cannot know:
 * files or the exercise may go away while it is shown, and a grading or deadline changes what
 * the backend accepts.
 *
 * @param exercise.submitRefusal See {@link SubmissionView.submitRefusal}.
 * @param exercise.submitRefusalLabel The refusal in a few words, e.g. "Deadline passed": the
 *   headline of a standing that is not passed, as it can no longer be.
 * @param exercise.pendingReview See {@link SubmissionView.pendingReview}; replaces the one a
 *   finished grading was shown with.
 * @param exercise.solutionUrl The model solution's page once the stored course reveals it; fills
 *   in a view that has none.
 * @param exercise.materialUrl See {@link SubmissionView.materialUrl}.
 * @param exercise.isLoggedOut See {@link SubmissionView.isLoggedOut}.
 * @param exercise.arePointsHeld A teacher's review holds the exercise's points back now, so a
 *   finished grading's score is not what the student has.
 */
export function withExerciseState(
  view: SubmissionView,
  exercise: {
    isOnDisk: boolean
    isInCourse: boolean
    submitRefusal?: string | undefined
    submitRefusalLabel?: string | undefined
    triesLeft?: number | undefined
    pendingReview?: string | undefined
    solutionUrl?: string | undefined
    materialUrl?: string | undefined
    isLoggedOut?: boolean | undefined
    arePointsHeld?: boolean | undefined
  },
): SubmissionView {
  const {
    exerciseState: _exerciseState,
    submitRefusal: _submitRefusal,
    triesLeft: _triesLeft,
    isLoggedOut: _isLoggedOut,
    pendingReview: gradedPendingReview,
    ...rest
  } = view
  if (!exercise.isInCourse) {
    return { ...rest, exerciseState: "removed" }
  }
  const pendingReview =
    view.phase === "finished" || view.phase === "standing"
      ? exercise.pendingReview
      : gradedPendingReview
  const isInProgress = view.phase === "uploading" || view.phase === "grading"
  const solutionUrl = isInProgress ? undefined : (view.solutionUrl ?? exercise.solutionUrl)
  const isClosed = exercise.submitRefusal !== undefined
  // As a grading held for review at grading time reads: the tests' outcome, and no points.
  const heldForReview =
    exercise.arePointsHeld && view.phase === "finished" && rest.points !== undefined
      ? {
          points: undefined,
          heldPointsMax: rest.points.max,
          ...(view.headline === "Passed" ? { headline: "All tests passed" } : {}),
        }
      : {}
  const standing = {
    ...rest,
    ...heldForReview,
    ...(isClosed &&
    view.phase === "standing" &&
    !view.isExercisePassed &&
    exercise.submitRefusalLabel
      ? { headline: exercise.submitRefusalLabel }
      : {}),
    // Nothing tested locally can be submitted any more.
    ...(isClosed && view.phase === "testedLocally" ? { explanation: undefined } : {}),
    ...(solutionUrl === undefined ? {} : { solutionUrl }),
    ...(exercise.materialUrl === undefined ? {} : { materialUrl: exercise.materialUrl }),
    ...(pendingReview === undefined ? {} : { pendingReview }),
    ...(exercise.submitRefusal === undefined ? {} : { submitRefusal: exercise.submitRefusal }),
    ...(exercise.triesLeft === undefined ? {} : { triesLeft: exercise.triesLeft }),
    ...(exercise.isLoggedOut ? { isLoggedOut: true } : {}),
  }
  return exercise.isOnDisk ? standing : { ...standing, exerciseState: "notOnDisk" }
}
