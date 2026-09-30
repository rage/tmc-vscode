import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import type Langs from "../api/langs"
import type { WorkspaceExercise } from "../api/workspaceManager"
import { SUBMIT_PROCESS_TIMEOUT } from "../config/constants"
import { findStoredExercise } from "../config/userdata"
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
import { submissionViews } from "../ui/submissionViews"
import { Logger, parseFeedbackQuestion } from "../utilities"
import { checkAiUse } from "./checkAiUse"
import type { ReadyActionContext } from "./types"

/** What a backend answered a submission with, reduced to what the shared flow acts on. */
interface SubmissionOutcome {
  /** Whether the backend graded the submission as passed, which is then recorded locally. */
  passed: boolean
  view: SubmissionView
}

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
    return Ok({ passed: result.status === "ok" && result.all_tests_passed === true, view })
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
    reporter.received()
    const grading = { ...submission, taskSubmissionId: submitted.val.task_submission_id }
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
    return { passed: false, view: gradingUnavailableView(toWebviewError(waited.val, "mooc")) }
  }
  const status = waited.val
  const view = moocGradingView(status, grading.availablePoints)
  if (view.canKeepWaiting) {
    unfinishedGradings.set(panel.id, grading)
  }
  return {
    passed:
      status.status === "grading" &&
      status.grading.grading_progress === "FullyGraded" &&
      status.grading.score_given !== null &&
      status.grading.score_given > 0,
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

/** Records a passed grading locally and shows the outcome, reopening the panel if it was closed. */
async function showOutcome(
  actionContext: ReadyActionContext,
  submission: Submission,
  outcome: SubmissionOutcome,
): Promise<void> {
  const { dialog } = actionContext
  const { exerciseDecorationProvider, userData } = actionContext.startup
  const { exercise } = submission
  if (outcome.passed) {
    const passedResult = await userData.setExerciseAsPassed(
      exercise.backend,
      exercise.courseSlug,
      exercise.exerciseSlug,
    )
    if (passedResult.err) {
      dialog.reportError(
        "Failed to record the exercise as passed.",
        passedResult.val,
        exercise.backend,
      )
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
 * Records the exercise as passed locally when the backend graded it so, and fires
 * {@link onDidFinishSubmission} once the outcome is shown. A failed submission is `Ok`, as the
 * panel shows why. Errs for a failure before the panel opens: a submit or paste already in
 * flight for the same exercise is a `BottleneckError`, and AI assistance that may be on is an
 * `AiUseRefusedError`.
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
