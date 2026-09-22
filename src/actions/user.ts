import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import type Langs from "../api/langs"
import type { WorkspaceExercise } from "../api/workspaceManager"
import {
  CLI_PROCESS_TIMEOUT,
  closedExercisesSettingKey,
  EXERCISE_CHECK_INTERVAL,
  NOTIFICATION_DELAY,
  SUBMIT_PROCESS_TIMEOUT,
} from "../config/constants"
import type { UserData } from "../config/userdata"
import { nextPanelId, TmcPanel } from "../panels/TmcPanel"
import type {
  BackendKind,
  CourseIdentifier,
  ExerciseIdentifier,
  ExerciseSubmissionPanel,
  ExerciseTestsPanel,
  TargetedExtensionToWebview,
  TargetPanel,
  TestResultData,
} from "../shared/shared"
import {
  backendName,
  LocalCourseData,
  LocalCourseExercise,
  match,
  panelTarget,
  toWebviewError,
} from "../shared/shared"
import { Logger, parseFeedbackQuestion, runSingleFlight } from "../utilities"
import { getActiveEditorExecutablePath } from "../window"
import { downloadNewExercisesForCourse } from "./downloadNewExercisesForCourse"
import { refreshLocalExercises } from "./refreshLocalExercises"
import type { ReadyActionContext } from "./types"
import { updateCourse } from "./updateCourse"

export const testInterrupts = new Map<number, (() => void)[]>()

/**
 * Converts a thrown exception into an `Err` Result so a failure in one
 * backend's deauthenticate call can't skip the other in `logout`.
 */
async function safeDeauthenticate(
  deauthenticate: () => Promise<Result<void, Error>>,
): Promise<Result<void, Error>> {
  try {
    return await deauthenticate()
  } catch (e) {
    return Err(e instanceof Error ? e : new Error(String(e)))
  }
}

/**
 * Logs the user out of both backends, updating UI state.
 *
 * Both deauthenticate calls run unconditionally so a failure in one doesn't
 * skip the other; each failure gets its own notification, and the returned
 * `Result` reports whichever failed (tmc's, if both did).
 */
export async function logout(actionContext: ReadyActionContext): Promise<Result<void, Error>> {
  const { dialog } = actionContext
  const { langs } = actionContext.startup

  const result = await safeDeauthenticate(() => langs.deauthenticate())
  if (result.err) {
    dialog.reportError(`Failed to log out of ${backendName("tmc")}.`, result.val, "tmc")
  }
  const moocResult = await safeDeauthenticate(() => langs.deauthenticateMooc())
  if (moocResult.err) {
    dialog.reportError(`Failed to log out of ${backendName("mooc")}.`, moocResult.val, "mooc")
  }

  if (result.err) {
    return result
  }
  if (moocResult.err) {
    return moocResult
  }
  return Ok.EMPTY
}

/**
 * Tests an exercise while keeping the user informed
 */
export async function testExercise(
  context: vscode.ExtensionContext,
  actionContext: ReadyActionContext,
  exercise: WorkspaceExercise,
): Promise<Result<void, Error>> {
  const { dialog } = actionContext
  const { langs, userData } = actionContext.startup

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

  // guards the run-tests + checkstyle pair as one unit against a second click
  const exercisePath = exercise.uri.fsPath
  return runSingleFlight(
    {
      key: `test:${exercisePath}`,
      maxHoldMs: 2 * CLI_PROCESS_TIMEOUT + 30_000,
      busyMessage: "Tests are already running for this exercise.",
      onBusy: (message) => dialog.notification(message),
    },
    async () => {
      const testRunId = nextPanelId()
      // render panel
      const panel: ExerciseTestsPanel = {
        id: nextPanelId(),
        type: "ExerciseTests",
        course: course,
        exercise: courseExercise,
        exerciseUri: exercise.uri,
        testRunId,
      }
      TmcPanel.renderSide(context.extensionUri, context, actionContext, panel)
      const target = panelTarget(panel)

      if (!course.data.perhapsExamMode) {
        const executablePath = getActiveEditorExecutablePath(actionContext)
        const { process: testRunner, interrupt: testInterrupt } = langs.runTests(
          exercise.uri.fsPath,
          executablePath,
        )
        const { process: validationRunner, interrupt: validationInterrupt } = langs.runCheckstyle(
          exercise.uri.fsPath,
        )
        testInterrupts.set(testRunId, [testInterrupt, validationInterrupt])
        const exerciseName = exercise.exerciseSlug

        try {
          Logger.info(`Running local tests and validations for ${exerciseName}`)
          const testResults = await testRunner
          Logger.info(`Tests finished for ${exerciseName}`)

          if (testResults.err) {
            TmcPanel.postMessage({
              type: "testError",
              target,
              error: toWebviewError(testResults.val),
            })
            return Ok.EMPTY
          }

          const validationResults = await validationRunner
          Logger.info(`Validations finished for ${exerciseName}`)

          if (validationResults.err) {
            TmcPanel.postMessage({
              type: "testError",
              target,
              error: toWebviewError(validationResults.val),
            })
            return Ok.EMPTY
          }

          const data: TestResultData = {
            testResult: testResults.val,
            id: LocalCourseExercise.getId(courseExercise),
            courseSlug: LocalCourseData.getCourseName(course),
            exerciseName,
            tmcLogs: testResults.val.logs,
            disabled: course.data.disabled,
            styleValidationResult: validationResults.val,
          }

          if (TmcPanel.sidePanel === undefined) {
            // user closed panel, re-render
            TmcPanel.renderSide(context.extensionUri, context, actionContext, panel)
          }
          TmcPanel.postMessage({
            type: "testResults",
            target,
            testResults: data,
          })
        } finally {
          // Only an explicit cancel removes this otherwise, so every other exit from the
          // run would keep both interrupt closures — and the dead pids they hold — alive.
          testInterrupts.delete(testRunId)
        }
      } else {
        // exam
        TmcPanel.postMessage({
          type: "willNotRunTestsForExam",
          target,
        })
      }

      return Ok.EMPTY
    },
  )
}

/** What a backend answered a submission with, reduced to what the shared flow acts on. */
interface SubmissionOutcome {
  /** Whether the backend graded the submission as passed, which is then recorded locally. */
  passed: boolean
  /** Shows the panel what the backend answered; the two backends answer different shapes. */
  resultMessage: TargetedExtensionToWebview<"ExerciseSubmission">
}

/**
 * Sends one exercise to its backend and waits for the grading, reporting progress to `target`.
 *
 * @param exercisePath The local exercise directory to pack and send.
 */
type ExerciseSubmitter = (
  target: TargetPanel<ExerciseSubmissionPanel>,
  exercisePath: string,
) => Promise<Result<SubmissionOutcome, Error>>

function tmcSubmitter(langs: Langs, exerciseId: number): ExerciseSubmitter {
  return async (target, exercisePath) => {
    const submission = await langs.submitTmcExerciseAndWaitForResults(
      exerciseId,
      exercisePath,
      (fraction, message) => {
        TmcPanel.postMessage({ type: "submissionStatusUpdate", target, fraction, message })
      },
      (url) => {
        TmcPanel.postMessage({ type: "submissionStatusUrl", target, url })
      },
    )
    if (submission.err) {
      return submission
    }
    const result = submission.val
    const outcome: SubmissionOutcome = {
      passed: result.status === "ok" && result.all_tests_passed === true,
      resultMessage: {
        type: "submissionResult",
        target,
        result,
        questions: result.feedback_questions
          ? parseFeedbackQuestion(result.feedback_questions)
          : [],
      },
    }
    return Ok(outcome)
  }
}

/**
 * Mooc grading has no per-test breakdown or feedback questions, so the panel shows only the
 * overall grading progress, score and feedback text.
 */
function moocSubmitter(langs: Langs, exerciseId: string): ExerciseSubmitter {
  return async (target, exercisePath) => {
    const submission = await langs.submitMoocExerciseAndWaitForResults(
      exerciseId,
      exercisePath,
      (fraction, message) => {
        TmcPanel.postMessage({ type: "submissionStatusUpdate", target, fraction, message })
      },
    )
    if (submission.err) {
      return submission
    }
    const status = submission.val
    const outcome: SubmissionOutcome = {
      passed:
        status.status === "grading" &&
        status.grading.grading_progress === "FullyGraded" &&
        status.grading.score_given !== null &&
        status.grading.score_given > 0,
      resultMessage: { type: "moocSubmissionResult", target, result: status },
    }
    return Ok(outcome)
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

/**
 * Submits an exercise to the backend it belongs to and shows the grading in a side panel.
 *
 * Records the exercise as passed locally when the backend graded it so, then refreshes the
 * course. A submit or paste already in flight for the same exercise makes this a
 * `BottleneckError`.
 */
export async function submitExercise(
  context: vscode.ExtensionContext,
  actionContext: ReadyActionContext,
  exercise: WorkspaceExercise,
): Promise<Result<void, Error>> {
  const { dialog } = actionContext
  const { exerciseDecorationProvider, langs, userData } = actionContext.startup
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

  // Key shared with the paste actions, which must not overlap a submit of the same exercise.
  // Held only until the result is posted: the panel offers Paste from that point on, so
  // covering the course-update tail below would reject a legitimate click.
  const exercisePath = exercise.uri.fsPath
  const submitted = await runSingleFlight(
    {
      key: `submit:${exercisePath}`,
      maxHoldMs: SUBMIT_PROCESS_TIMEOUT + 30_000,
      busyMessage: "A submission for this exercise is already in progress.",
      onBusy: (message) => dialog.notification(message),
    },
    async () => {
      const panel: ExerciseSubmissionPanel = {
        id: nextPanelId(),
        type: "ExerciseSubmission",
        course,
        exercise: courseExercise,
      }
      TmcPanel.renderSide(context.extensionUri, context, actionContext, panel)
      const target = panelTarget(panel)

      const outcome = await submit(target, exercisePath)
      if (outcome.err) {
        TmcPanel.postMessage({
          type: "submissionStatusError",
          target,
          error: toWebviewError(outcome.val),
        })
        return outcome
      }

      if (outcome.val.passed) {
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
        TmcPanel.renderSide(context.extensionUri, context, actionContext, panel)
      }
      TmcPanel.postMessage(outcome.val.resultMessage)

      return Ok.EMPTY
    },
  )
  if (submitted.err) {
    return submitted
  }

  // `setExerciseAsPassed` above only flips the local per-exercise flag; course point totals
  // come from the backend, so without this refresh the CourseDetails and MyCourses totals
  // stay stale until the user refreshes by hand.
  const courseId = LocalCourseData.getCourseId(course)
  await refreshEverything(actionContext, { silent: true, courseId })

  return Ok.EMPTY
}

/** Sends the exercise directory `exercisePath` to one backend's paste service. */
type ExercisePaster = (exercisePath: string) => Promise<Result<string, Error>>

/**
 * Builds the paste call for `backend`, or `undefined` when that backend has no exercise
 * by this name.
 */
function pasterFor(
  langs: Langs,
  userData: UserData,
  backend: BackendKind,
  courseSlug: string,
  exerciseName: string,
): ExercisePaster | undefined {
  if (backend === "tmc") {
    const exerciseId = userData.getTmcExerciseByName(courseSlug, exerciseName)?.id
    return exerciseId
      ? (exercisePath): Promise<Result<string, Error>> =>
          langs.submitTmcExerciseToPaste(exerciseId, exercisePath)
      : undefined
  }
  const exerciseId = userData.getMoocExerciseByName(courseSlug, exerciseName)?.id
  return exerciseId
    ? (exercisePath): Promise<Result<string, Error>> =>
        langs.submitMoocExerciseToPaste(exerciseId, exercisePath)
    : undefined
}

/**
 * Sends an exercise to a backend's paste service and answers with the link to it.
 *
 * Nothing is reported here: the caller shows the failure, once, in the place the user
 * asked from. A paste that comes back without a link is an error rather than an empty
 * `Ok`, so no caller has to check for one.
 */
export async function pasteExercise(
  actionContext: ReadyActionContext,
  backend: BackendKind,
  courseSlug: string,
  exerciseName: string,
): Promise<Result<string, Error>> {
  const { dialog } = actionContext
  const { langs, userData, workspaceManager } = actionContext.startup

  const paste = pasterFor(langs, userData, backend, courseSlug, exerciseName)
  const exercisePath = workspaceManager.getExerciseBySlug(backend, courseSlug, exerciseName)?.uri
    .fsPath
  if (!paste || !exercisePath) {
    return Err(new Error("Failed to resolve exercise id"))
  }

  // key shared with the submit actions, which must not overlap a paste of the same exercise
  return runSingleFlight(
    {
      key: `submit:${exercisePath}`,
      maxHoldMs: CLI_PROCESS_TIMEOUT + 30_000,
      busyMessage: "A submission for this exercise is already in progress.",
      onBusy: (message) => dialog.notification(message),
    },
    async () => {
      const pasteResult = await paste(exercisePath)
      if (pasteResult.err) {
        return pasteResult
      }
      if (pasteResult.val === "") {
        return new Err(new Error("The server did not answer with a paste link."))
      }
      return pasteResult
    },
  )
}

export interface CourseUpdateOptions {
  /** Refresh only this course instead of every added one. */
  courseId?: CourseIdentifier | undefined
  /** Called as each course finishes, for a progress indicator. */
  onProgress?: ((done: number, total: number) => void) | undefined
}

/**
 * Re-fetches each added course's data, then offers to download whatever new
 * exercises turned up.
 *
 * One course failing does not stop the rest; the returned `Err` names every
 * course that could not be refreshed. Nothing is reported here — the caller
 * decides whether a background failure is worth a notification.
 */
export async function checkForCourseUpdates(
  actionContext: ReadyActionContext,
  options: CourseUpdateOptions = {},
): Promise<Result<void, Error>> {
  const { dialog } = actionContext
  const { userData } = actionContext.startup
  const { courseId, onProgress } = options
  let courses: LocalCourseData[]
  if (courseId) {
    const courseResult = userData.getCourse(courseId)
    if (courseResult.err) {
      return courseResult
    }
    courses = [courseResult.val]
  } else {
    courses = userData.getCourses()
  }

  Logger.info(`Checking for course updates for courses`)
  let done = 0
  onProgress?.(done, courses.length)
  // Courses hold disjoint records and `UserData` serializes its own writes, so
  // these run together rather than one course's CLI round trips after another's.
  const refreshed = await Promise.all(
    courses.map(async (course) => {
      const id = LocalCourseData.getCourseId(course)
      const updateResult = await updateCourse(actionContext, id)
      onProgress?.(++done, courses.length)
      const reread = userData.getCourse(id)
      return {
        name: LocalCourseData.getCourseName(course),
        error: updateResult.err ? updateResult.val : reread.err ? reread.val : undefined,
        updated: reread.ok ? reread.val : undefined,
      }
    }),
  )
  // Once for the whole pass, not once per course: a course update can drop exercises the
  // backend no longer has, and only a rescan stops those still showing as open.
  await refreshLocalExercises(actionContext)
  const updatedCourses = refreshed
    .map((x) => x.updated)
    .filter((x): x is LocalCourseData => x !== undefined)
  const failures = refreshed.filter((x) => x.error !== undefined)
  for (const failure of failures) {
    Logger.warn(`Failed to update course ${failure.name}`, failure.error)
  }

  const handleDownload = async (course: LocalCourseData): Promise<void> => {
    const id = LocalCourseData.getCourseId(course)
    const downloadResult = await downloadNewExercisesForCourse(actionContext, id)
    if (downloadResult.err) {
      dialog.reportError(
        "Failed to download new exercises for the course.",
        downloadResult.val,
        course.kind,
      )
    }
  }

  // `notifyAfter` throttles this toast only: gating the refresh above on it too
  // would freeze course metadata and point totals for the whole delay, including
  // the refresh each submit asks for.
  const now = Date.now()
  for (const course of updatedCourses) {
    const newExercises = LocalCourseData.getNewExercises(course)
    if (newExercises.length > 0 && !course.data.disabled && course.data.notifyAfter <= now) {
      const id = LocalCourseData.getCourseId(course)
      const courseName = LocalCourseData.getCourseName(course)
      dialog.notification(
        `Found ${newExercises.length} new exercises for ${courseName}. Do you wish to download them now?`,
        ["Download", async (): Promise<void> => handleDownload(course)],
        [
          "Remind me later",
          async (): Promise<void> => {
            const result = await userData.setNewExerciseNotifyAfter(
              id,
              Date.now() + NOTIFICATION_DELAY,
            )
            if (result.err) {
              dialog.reportError("Failed to postpone the reminder.", result.val, course.kind)
            }
          },
        ],
        [
          "Don't remind about these exercises",
          async (): Promise<void> => {
            const result = await userData.clearFromNewExercises(id)
            if (result.err) {
              dialog.reportError("Failed to dismiss the new exercises.", result.val, course.kind)
            }
          },
        ],
      )
    }
  }

  if (failures.length > 0) {
    const names = failures.map((x) => x.name).join(", ")
    const firstMessage = failures[0]?.error?.message ?? "unknown error"
    return Err(new Error(`Failed to fetch updates for ${names}: ${firstMessage}`))
  }
  return Ok.EMPTY
}

/**
 * The extension's one background refresh: course data first, then the exercise
 * update check.
 *
 * Activation, the maintenance poll, the tree view's refresh button and the tail
 * of each submit all want this, and two passes overlapping would interleave
 * writes to `UserData` and prompt twice about the same exercises. They share one
 * key, so a call made while another is running comes back as a
 * `BottleneckError` rather than queueing.
 *
 * @param courseId Refresh only that course's data; the exercise update check
 * always covers every course.
 * @param silent Downgrades both the "already refreshing" notice and a failed
 * course refresh from a notification to a log line, and runs the exercise
 * update check quietly.
 */
export async function refreshEverything(
  actionContext: ReadyActionContext,
  options: { silent: boolean } & CourseUpdateOptions,
): Promise<Result<void, Error>> {
  const { dialog } = actionContext
  const { silent, courseId, onProgress } = options
  return runSingleFlight(
    {
      key: "refresh:all",
      // A wedged refresh releases the key by the time the next poll wants it.
      maxHoldMs: EXERCISE_CHECK_INTERVAL,
      busyMessage: "A refresh is already in progress.",
      onBusy: silent ? (): void => {} : (message): void => void dialog.notification(message),
    },
    async () => {
      const refreshed = await checkForCourseUpdates(actionContext, { courseId, onProgress })
      if (refreshed.err) {
        if (silent) {
          Logger.warn("Failed to check for course updates.", refreshed.val)
        } else {
          dialog.reportError("Failed to check for course updates.", refreshed.val, courseId?.kind)
        }
      }
      // Through the command, so `actions` doesn't have to import `commands`.
      await vscode.commands.executeCommand("tmc.updateExercises", silent ? "silent" : "loud")
      return refreshed
    },
  )
}

/**
 * Opens `backend`'s course workspace in explorer. If a workspace is already open,
 * asks the user first.
 */
export async function openWorkspace(
  actionContext: ReadyActionContext,
  name: string,
  backend: BackendKind,
): Promise<void> {
  const { dialog } = actionContext
  const { resources, workspaceManager } = actionContext.startup

  const currentWorkspaceFile = vscode.workspace.workspaceFile
  const tmcWorkspaceFile = resources.getWorkspaceFilePath(name, backend)
  const workspaceAsUri = vscode.Uri.file(tmcWorkspaceFile)
  Logger.info(`Current workspace: ${currentWorkspaceFile?.fsPath}`)
  Logger.info(`${backendName(backend)} workspace: ${tmcWorkspaceFile}`)

  // `vscode.openFolder` reloads the window even for the workspace already open,
  // discarding unsaved editors, so only focus the explorer in that case.
  if (currentWorkspaceFile?.fsPath === workspaceAsUri.fsPath) {
    Logger.info("Workspace already open, changing focus to this workspace.")
    await vscode.commands.executeCommand("workbench.files.action.focusFilesExplorer")
    return
  }

  const openCourseWorkspace = async (): Promise<void> => {
    await workspaceManager.createWorkspaceFile(name, backend)
    await vscode.commands.executeCommand("vscode.openFolder", workspaceAsUri)
  }

  if (
    !currentWorkspaceFile ||
    (await dialog.confirmation(
      `Do you want to open the ${backendName(backend)} workspace and close the current one?`,
    ))
  ) {
    await openCourseWorkspace()
  } else {
    await dialog.warningNotification(
      "Please close the current workspace before opening a course workspace.",
      ["Close current & open Course Workspace", openCourseWorkspace],
    )
  }
}

/**
 * Removes a course from the user's courses, along with the extension's own state
 * for it: its closed-exercise setting and its `.code-workspace` file.
 *
 * The exercises already downloaded are deliberately left on disk.
 *
 * @param id ID of the course to remove
 */
export async function removeCourse(
  actionContext: ReadyActionContext,
  id: CourseIdentifier,
): Promise<void> {
  const { dialog, ui } = actionContext
  const { langs, userData, workspaceManager } = actionContext.startup

  const courseResult = userData.getCourse(id)
  if (courseResult.err) {
    dialog.reportError("Failed to remove the course.", courseResult.val, id.kind)
    return
  }
  const course = courseResult.val
  const courseName = LocalCourseData.getCourseName(course)
  Logger.info(`Closing exercises for ${courseName} and removing course data from userData`)

  const unsetResult = await langs.unsetSetting(closedExercisesSettingKey(course.kind, courseName))
  if (unsetResult.err) {
    dialog.reportError(
      `Failed to remove TMC-langs data for "${courseName}".`,
      unsetResult.val,
      course.kind,
    )
  }

  // Left behind, it would be reused verbatim if the course is added again, listing
  // folders for exercises the student may have deleted in the meantime.
  const workspaceFileResult = await workspaceManager.deleteWorkspaceFile(courseName, course.kind)
  if (workspaceFileResult.err) {
    dialog.reportError(
      `Failed to remove the workspace file for "${courseName}".`,
      workspaceFileResult.val,
      course.kind,
    )
  }

  const deleteResult = await userData.deleteCourse(id)
  if (deleteResult.err) {
    dialog.reportError(
      `Failed to remove "${courseName}" from your courses.`,
      deleteResult.val,
      course.kind,
    )
    return
  }
  ui.treeDP.refresh()

  if (
    workspaceManager.activeCourse === courseName &&
    workspaceManager.activeCourseBackend === course.kind
  ) {
    Logger.info("Closing course workspace because it was removed.")
    await vscode.commands.executeCommand("workbench.action.closeFolder")
  }
}
