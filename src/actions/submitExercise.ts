import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import type * as vscode from "vscode"

import type Langs from "../api/langs"
import { shownInPanel } from "../api/withOperation"
import type { WorkspaceExercise } from "../api/workspaceManager"
import { SUBMIT_PROCESS_TIMEOUT } from "../config/constants"
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
import { TmcPanel } from "../panels/TmcPanel"
import type {
  BackendKind,
  CourseIdentifier,
  ExerciseIdentifier,
  ExerciseSubmissionPanel,
  SubmissionView,
  TargetPanel,
} from "../shared/shared"
import {
  backendName,
  LocalCourseData,
  LocalCourseExercise,
  match,
  panelTarget,
  toWebviewError,
  unwrap,
} from "../shared/shared"
import { exerciseOperations } from "../ui/exerciseOperations"
import { Logger, parseFeedbackQuestion } from "../utilities"
import type { ReadyActionContext } from "./types"

/** What a backend answered a submission with, reduced to what the shared flow acts on. */
interface SubmissionOutcome {
  /** Whether the backend graded the submission as passed, which is then recorded locally. */
  passed: boolean
  view: SubmissionView
}

/** Collects what a backend reports while it works on a submission, and shows it in the panel. */
class SubmissionProgressReporter {
  private _phase: InProgressPhase
  private _progress: SubmissionProgress = { steps: [] }

  public constructor(
    private readonly _target: TargetPanel<ExerciseSubmissionPanel>,
    phase: InProgressPhase,
  ) {
    this._phase = phase
    showSubmissionView(this._target, inProgressView(this._phase, this._progress))
  }

  /** @param fraction 0..1, or undefined where the backend's own is meaningless. */
  public report(fraction: number | undefined, message?: string): void {
    this._progress = {
      ...this._progress,
      fraction,
      steps: withProgressStep(this._progress.steps, message),
    }
    showSubmissionView(this._target, inProgressView(this._phase, this._progress))
  }

  /** The backend has the submission; `submissionUrl` is its page there, if it has one. */
  public received(submissionUrl?: string): void {
    this._phase = "grading"
    this._progress = { ...this._progress, submissionUrl }
    showSubmissionView(this._target, inProgressView(this._phase, this._progress))
  }
}

function showSubmissionView(
  target: TargetPanel<ExerciseSubmissionPanel>,
  view: SubmissionView,
): void {
  TmcPanel.postMessage({ type: "submissionView", target, view })
}

/** Sends one exercise to its backend and waits for the grading, reporting progress to `panel`. */
type ExerciseSubmitter = (
  panel: ExerciseSubmissionPanel,
  exercise: WorkspaceExercise,
) => Promise<Result<SubmissionOutcome, Error>>

// Answering only URLs a submission result named keeps the webview from choosing where to post.
const answerableFeedbackUrls = new Set<string>()

/** A mooc submission whose grading the host stopped waiting for. */
interface UnfinishedGrading {
  taskSubmissionId: string
  panel: ExerciseSubmissionPanel
  exercise: WorkspaceExercise
}

// Keyed by the panel showing the submission, so a webview names only which panel it is.
const unfinishedGradings = new Map<number, UnfinishedGrading>()

function tmcSubmitter(langs: Langs, exerciseId: number): ExerciseSubmitter {
  return async (panel, exercise) => {
    const reporter = new SubmissionProgressReporter(panelTarget(panel), "uploading")
    const submission = await langs.submitTmcExerciseAndWaitForResults(
      exerciseId,
      exercise.uri.fsPath,
      (fraction, message) => reporter.report(fraction, message),
      (url) => reporter.received(url),
    )
    if (submission.err) {
      return submission
    }
    const result = submission.val
    const questions = result.feedback_questions
      ? parseFeedbackQuestion(result.feedback_questions)
      : []
    if (result.feedback_answer_url && questions.length > 0) {
      answerableFeedbackUrls.add(result.feedback_answer_url)
    }
    return Ok({
      passed: result.status === "ok" && result.all_tests_passed === true,
      view: tmcResultView(result, questions, unwrap(panel.exercise).availablePoints),
    })
  }
}

/**
 * Submits without blocking, then waits for the grading separately: the task submission id in
 * between is what lets the student keep waiting after the CLI's poll gives up.
 */
function moocSubmitter(langs: Langs, exerciseId: string): ExerciseSubmitter {
  return async (panel, exercise) => {
    const reporter = new SubmissionProgressReporter(panelTarget(panel), "uploading")
    const submitted = await langs.submitMoocExercise(exerciseId, exercise.uri.fsPath)
    if (submitted.err) {
      return submitted
    }
    reporter.received()
    const grading = { taskSubmissionId: submitted.val.task_submission_id, panel, exercise }
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
    return { passed: false, view: gradingUnavailableView(toWebviewError(waited.val)) }
  }
  const status = waited.val
  const view = moocGradingView(status, unwrap(panel.exercise).availablePoints)
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
  context: vscode.ExtensionContext,
  actionContext: ReadyActionContext,
  exercise: WorkspaceExercise,
  panel: ExerciseSubmissionPanel,
  outcome: SubmissionOutcome,
): Promise<void> {
  const { dialog } = actionContext
  const { exerciseDecorationProvider, userData } = actionContext.startup
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

  if (TmcPanel.sidePanel === undefined) {
    TmcPanel.renderSide(context, actionContext, panel)
  }
  showSubmissionView(panelTarget(panel), outcome.view)
}

/**
 * Submits an exercise to the backend it belongs to and shows the grading in a side panel.
 *
 * Records the exercise as passed locally when the backend graded it so. Returns the
 * exercise's course id on success, so the caller can refresh that course's totals. A
 * submit or paste already in flight for the same exercise makes this a `BottleneckError`.
 */
export async function submitExercise(
  context: vscode.ExtensionContext,
  actionContext: ReadyActionContext,
  exercise: WorkspaceExercise,
): Promise<Result<CourseIdentifier, Error>> {
  const { langs, userData } = actionContext.startup
  Logger.info(`Submitting exercise ${exercise.exerciseSlug} to ${backendName(exercise.backend)}`)

  const courseResult = userData.getCourseBySlug(exercise.backend, exercise.courseSlug)
  if (courseResult.err) {
    return courseResult
  }
  const course = courseResult.val
  const courseExercise = LocalCourseData.getExercises(course).find(
    (x) => LocalCourseExercise.getSlug(x) === exercise.exerciseSlug,
  )
  if (!courseExercise) {
    return Err(
      new Error(`ID for exercise ${exercise.courseSlug}/${exercise.exerciseSlug} was not found.`),
    )
  }
  const submit = submitterFor(langs, exercise.backend, LocalCourseExercise.getId(courseExercise))
  if (!submit) {
    return Err(
      new Error(`${exercise.exerciseSlug} is not a ${backendName(exercise.backend)} exercise.`),
    )
  }

  // Held only until the result is posted: the panel offers Paste from that point on, and
  // the command layer's post-submit refresh doesn't need the same protection.
  const submitted = await exerciseOperations.run(
    LocalCourseExercise.getId(courseExercise),
    "submitting",
    SUBMIT_PROCESS_TIMEOUT + 30_000,
    async () => {
      const panel: ExerciseSubmissionPanel = {
        id: nextPanelId(),
        type: "ExerciseSubmission",
        course,
        exercise: courseExercise,
      }
      TmcPanel.renderSide(context, actionContext, panel)

      const outcome = await submit(panel, exercise)
      if (outcome.err) {
        showSubmissionView(panelTarget(panel), submitFailedView(toWebviewError(outcome.val)))
        return shownInPanel(outcome.val)
      }
      await showOutcome(context, actionContext, exercise, panel, outcome.val)
      return Ok.EMPTY
    },
  )
  if (submitted.err) {
    return submitted
  }

  return Ok(LocalCourseData.getCourseId(course))
}

/**
 * Waits again for the grading of the submission panel `panelId` shows, after the wait that
 * followed its submit ended before the grading did.
 *
 * Returns the exercise's course id, like {@link submitExercise}. Errs when that panel shows
 * no such submission, or when a submission of the exercise is already in progress.
 */
export async function keepWaitingForGrading(
  context: vscode.ExtensionContext,
  actionContext: ReadyActionContext,
  panelId: number,
): Promise<Result<CourseIdentifier, Error>> {
  const grading = unfinishedGradings.get(panelId)
  if (grading === undefined) {
    return Err(new Error("This submission has no grading left to wait for."))
  }
  return exerciseOperations.run(
    LocalCourseExercise.getId(grading.panel.exercise),
    "submitting",
    SUBMIT_PROCESS_TIMEOUT + 30_000,
    async () => {
      unfinishedGradings.delete(panelId)
      const reporter = new SubmissionProgressReporter(panelTarget(grading.panel), "grading")
      const outcome = await waitForMoocGrading(actionContext.startup.langs, grading, reporter)
      await showOutcome(context, actionContext, grading.exercise, grading.panel, outcome)
      return Ok(LocalCourseData.getCourseId(grading.panel.course))
    },
  )
}

/** One answer to a TMC submission's feedback question. */
export interface FeedbackAnswer {
  questionId: number
  answer: string
}

/**
 * Sends a student's answers to the feedback questions a TMC submission result asked.
 *
 * `feedbackAnswerUrl` must be one a submission result named this session; each is answered
 * once. A failed send can be retried.
 */
export async function sendSubmissionFeedback(
  actionContext: ReadyActionContext,
  feedbackAnswerUrl: string,
  answers: readonly FeedbackAnswer[],
): Promise<Result<void, Error>> {
  if (!answerableFeedbackUrls.has(feedbackAnswerUrl)) {
    return Err(new Error("This submission's feedback was already sent or was never asked for."))
  }
  const sent = await actionContext.startup.langs.submitSubmissionFeedback(feedbackAnswerUrl, {
    status: answers.map(({ questionId, answer }) => ({ question_id: questionId, answer })),
  })
  if (sent.err) {
    return sent
  }
  answerableFeedbackUrls.delete(feedbackAnswerUrl)
  return Ok.EMPTY
}
