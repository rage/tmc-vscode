import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import type {
  BackendKind,
  CourseIdentifier,
  ExerciseIdentifier,
  ExerciseSubmissionPanel,
  FeedbackAnswer,
  SubmissionView,
  SubmitRefusal,
  LocalCourseExercise,
} from "../../shared/lib"
import {
  backendName,
  LocalCourseData,
  match,
  submitRefusalOf,
  submitRefusalSentence,
  toError,
  unwrap,
} from "../../shared/lib"
import type Langs from "../api/langs"
import type { OperationWarning, Warned } from "../api/withOperation"
import type { WorkspaceExercise } from "../api/workspaceManager"
import type { StoredExercise, UserData } from "../config/userdata"
import {
  ChapterLockedError,
  CourseAccessLostError,
  ExerciseLockedError,
  ChapterNotOpenError,
  NotEnrolledError,
  DeadlinePassedError,
  ExerciseNotFoundError,
  ForbiddenError,
  InvalidRequestError,
  isSessionLost,
  isSubmitRefusal,
  NotFoundError,
  OutOfTriesError,
  UnexpectedResponseError,
} from "../errors"
import { exerciseSubmissionPanel } from "../panels/routes"
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
import type { JobOptions, JobProgress, JobScreen } from "../ui/backgroundJobs"
import { backgroundJobs } from "../ui/backgroundJobs"
import { exerciseOperations } from "../ui/exerciseOperations"
import { nextExerciseOf } from "../ui/exerciseStanding"
import { pointsText } from "../ui/points"
import { isSameExercise, submissionViews } from "../ui/submissionViews"
import { Logger, parseFeedbackQuestion } from "../utilities"
import type { MoocStoredStanding } from "../utilities/apiData"
import { moocStoredStanding } from "../utilities/apiData"
import { saveExerciseDocuments } from "../window/exerciseDocuments"
import { checkAiUse } from "./checkAiUse"
import { checkWorkspaceTrust } from "./checkWorkspaceTrust"
import { recordMoocEnrollment } from "./courseAccess"
import { fingerprintStudentFiles } from "./keptCopies"
import { pendingGradings } from "./pendingGradings"
import { storedExerciseOf } from "./storedExercise"
import type { ReadyActionContext } from "./types"
import { updateCourse } from "./updateCourse"

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
  | {
      backend: "mooc"
      standing: MoocStoredStanding
      awardedPoints: number
    }

/** One submission of an exercise, and the side panel showing it. */
interface Submission {
  panel: ExerciseSubmissionPanel
  exercise: WorkspaceExercise
  exerciseId: ExerciseIdentifier
  courseId: CourseIdentifier
  availablePoints: number
  /** A mooc exercise's course material page, as the stored course last named it. */
  materialPageUrl?: string | undefined
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

/** Fires with the course of each submission whose outcome is shown, graded or not. */
export const onDidFinishSubmission = submissionFinished.event

/** Sends one exercise to its backend and waits for grading, reporting to its panel and `job`. */
type ExerciseSubmitter = (
  submission: Submission,
  job: JobProgress,
) => Promise<Result<SubmissionOutcome, Error>>

/** A TMC submission's feedback questions, not yet answered. */
interface PendingFeedback {
  panel: ExerciseSubmissionPanel
  answerUrl: string
  view: SubmissionView
}

// Keyed by panel id; the answer URL stays in the host so the webview cannot choose where
// answers are posted.
const pendingFeedback = new Map<number, PendingFeedback>()
// Panels whose feedback is being posted, against double clicks.
const feedbackBeingSent = new Set<number>()

/** A mooc submission whose grading the host stopped waiting for. */
interface UnfinishedGrading extends Submission {
  taskSubmissionId: string
  /** The exercise's course material page, which shows the submission's grading. */
  exercisePageUrl: string | undefined
}

// Keyed by panel id so a webview names only its own panel.
const unfinishedGradings = new Map<number, UnfinishedGrading>()

/** Stops the upload a results panel shows, by panel id, while it runs. */
const uploadCancels = new Map<number, () => void>()

/** Stops the upload of the submission results panel `panelId` shows; nothing if none runs. */
export function cancelSubmissionUpload(panelId: number): void {
  uploadCancels.get(panelId)?.()
}

const CANCELLED_VIEW: SubmissionView = {
  ...submitFailedView({ message: "The submission was cancelled." }),
  headline: "Submission cancelled",
  tone: "info",
  explanation: "If it reached the server before you cancelled, it is graded and shows in History.",
}

/** Drops what earlier submissions of `panel`'s exercise left pending. */
function forgetEarlierSubmissions(panel: ExerciseSubmissionPanel): void {
  for (const pending of [unfinishedGradings, pendingFeedback]) {
    for (const [id, earlier] of pending) {
      if (isSameExercise(earlier.panel, panel)) {
        pending.delete(id)
      }
    }
  }
}

function tmcSubmitter(langs: Langs, exerciseId: number): ExerciseSubmitter {
  return async (submission, job) => {
    const reporter = new SubmissionProgressReporter(submission.panel, "uploading")
    const submitted = await langs.submitTmcExerciseAndWaitForResults(
      exerciseId,
      submission.exercise.uri.fsPath,
      (fraction, message) => reporter.report(fraction, message),
      (url) => {
        reporter.received(url)
        job.relabel(gradingJobLabel(submission.exercise))
      },
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

/** Submits, then waits for grading separately, so a student can keep waiting past the poll. */
function moocSubmitter(langs: Langs, exerciseId: string): ExerciseSubmitter {
  return async (submission, job) => {
    const reporter = new SubmissionProgressReporter(submission.panel, "uploading")
    let isCancelled = false
    // An upload reported as failed or cancelled may still have reached the server.
    void pendingGradings.delete(submission.exerciseId)
    const submitted = await langs.submitMoocExercise(
      exerciseId,
      submission.exercise.uri.fsPath,
      (interrupt) =>
        uploadCancels.set(submission.panel.id, () => {
          isCancelled = true
          interrupt()
        }),
    )
    uploadCancels.delete(submission.panel.id)
    if (submitted.err) {
      return isCancelled ? Ok({ recorded: undefined, view: CANCELLED_VIEW }) : submitted
    }
    const exercisePageUrl = submitted.val.exercise_page_url ?? submission.materialPageUrl
    reporter.received(exercisePageUrl)
    job.relabel(gradingJobLabel(submission.exercise))
    const grading = {
      ...submission,
      taskSubmissionId: submitted.val.task_submission_id,
      exercisePageUrl,
    }
    return Ok(await waitForMoocGrading(langs, grading, reporter))
  }
}

/** Whether `error` is a refusal that waiting longer for the grading cannot change. */
function isTerminalGradingFailure(error: Error): boolean {
  return (
    error instanceof NotFoundError ||
    error instanceof ExerciseNotFoundError ||
    error instanceof ForbiddenError ||
    error instanceof InvalidRequestError ||
    error instanceof UnexpectedResponseError ||
    isSessionLost(error)
  )
}

async function rememberPending(grading: UnfinishedGrading): Promise<void> {
  await pendingGradings.set(grading.exerciseId, {
    taskSubmissionId: grading.taskSubmissionId,
    exercisePageUrl: grading.exercisePageUrl,
  })
}

/**
 * Offers the results screen `panel` the grading of `exercise`'s latest submission that a reload
 * stopped waiting for, if there is one, as a grading still in progress.
 *
 * @returns Whether there was one.
 */
export function resumePendingGrading(
  exercise: WorkspaceExercise,
  courseId: CourseIdentifier,
  availablePoints: number,
  panel: ExerciseSubmissionPanel,
): boolean {
  const pending = pendingGradings.get(exercise.id)
  if (!pending) {
    return false
  }
  unfinishedGradings.set(panel.id, {
    panel,
    exercise,
    exerciseId: exercise.id,
    courseId,
    availablePoints,
    taskSubmissionId: pending.taskSubmissionId,
    exercisePageUrl: pending.exercisePageUrl,
  })
  return true
}

function gradingJobLabel(exercise: WorkspaceExercise): string {
  return `Waiting for grading of ${exercise.exerciseSlug}`
}

/** The results screen of `exercise`, as the screen of a job that submits it. */
function resultsScreen(exercise: WorkspaceExercise): JobScreen {
  return { kind: "results", exerciseId: exercise.id, exerciseUri: exercise.uri }
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
    // Waiting longer cannot change a refusal, only a server that did not answer.
    const isWorthWaiting = !isTerminalGradingFailure(waited.val)
    if (isWorthWaiting) {
      unfinishedGradings.set(panel.id, grading)
      await rememberPending(grading)
    } else {
      await pendingGradings.delete(grading.exerciseId)
    }
    return {
      recorded: undefined,
      view: {
        ...gradingUnavailableView(toWebviewError(waited.val)),
        canKeepWaiting: isWorthWaiting,
        submissionUrl: grading.exercisePageUrl,
      },
    }
  }
  const status = waited.val
  const progress = status.status === "grading" ? status.grading.exercise_progress : null
  const view = {
    ...moocGradingView(status, grading.availablePoints),
    submissionUrl:
      (status.status === "grading" ? status.grading.submission_page_url : null) ??
      grading.exercisePageUrl,
  }
  if (view.canKeepWaiting) {
    unfinishedGradings.set(panel.id, grading)
    await rememberPending(grading)
  } else {
    await pendingGradings.delete(grading.exerciseId)
  }
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

/** Records the grading locally and shows the outcome, reopening the panel if closed. */
async function showOutcome(
  actionContext: ReadyActionContext,
  submission: Submission,
  outcome: SubmissionOutcome,
): Promise<Warned> {
  const { exerciseDecorationProvider, userData } = actionContext.startup
  const warnings: OperationWarning[] = []
  const { exercise, exerciseId } = submission
  const { recorded } = outcome
  if (recorded) {
    const written =
      recorded.backend === "tmc"
        ? await userData.setExerciseAsPassed(exerciseId)
        : await userData.setMoocExerciseStanding(
            exerciseId,
            recorded.standing,
            recorded.awardedPoints,
          )
    if (written.err) {
      warnings.push({ headline: "Failed to record the grading.", error: written.val })
    } else {
      exerciseDecorationProvider.updateDecorationsForExercises(exercise)
    }
  }

  submissionViews.update({
    panel: submission.panel,
    view: withNextExercise(userData, submission, outcome.view),
    shouldReopen: true,
  })
  submissionFinished.fire(submission.courseId)
  return { warnings }
}

/** `view`, saying whether the exercise is passed now and, if it is, which one comes next. */
function withNextExercise(
  userData: UserData,
  submission: Submission,
  view: SubmissionView,
): SubmissionView {
  const isExercisePassed = view.phase === "finished" && userData.getPassed(submission.exerciseId)
  const nextExercise = isExercisePassed
    ? nextExerciseOf(userData, submission.courseId, submission.exerciseId)
    : undefined
  return { ...view, isExercisePassed, ...(nextExercise ? { nextExercise } : {}) }
}

/** What {@link checkCanSubmit} found an exercise to be submitted with. */
interface SubmitReady {
  submit: ExerciseSubmitter
  course: LocalCourseData
  courseExercise: LocalCourseExercise
}

/**
 * Whether `exercise` can be submitted now, without submitting it, so a caller can ask the
 * student first. Errs as {@link submitExercise} does before its panel opens.
 */
export async function checkCanSubmit(
  actionContext: ReadyActionContext,
  exercise: WorkspaceExercise,
): Promise<Result<void, Error>> {
  const ready = await readyToSubmit(actionContext, exercise)
  return ready.err ? ready : Ok.EMPTY
}

async function readyToSubmit(
  actionContext: ReadyActionContext,
  exercise: WorkspaceExercise,
): Promise<Result<SubmitReady, Error>> {
  const stored = await storedExerciseWithAccess(actionContext, exercise)
  if (stored.err) {
    return stored
  }
  const { course, exercise: courseExercise } = stored.val
  const submit = submitterFor(actionContext.startup.langs, exercise.backend, exercise.id)
  if (!submit) {
    return Err(
      new Error(`${exercise.exerciseSlug} is not a ${backendName(exercise.backend)} exercise.`),
    )
  }
  let storedCourse = course
  let storedExercise = courseExercise
  let refusal = submitRefusalOf(storedExercise, new Date())
  if (refusal && storedCourse.kind === "mooc") {
    // A deadline or tries the teacher changed, or a fast clock, would be refused for nothing.
    const courseId = LocalCourseData.getCourseId(storedCourse)
    const updated = await updateCourse(actionContext, courseId).catch((e: unknown) =>
      Err(toError(e)),
    )
    const refetched = storedExerciseOf(actionContext, exercise)
    if (updated.ok && updated.val.isUpdated && refetched.ok) {
      storedCourse = refetched.val.course
      storedExercise = refetched.val.exercise
      refusal = submitRefusalOf(storedExercise, new Date())
    }
  }
  if (refusal) {
    return Err(refusalError(refusal, storedExercise))
  }
  const trusted = checkWorkspaceTrust(actionContext)
  if (trusted.err) {
    return trusted
  }
  const { aiUseGate, userData } = actionContext.startup
  let current = storedCourse
  let refused = await aiUseGate.refusal(current, exercise.uri)
  if (refused && current.kind === "mooc") {
    // The teacher may have allowed AI since the course was last fetched.
    const courseId = LocalCourseData.getCourseId(current)
    // A refresh that fails leaves the refusal as it was.
    const updated = await updateCourse(actionContext, courseId).catch((e: unknown) =>
      Err(toError(e)),
    )
    const fetched = userData.getCourse(courseId)
    if (updated.ok && updated.val.isUpdated && fetched.ok) {
      current = fetched.val
      refused = await aiUseGate.refusal(current, exercise.uri)
    }
  }
  if (refused) {
    return Err(refused)
  }
  return Ok({ submit, course: current, courseExercise: storedExercise })
}

/**
 * The exercise as stored, after refreshing its course if the backend last refused it (maybe
 * hours ago). Errs with a `CourseAccessLostError` while the refusal stands.
 */
async function storedExerciseWithAccess(
  actionContext: ReadyActionContext,
  exercise: WorkspaceExercise,
): Promise<Result<StoredExercise, Error>> {
  const stored = storedExerciseOf(actionContext, exercise)
  if (stored.err || LocalCourseData.getAccessLoss(stored.val.course) === undefined) {
    return stored
  }
  const courseId = LocalCourseData.getCourseId(stored.val.course)
  const updated = await updateCourse(actionContext, courseId).catch((e: unknown) => Err(toError(e)))
  if (updated.err) {
    Logger.warn("Failed to recheck access to the course.", updated.val)
  }
  const current = storedExerciseOf(actionContext, exercise)
  if (current.err) {
    return current
  }
  switch (LocalCourseData.getAccessLoss(current.val.course)) {
    case "forbidden":
      return Err(refusalError("courseForbidden", current.val.exercise))
    case "notFound":
      return Err(refusalError("courseNotFound", current.val.exercise))
  }
  return current
}

/**
 * Submits an exercise to the backend it belongs to and shows the grading in a side panel.
 *
 * Records what the backend says about the exercise after the grading, and fires
 * {@link onDidFinishSubmission} once the outcome is shown. A failed submission is `Ok`, as the
 * panel shows why. Errs for a failure before the panel opens: another operation in flight on
 * the exercise is a `BottleneckError`, AI assistance that may be on is an
 * `AiUseRefusedError`, and Restricted Mode is a `WorkspaceUntrustedError`. An exercise the
 * stored data says the backend would refuse is the error {@link refusalError} names, and one
 * hidden until its chapter opens a `ChapterNotOpenError`.
 */
export async function submitExercise(
  actionContext: ReadyActionContext,
  exercise: WorkspaceExercise,
): Promise<Result<Warned, Error>> {
  Logger.info(`Submitting exercise ${exercise.exerciseSlug} to ${backendName(exercise.backend)}`)

  const ready = await readyToSubmit(actionContext, exercise)
  if (ready.err) {
    return ready
  }
  const { submit, course, courseExercise } = ready.val
  const exerciseId = exercise.id
  const courseId = LocalCourseData.getCourseId(course)

  // Held only until the result is posted: the panel offers Paste from then on.
  const job: JobOptions = {
    label: `Submitting ${exercise.exerciseSlug}`,
    screen: resultsScreen(exercise),
    isLong: true,
  }
  return exerciseOperations.run(exerciseId, "submitting", () =>
    backgroundJobs.run(job, async (progress) => {
      const saved = await saveExerciseDocuments(exercise)
      if (saved.err) {
        return saved
      }
      const fingerprint = await fingerprintStudentFiles(actionContext, exercise)
      const submission: Submission = {
        panel: exerciseSubmissionPanel(exercise, { course, exercise: courseExercise }),
        exercise,
        exerciseId,
        courseId,
        availablePoints: unwrap(courseExercise).availablePoints,
        materialPageUrl: courseExercise.kind === "mooc" ? courseExercise.data.pageUrl : undefined,
      }
      forgetEarlierSubmissions(submission.panel)
      submissionViews.open(submission.panel)

      const outcome = await submit(submission, progress)
      if (outcome.ok) {
        await actionContext.startup.keptCopies.record(exerciseId, "submission", fingerprint)
      }
      const enrollment = await recordMoocEnrollment(
        actionContext,
        courseId,
        outcome.err ? outcome.val : undefined,
      )
      if (enrollment.err) {
        Logger.warn("Failed to record the enrollment on the course.", enrollment.val)
      }
      if (outcome.err) {
        Logger.error("Exercise submission failed", outcome.val)
        const error = toWebviewError(outcome.val)
        showSubmissionView(submission.panel, submitFailedView(error))
        if (isSubmitRefusal(outcome.val)) {
          // The stored data did not foresee the refusal, so it is out of date.
          submissionFinished.fire(courseId)
        }
        return Ok({ warnings: [] })
      }
      return Ok(await showOutcome(actionContext, submission, outcome.val))
    }),
  )
}

/** The error a submission refused for `refusal` is, named after `exercise`. */
function refusalError(refusal: SubmitRefusal, exercise: LocalCourseExercise): Error {
  const { name } = exercise.data
  const chapterName = exercise.kind === "mooc" ? exercise.data.chapter?.name : undefined
  const sentence = submitRefusalSentence(refusal, name, chapterName)
  switch (refusal) {
    case "chapterNotUnlockedYet":
    case "chapterCompletedAndLocked":
      return new ChapterLockedError(sentence)
    case "chapterNotOpenYet":
      return new ChapterNotOpenError(sentence)
    case "exerciseLocked":
      return new ExerciseLockedError(sentence)
    case "deadlinePassed":
      return new DeadlinePassedError(sentence)
    case "notEnrolled":
      return new NotEnrolledError(sentence)
    case "courseForbidden":
    case "courseNotFound":
      return new CourseAccessLostError(sentence)
    case "outOfTries": {
      const points = pointsText(exercise.data.awardedPoints, exercise.data.availablePoints)
      return new OutOfTriesError(
        points
          ? `You have no tries left on ${name}, so its ${points.short} points are final.`
          : sentence,
      )
    }
  }
}

/**
 * Resumes waiting for the grading of the submission in panel `panelId`, whose earlier wait
 * ended first. Fires {@link onDidFinishSubmission} like {@link submitExercise}.
 *
 * Errs when the panel shows no such submission, another operation on the exercise is in
 * flight, or AI assistance may be on.
 */
export async function keepWaitingForGrading(
  actionContext: ReadyActionContext,
  panelId: number,
): Promise<Result<Warned, Error>> {
  const grading = unfinishedGradings.get(panelId)
  if (grading === undefined) {
    return Err(new Error("This submission has no grading left to wait for."))
  }
  const allowed = await checkAiUse(actionContext, grading.exercise)
  if (allowed.err) {
    return allowed
  }
  const job: JobOptions = {
    label: gradingJobLabel(grading.exercise),
    screen: resultsScreen(grading.exercise),
    isLong: true,
  }
  return exerciseOperations.run(grading.exerciseId, "submitting", () =>
    backgroundJobs.run(job, async () => {
      unfinishedGradings.delete(panelId)
      const reporter = new SubmissionProgressReporter(grading.panel, "grading")
      const outcome = await waitForMoocGrading(actionContext.startup.langs, grading, reporter)
      return Ok(await showOutcome(actionContext, grading, outcome))
    }),
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
  if (feedbackBeingSent.has(panelId)) {
    return Err(new Error("This submission's feedback is already being sent."))
  }
  feedbackBeingSent.add(panelId)
  const sent = await actionContext.startup.langs
    .submitSubmissionFeedback(pending.answerUrl, {
      status: answers.map(({ questionId, answer }) => ({ question_id: questionId, answer })),
    })
    .finally(() => feedbackBeingSent.delete(panelId))
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
