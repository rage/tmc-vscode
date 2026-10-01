import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import type Langs from "../api/langs"
import type { WorkspaceExercise } from "../api/workspaceManager"
import { SUBMIT_PROCESS_TIMEOUT } from "../config/constants"
import { findStoredExercise } from "../config/userdata"
import { OutOfTriesError } from "../errors"
import { nextPanelId } from "../panels/routes"
import type { InProgressPhase, SubmissionProgress } from "../panels/submissionView"
import {
  gradingUnavailableView,
  inProgressView,
  moocGradingView,
  submitFailedView,
  tmcResultView,
  withProgressStep,
} from "../panels/submissionView"
import { toWebviewError } from "../panels/webviewError"
import type {
  BackendKind,
  CourseIdentifier,
  ExerciseIdentifier,
  ExerciseSubmissionPanel,
  FeedbackAnswer,
  SubmissionView,
} from "../shared/shared"
import { backendName, LocalCourseData, LocalCourseExercise, match, unwrap } from "../shared/shared"
import { exerciseOperations } from "../ui/exerciseOperations"
import { pointsText } from "../ui/points"
import { submissionViews } from "../ui/submissionViews"
import { Logger, parseFeedbackQuestion } from "../utilities"
import type { MoocStoredStanding } from "../utilities/apiData"
import { moocStoredStanding } from "../utilities/apiData"
import { checkAiUse } from "./checkAiUse"
import type { ReadyActionContext } from "./types"

/** What a backend answered a submission with, reduced to what the shared flow acts on. */
interface SubmissionOutcome {
  /** What the backend says about the exercise after this submission; recorded locally. */
  recorded: RecordedGrading | undefined
  view: SubmissionView
}

/**
 * A tmc submission records only a pass. A mooc one records the backend's standing and points,
 * when the CLI and host are new enough to report them; otherwise the course refresh decides.
 */
type RecordedGrading =
  | { backend: "tmc" }
  | { backend: "mooc"; standing: MoocStoredStanding; awardedPoints: number }

/** One submission of an exercise, and the side panel showing it. */
interface Submission {
  panel: ExerciseSubmissionPanel
  exercise: WorkspaceExercise
  exerciseId: ExerciseIdentifier
  courseId: CourseIdentifier
  availablePoints: number
}

/** Collects what a backend reports while it works on a submission, and shows it in the panel. */
class SubmissionProgressReporter {
  private _phase: InProgressPhase
  private _progress: SubmissionProgress = { steps: [] }

  public constructor(
    private readonly _panel: ExerciseSubmissionPanel,
    phase: InProgressPhase,
  ) {
    this._phase = phase
    showSubmissionView(this._panel, inProgressView(this._phase, this._progress))
  }

  /** @param fraction 0..1, or undefined where the backend's own is meaningless. */
  public report(fraction: number | undefined, message?: string): void {
    this._progress = {
      ...this._progress,
      fraction,
      steps: withProgressStep(this._progress.steps, message),
    }
    showSubmissionView(this._panel, inProgressView(this._phase, this._progress))
  }

  /** The backend has the submission; `submissionUrl` is its page there, if it has one. */
  public received(submissionUrl?: string): void {
    this._phase = "grading"
    this._progress = { ...this._progress, submissionUrl }
    showSubmissionView(this._panel, inProgressView(this._phase, this._progress))
  }
}

function showSubmissionView(panel: ExerciseSubmissionPanel, view: SubmissionView): void {
  submissionViews.update({ panel, view, shouldReopen: false })
}

const submissionFinished = new vscode.EventEmitter<CourseIdentifier>()

/**
 * Fires with the course of each submission whose outcome is shown, graded or not, as the
 * backend's point totals for it may have changed.
 */
export const onDidFinishSubmission = submissionFinished.event

/** Sends one exercise to its backend and waits for the grading, reporting progress to its panel. */
type ExerciseSubmitter = (submission: Submission) => Promise<Result<SubmissionOutcome, Error>>

/** A TMC submission's feedback questions, not yet answered. */
interface PendingFeedback {
  panel: ExerciseSubmissionPanel
  answerUrl: string
  view: SubmissionView
}

// Keyed by panel id like `unfinishedGradings`; the answer URL never leaves the host, so the
// webview cannot choose where answers are posted.
const pendingFeedback = new Map<number, PendingFeedback>()

/** A mooc submission whose grading the host stopped waiting for. */
interface UnfinishedGrading extends Submission {
  taskSubmissionId: string
  /** The exercise's course material page, which shows the submission's grading. */
  exercisePageUrl: string | undefined
}

// Keyed by the panel showing the submission, so a webview names only which panel it is.
const unfinishedGradings = new Map<number, UnfinishedGrading>()

function tmcSubmitter(langs: Langs, exerciseId: number): ExerciseSubmitter {
  return async (submission) => {
    const reporter = new SubmissionProgressReporter(submission.panel, "uploading")
    const submitted = await langs.submitTmcExerciseAndWaitForResults(
      exerciseId,
      submission.exercise.uri.fsPath,
      (fraction, message) => reporter.report(fraction, message),
      (url) => reporter.received(url),
    )
    if (submitted.err) {
      return submitted
    }
    const result = submitted.val
    const questions = result.feedback_questions
      ? parseFeedbackQuestion(result.feedback_questions)
      : []
    const view = tmcResultView(result, questions, submission.availablePoints)
    if (view.feedback && result.feedback_answer_url) {
      pendingFeedback.set(submission.panel.id, {
        panel: submission.panel,
        answerUrl: result.feedback_answer_url,
        view,
      })
    }
    const passed = result.status === "ok" && result.all_tests_passed === true
    return Ok({ recorded: passed ? { backend: "tmc" } : undefined, view })
  }
}

/**
 * Submits without blocking, then waits for the grading separately: the task submission id in
 * between is what lets the student keep waiting after the CLI's poll gives up.
 */
function moocSubmitter(langs: Langs, exerciseId: string): ExerciseSubmitter {
  return async (submission) => {
    const reporter = new SubmissionProgressReporter(submission.panel, "uploading")
    const submitted = await langs.submitMoocExercise(exerciseId, submission.exercise.uri.fsPath)
    if (submitted.err) {
      return submitted
    }
    const exercisePageUrl = submitted.val.exercise_page_url ?? undefined
    reporter.received(exercisePageUrl)
    const grading = {
      ...submission,
      taskSubmissionId: submitted.val.task_submission_id,
      exercisePageUrl,
    }
    return Ok(await waitForMoocGrading(langs, grading, reporter))
  }
}

async function waitForMoocGrading(
  langs: Langs,
  grading: UnfinishedGrading,
  reporter: SubmissionProgressReporter,
): Promise<SubmissionOutcome> {
  const { panel, taskSubmissionId } = grading
  const waited = await langs.waitForMoocGrading(taskSubmissionId, (_fraction, message) =>
    reporter.report(undefined, message),
  )
  if (waited.err) {
    Logger.error("Failed to wait for the grading of a submission", waited.val)
    unfinishedGradings.set(panel.id, grading)
    return {
      recorded: undefined,
      view: {
        ...gradingUnavailableView(toWebviewError(waited.val, "mooc")),
        submissionUrl: grading.exercisePageUrl,
      },
    }
  }
  const status = waited.val
  const view = {
    ...moocGradingView(status, grading.availablePoints),
    submissionUrl: grading.exercisePageUrl,
  }
  if (view.canKeepWaiting) {
    unfinishedGradings.set(panel.id, grading)
  }
  const progress = status.status === "grading" ? status.grading.exercise_progress : null
  return {
    recorded: progress?.standing
      ? {
          backend: "mooc",
          standing: moocStoredStanding(progress),
          awardedPoints: progress.score_given,
        }
      : undefined,
    view,
  }
}

/**
 * Picks the submit call for `backend`, or `undefined` when `exerciseId` is not the kind of
 * id that backend uses, which means the stored course and the exercise disagree.
 */
function submitterFor(
  langs: Langs,
  backend: BackendKind,
  exerciseId: ExerciseIdentifier,
): ExerciseSubmitter | undefined {
  return match(
    exerciseId,
    (tmc) => (backend === "tmc" ? tmcSubmitter(langs, tmc.tmcExerciseId) : undefined),
    (mooc) => (backend === "mooc" ? moocSubmitter(langs, mooc.moocExerciseId) : undefined),
  )
}

/** Records the grading locally and shows the outcome, reopening the panel if it was closed. */
async function showOutcome(
  actionContext: ReadyActionContext,
  submission: Submission,
  outcome: SubmissionOutcome,
): Promise<void> {
  const { dialog } = actionContext
  const { exerciseDecorationProvider, userData } = actionContext.startup
  const { exercise } = submission
  const { recorded } = outcome
  if (recorded) {
    const written =
      recorded.backend === "tmc"
        ? await userData.setExerciseAsPassed("tmc", exercise.courseSlug, exercise.exerciseSlug)
        : await userData.setMoocExerciseStanding(
            exercise.courseSlug,
            exercise.exerciseSlug,
            recorded.standing,
            recorded.awardedPoints,
          )
    if (written.err) {
      dialog.reportError("Failed to record the grading.", written.val, exercise.backend)
    } else {
      exerciseDecorationProvider.updateDecorationsForExercises(exercise)
    }
  }

  submissionViews.update({ panel: submission.panel, view: outcome.view, shouldReopen: true })
  submissionFinished.fire(submission.courseId)
}

/**
 * Submits an exercise to the backend it belongs to and shows the grading in a side panel.
 *
 * Records what the backend says about the exercise after the grading, and fires
 * {@link onDidFinishSubmission} once the outcome is shown. A failed submission is `Ok`, as the
 * panel shows why. Errs for a failure before the panel opens: a submit or paste already in
 * flight for the same exercise is a `BottleneckError`, AI assistance that may be on is an
 * `AiUseRefusedError`, and an exercise the backend last reported out of tries is an
 * `OutOfTriesError`.
 */
export async function submitExercise(
  actionContext: ReadyActionContext,
  exercise: WorkspaceExercise,
): Promise<Result<void, Error>> {
  const { langs, userData } = actionContext.startup
  Logger.info(`Submitting exercise ${exercise.exerciseSlug} to ${backendName(exercise.backend)}`)

  const stored = findStoredExercise(userData, exercise)
  if (stored.err) {
    return stored
  }
  const { course, exercise: courseExercise } = stored.val
  const exerciseId = LocalCourseExercise.getId(courseExercise)
  const submit = submitterFor(langs, exercise.backend, exerciseId)
  if (!submit) {
    return Err(
      new Error(`${exercise.exerciseSlug} is not a ${backendName(exercise.backend)} exercise.`),
    )
  }
  if (courseExercise.kind === "mooc" && courseExercise.data.outOfTries) {
    const points = pointsText(
      courseExercise.data.awardedPoints,
      courseExercise.data.availablePoints,
    )
    return Err(
      new OutOfTriesError(
        `You have no tries left on ${exercise.exerciseSlug}` +
          (points ? `, so its ${points.short} points are final.` : "."),
      ),
    )
  }
  const refused = await actionContext.startup.aiUseGate.refusal(course, exercise.uri)
  if (refused) {
    return Err(refused)
  }
  const courseId = LocalCourseData.getCourseId(course)

  // Held only until the result is posted: the panel offers Paste from that point on, and
  // the refresh that follows doesn't need the same protection.
  return exerciseOperations.run(
    exerciseId,
    "submitting",
    SUBMIT_PROCESS_TIMEOUT + 30_000,
    async () => {
      const submission: Submission = {
        panel: {
          id: nextPanelId(),
          type: "ExerciseSubmission",
          backend: exercise.backend,
          courseSlug: exercise.courseSlug,
          exerciseSlug: exercise.exerciseSlug,
        },
        exercise,
        exerciseId,
        courseId,
        availablePoints: unwrap(courseExercise).availablePoints,
      }
      // The side panel shows one submission at a time, so what the earlier ones kept is
      // unreachable from here on.
      unfinishedGradings.clear()
      pendingFeedback.clear()
      submissionViews.open(submission.panel)

      const outcome = await submit(submission)
      if (outcome.err) {
        Logger.error("Exercise submission failed", outcome.val)
        const error = toWebviewError(outcome.val, exercise.backend)
        showSubmissionView(submission.panel, submitFailedView(error))
        return Ok.EMPTY
      }
      await showOutcome(actionContext, submission, outcome.val)
      return Ok.EMPTY
    },
  )
}

/**
 * Waits again for the grading of the submission panel `panelId` shows, after the wait that
 * followed its submit ended before the grading did.
 *
 * Fires {@link onDidFinishSubmission} like {@link submitExercise}. Errs when that panel shows
 * no such submission, when a submission of the exercise is already in progress, or as
 * {@link submitExercise} does while AI assistance may be on.
 */
export async function keepWaitingForGrading(
  actionContext: ReadyActionContext,
  panelId: number,
): Promise<Result<void, Error>> {
  const grading = unfinishedGradings.get(panelId)
  if (grading === undefined) {
    return Err(new Error("This submission has no grading left to wait for."))
  }
  const allowed = await checkAiUse(actionContext, grading.exercise)
  if (allowed.err) {
    return allowed
  }
  return exerciseOperations.run(
    grading.exerciseId,
    "submitting",
    SUBMIT_PROCESS_TIMEOUT + 30_000,
    async () => {
      unfinishedGradings.delete(panelId)
      const reporter = new SubmissionProgressReporter(grading.panel, "grading")
      const outcome = await waitForMoocGrading(actionContext.startup.langs, grading, reporter)
      await showOutcome(actionContext, grading, outcome)
      return Ok.EMPTY
    },
  )
}

/**
 * Sends a student's answers to the feedback questions of the TMC submission panel `panelId`
 * shows, then shows that panel its feedback as sent.
 *
 * Each submission's questions are answered once; a failed send can be retried.
 */
export async function sendSubmissionFeedback(
  actionContext: ReadyActionContext,
  panelId: number,
  answers: readonly FeedbackAnswer[],
): Promise<Result<void, Error>> {
  const pending = pendingFeedback.get(panelId)
  if (pending === undefined) {
    return Err(new Error("This submission's feedback was already sent or was never asked for."))
  }
  const sent = await actionContext.startup.langs.submitSubmissionFeedback(pending.answerUrl, {
    status: answers.map(({ questionId, answer }) => ({ question_id: questionId, answer })),
  })
  if (sent.err) {
    return sent
  }
  pendingFeedback.delete(panelId)
  const { view } = pending
  if (view.feedback) {
    showSubmissionView(pending.panel, { ...view, feedback: { ...view.feedback, isSent: true } })
  }
  return Ok.EMPTY
}
