import * as fs from "fs-extra"
import * as _ from "lodash"
import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

/**
 * -------------------------------------------------------------------------------------------------
 * Group of actions that respond to the user.
 * -------------------------------------------------------------------------------------------------
 */
import type {
  WorkspaceExercise,
  WorkspaceExercise as WorkspaceTmcExercise,
} from "../api/workspaceManager"
import {
  CLI_PROCESS_TIMEOUT,
  closedExercisesSettingKey,
  EXERCISE_CHECK_INTERVAL,
  NOTIFICATION_DELAY,
  SUBMIT_PROCESS_TIMEOUT,
} from "../config/constants"
import { InitializationError } from "../errors"
import { randomPanelId, TmcPanel } from "../panels/TmcPanel"
import type { ExerciseSubmissionPanel, ExerciseTestsPanel, TestResultData } from "../shared/shared"
import {
  CourseIdentifier,
  LocalCourseData,
  LocalCourseExercise,
  toWebviewError,
} from "../shared/shared"
import { Logger, parseFeedbackQuestion, runSingleFlight } from "../utilities/"
import { getActiveEditorExecutablePath } from "../window"
import { downloadNewExercisesForCourse } from "./downloadNewExercisesForCourse"
import type { ActionContext } from "./types"
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
export async function logout(actionContext: ActionContext): Promise<Result<void, Error>> {
  const { langs, dialog } = actionContext
  if (langs.err) {
    return new Err(new InitializationError("Extension was not initialized properly"))
  }

  const result = await safeDeauthenticate(() => langs.val.deauthenticate())
  if (result.err) {
    dialog.errorNotification(`Failed to log out: ${result.val.message}`, result.val)
  }
  const moocResult = await safeDeauthenticate(() => langs.val.deauthenticateMooc())
  if (moocResult.err) {
    dialog.errorNotification(
      `Failed to log out of courses.mooc.fi: ${moocResult.val.message}`,
      moocResult.val,
    )
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
  actionContext: ActionContext,
  exercise: WorkspaceTmcExercise,
): Promise<Result<void, Error>> {
  const { dialog, langs, userData } = actionContext
  if (!(langs.ok && userData.ok)) {
    return new Err(new InitializationError("Extension was not initialized properly"))
  }

  const courseResult = userData.val.getCourseBySlug(exercise.backend, exercise.courseSlug)
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
      const testRunId = randomPanelId()
      // render panel
      const panel: ExerciseTestsPanel = {
        id: randomPanelId(),
        type: "ExerciseTests",
        course: course,
        exercise: courseExercise,
        exerciseUri: exercise.uri,
        testRunId,
      }
      await TmcPanel.renderSide(context.extensionUri, context, actionContext, panel)

      if (!course.data.perhapsExamMode) {
        const executablePath = getActiveEditorExecutablePath(actionContext)
        const { process: testRunner, interrupt: testInterrupt } = langs.val.runTests(
          exercise.uri.fsPath,
          executablePath,
        )
        const { process: validationRunner, interrupt: validationInterrupt } =
          langs.val.runCheckstyle(exercise.uri.fsPath)
        testInterrupts.set(testRunId, [testInterrupt, validationInterrupt])
        const exerciseName = exercise.exerciseSlug

        try {
          Logger.info(`Running local tests and validations for ${exerciseName}`)
          const testResults = await testRunner
          Logger.info(`Tests finished for ${exerciseName}`)

          if (testResults.err) {
            TmcPanel.postMessage({
              type: "testError",
              target: panel,
              error: testResults.val,
            })
            return Ok.EMPTY
          }

          const validationResults = await validationRunner
          Logger.info(`Validations finished for ${exerciseName}`)

          if (validationResults.err) {
            TmcPanel.postMessage({
              type: "testError",
              target: panel,
              error: validationResults.val,
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
            await TmcPanel.renderSide(context.extensionUri, context, actionContext, panel)
          }
          TmcPanel.postMessage({
            type: "testResults",
            target: panel,
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
          target: panel,
        })
      }

      return Ok.EMPTY
    },
  )
}

/**
 * Submits an exercise while keeping the user informed
 * @param tempView Existing TemporaryWebview to use if any
 */
export async function submitTmcExercise(
  context: vscode.ExtensionContext,
  actionContext: ActionContext,
  exercise: WorkspaceExercise,
): Promise<Result<void, Error>> {
  const { dialog, exerciseDecorationProvider, langs, userData } = actionContext
  if (!(langs.ok && userData.ok && exerciseDecorationProvider.ok)) {
    return new Err(new InitializationError("Extension was not initialized properly"))
  }
  Logger.info(`Submitting exercise ${exercise.exerciseSlug} to server`)

  const courseResult = userData.val.getCourseBySlug("tmc", exercise.courseSlug)
  if (courseResult.err) {
    return courseResult
  }
  const course = courseResult.val
  const courseExercise = LocalCourseData.getExercises(course).find(
    (x) => LocalCourseExercise.getSlug(x) === exercise.exerciseSlug,
  )
  if (!courseExercise) {
    return Err(
      new Error(`ID for exercise ${exercise.exerciseSlug}/${exercise.exerciseSlug} was not found.`),
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
        id: randomPanelId(),
        type: "ExerciseSubmission",
        course,
        exercise: courseExercise,
      }
      await TmcPanel.renderSide(context.extensionUri, context, actionContext, panel)

      const submissionResult = await langs.val.submitTmcExerciseAndWaitForResults(
        LocalCourseExercise.getId(courseExercise),
        exercise.uri.fsPath,
        (progressPercent, message) => {
          TmcPanel.postMessage({
            type: "submissionStatusUpdate",
            target: panel,
            progressPercent,
            message,
          })
        },
        (url) => {
          TmcPanel.postMessage({
            type: "submissionStatusUrl",
            target: panel,
            url,
          })
        },
      )

      if (submissionResult.err) {
        TmcPanel.postMessage({
          type: "submissionStatusError",
          target: panel,
          error: toWebviewError(submissionResult.val),
        })
        return submissionResult
      }

      const statusData = submissionResult.val
      if (statusData.status === "ok" && statusData.all_tests_passed) {
        const passedResult = await userData.val.setExerciseAsPassed(
          "tmc",
          exercise.courseSlug,
          exercise.exerciseSlug,
        )
        if (passedResult.err) {
          dialog.errorNotification("Failed to record the exercise as passed.", passedResult.val)
        } else {
          exerciseDecorationProvider.val.updateDecorationsForExercises(exercise)
        }
      }
      const questions = statusData.feedback_questions
        ? parseFeedbackQuestion(statusData.feedback_questions)
        : []
      if (TmcPanel.sidePanel === undefined) {
        await TmcPanel.renderSide(context.extensionUri, context, actionContext, panel)
      }
      TmcPanel.postMessage({
        type: "submissionResult",
        target: panel,
        result: statusData,
        questions,
      })

      return Ok.EMPTY
    },
  )
  if (submitted.err) {
    return submitted
  }

  const courseId = LocalCourseData.getCourseId(course)
  await refreshEverything(actionContext, { silent: true, courseId })

  return Ok.EMPTY
}

/**
 * Submits a mooc exercise and shows the reduced grading result, the mooc twin
 * of {@link submitTmcExercise}. Mooc grading has no per-test breakdown or
 * feedback questions, so the panel shows only the overall grading progress,
 * score, and feedback text (posted via `moocSubmissionResult`).
 */
export async function submitMoocExercise(
  context: vscode.ExtensionContext,
  actionContext: ActionContext,
  exercise: WorkspaceExercise,
): Promise<Result<void, Error>> {
  const { dialog, exerciseDecorationProvider, langs, userData } = actionContext
  if (!(langs.ok && userData.ok && exerciseDecorationProvider.ok)) {
    return new Err(new InitializationError("Extension was not initialized properly"))
  }
  Logger.info(`Submitting mooc exercise ${exercise.exerciseSlug} to server`)

  const courseResult = userData.val.getCourseBySlug("mooc", exercise.courseSlug)
  if (courseResult.err) {
    return courseResult
  }
  const course = courseResult.val
  const courseExercise = LocalCourseData.getExercises(course).find(
    (x) => LocalCourseExercise.getSlug(x) === exercise.exerciseSlug,
  )
  if (!courseExercise) {
    return Err(new Error(`ID for exercise ${exercise.exerciseSlug} was not found.`))
  }
  const exerciseId = userData.val.getMoocExerciseByName(
    exercise.courseSlug,
    exercise.exerciseSlug,
  )?.id
  if (!exerciseId) {
    return Err(new Error(`ID for exercise ${exercise.exerciseSlug} was not found.`))
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
        id: randomPanelId(),
        type: "ExerciseSubmission",
        course,
        exercise: courseExercise,
      }
      await TmcPanel.renderSide(context.extensionUri, context, actionContext, panel)

      const submissionResult = await langs.val.submitMoocExerciseAndWaitForResults(
        exerciseId,
        exercise.uri.fsPath,
        (progressPercent, message) => {
          TmcPanel.postMessage({
            type: "submissionStatusUpdate",
            target: panel,
            progressPercent,
            message,
          })
        },
      )

      if (submissionResult.err) {
        TmcPanel.postMessage({
          type: "submissionStatusError",
          target: panel,
          error: toWebviewError(submissionResult.val),
        })
        return submissionResult
      }

      const status = submissionResult.val
      if (
        status.status === "grading" &&
        status.grading.grading_progress === "FullyGraded" &&
        status.grading.score_given !== null &&
        status.grading.score_given > 0
      ) {
        const passedResult = await userData.val.setExerciseAsPassed(
          "mooc",
          exercise.courseSlug,
          exercise.exerciseSlug,
        )
        if (passedResult.err) {
          dialog.errorNotification("Failed to record the exercise as passed.", passedResult.val)
        } else {
          exerciseDecorationProvider.val.updateDecorationsForExercises(exercise)
        }
      }

      if (TmcPanel.sidePanel === undefined) {
        await TmcPanel.renderSide(context.extensionUri, context, actionContext, panel)
      }
      TmcPanel.postMessage({
        type: "moocSubmissionResult",
        target: panel,
        result: status,
      })

      return Ok.EMPTY
    },
  )
  if (submitted.err) {
    return submitted
  }

  // Mirror the tail of `submitTmcExercise`. `setExerciseAsPassed` above only
  // flips the local per-exercise flag; course point totals come from
  // `getMoocCourseProgress` via `updateCourse`, so without this refresh the
  // CourseDetails/MyCourses totals stay stale until the user refreshes by hand.
  const courseId = LocalCourseData.getCourseId(course)
  await refreshEverything(actionContext, { silent: true, courseId })

  return Ok.EMPTY
}

/**
 * Sends the exercise to the TMC Paste server.
 * @param id Exercise ID
 * @returns TMC Paste link if the action was successful.
 */
export async function pasteTmcExercise(
  actionContext: ActionContext,
  courseSlug: string,
  exerciseName: string,
): Promise<Result<string, Error>> {
  const { langs, userData, workspaceManager, dialog } = actionContext
  if (!(langs.ok && userData.ok && workspaceManager.ok)) {
    return new Err(new InitializationError("Extension was not initialized properly"))
  }

  const exerciseId = userData.val.getTmcExerciseByName(courseSlug, exerciseName)?.id
  const exercisePath = workspaceManager.val.getExerciseBySlug("tmc", courseSlug, exerciseName)?.uri
    .fsPath
  if (!exerciseId || !exercisePath) {
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
      const pasteResult = await langs.val.submitTmcExerciseToPaste(exerciseId, exercisePath)
      if (pasteResult.err) {
        dialog.errorNotification(
          `Failed to send exercise to TMC Paste: ${pasteResult.val.message}.`,
          pasteResult.val,
        )
        return pasteResult
      }

      const pasteLink = pasteResult.val
      if (pasteLink === "") {
        const message = "Didn't receive paste link from server."
        return new Err(new Error(`Failed to send exercise to TMC Paste: ${message}`))
      }

      return new Ok(pasteLink)
    },
  )
}

export async function pasteMoocExercise(
  actionContext: ActionContext,
  courseSlug: string,
  exerciseName: string,
): Promise<Result<string, Error>> {
  const { langs, userData, workspaceManager, dialog } = actionContext
  if (!(langs.ok && userData.ok && workspaceManager.ok)) {
    return new Err(new InitializationError("Extension was not initialized properly"))
  }

  const exerciseId = userData.val.getMoocExerciseByName(courseSlug, exerciseName)?.id
  const exercisePath = workspaceManager.val.getExerciseBySlug("mooc", courseSlug, exerciseName)?.uri
    .fsPath
  if (!exerciseId || !exercisePath) {
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
      const pasteResult = await langs.val.submitMoocExerciseToPaste(exerciseId, exercisePath)
      if (pasteResult.err) {
        dialog.errorNotification(
          `Failed to send exercise to the courses.mooc.fi paste service: ${pasteResult.val.message}`,
          pasteResult.val,
        )
        return pasteResult
      }

      const pasteLink = pasteResult.val
      if (pasteLink === "") {
        const message = "Didn't receive paste link from server."
        return new Err(
          new Error(`Failed to send exercise to the courses.mooc.fi paste service: ${message}`),
        )
      }

      return new Ok(pasteLink)
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
  actionContext: ActionContext,
  options: CourseUpdateOptions = {},
): Promise<Result<void, Error>> {
  const { dialog, userData } = actionContext
  const { courseId, onProgress } = options
  if (userData.err) {
    return Err(new InitializationError("Extension was not initialized properly"))
  }
  let courses: LocalCourseData[]
  if (courseId) {
    const courseResult = userData.val.getCourse(courseId)
    if (courseResult.err) {
      return courseResult
    }
    courses = [courseResult.val]
  } else {
    courses = userData.val.getCourses()
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
      const reread = userData.val.getCourse(id)
      return {
        name: LocalCourseData.getCourseName(course),
        error: updateResult.err ? updateResult.val : reread.err ? reread.val : undefined,
        updated: reread.ok ? reread.val : undefined,
      }
    }),
  )
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
      dialog.errorNotification(
        "Failed to download new exercises for the course.",
        downloadResult.val,
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
            const result = await userData.val.setNewExerciseNotifyAfter(
              id,
              Date.now() + NOTIFICATION_DELAY,
            )
            if (result.err) {
              dialog.errorNotification("Failed to postpone the reminder.", result.val)
            }
          },
        ],
        [
          "Don't remind about these exercises",
          async (): Promise<void> => {
            const result = await userData.val.clearFromNewExercises(id)
            if (result.err) {
              dialog.errorNotification("Failed to dismiss the new exercises.", result.val)
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
  actionContext: ActionContext,
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
          dialog.errorNotification("Failed to check for course updates.", refreshed.val)
        }
      }
      // Through the command, so `actions` doesn't have to import `commands`.
      await vscode.commands.executeCommand("tmc.updateExercises", silent ? "silent" : "loud")
      return refreshed
    },
  )
}

/**
 * Opens the TMC workspace in explorer. If a workspace is already opened, asks user first.
 */
export async function openWorkspace(
  actionContext: ActionContext,
  name: string,
  backend: "tmc" | "mooc",
): Promise<void> {
  const { dialog, resources, workspaceManager } = actionContext
  if (!(resources.ok && workspaceManager.ok)) {
    Logger.error("Extension was not initialized properly")
    return
  }

  const currentWorkspaceFile = vscode.workspace.workspaceFile
  const tmcWorkspaceFile = resources.val.getWorkspaceFilePath(name, backend)
  const workspaceAsUri = vscode.Uri.file(tmcWorkspaceFile)
  Logger.info(`Current workspace: ${currentWorkspaceFile?.fsPath}`)
  Logger.info(`TMC workspace: ${tmcWorkspaceFile}`)

  // `vscode.openFolder` reloads the window even for the workspace already open,
  // discarding unsaved editors, so only focus the explorer in that case.
  if (currentWorkspaceFile?.fsPath === workspaceAsUri.fsPath) {
    Logger.info("Workspace already open, changing focus to this workspace.")
    await vscode.commands.executeCommand("workbench.files.action.focusFilesExplorer")
    return
  }

  const openCourseWorkspace = async (): Promise<void> => {
    if (!fs.existsSync(tmcWorkspaceFile)) {
      workspaceManager.val.createWorkspaceFile(name, backend)
    }
    await vscode.commands.executeCommand("vscode.openFolder", workspaceAsUri)
  }

  if (
    !currentWorkspaceFile ||
    (await dialog.confirmation("Do you want to open TMC workspace and close the current one?"))
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
 * Removes given course from UserData and removes its associated files. However, doesn't remove any
 * exercises that are on disk.
 *
 * @param id ID of the course to remove
 */
export async function removeCourse(
  actionContext: ActionContext,
  id: CourseIdentifier,
): Promise<void> {
  const { langs, ui, userData, workspaceManager, dialog } = actionContext
  if (!(langs.ok && userData.ok && workspaceManager.ok)) {
    Logger.error("Extension was not initialized properly")
    return
  }

  const courseResult = userData.val.getCourse(id)
  if (courseResult.err) {
    dialog.errorNotification("Failed to remove the course.", courseResult.val)
    return
  }
  const course = courseResult.val
  const courseName = LocalCourseData.getCourseName(course)
  Logger.info(`Closing exercises for ${courseName} and removing course data from userData`)

  const unsetResult = await langs.val.unsetSetting(
    closedExercisesSettingKey(course.kind, courseName),
  )
  if (unsetResult.err) {
    dialog.errorNotification(
      `Failed to remove TMC-langs data for "${courseName}".`,
      unsetResult.val,
    )
  }

  const deleteResult = await userData.val.deleteCourse(id)
  if (deleteResult.err) {
    dialog.errorNotification(
      `Failed to remove "${courseName}" from your courses.`,
      deleteResult.val,
    )
    return
  }
  ui.treeDP.removeChildWithId("myCourses", CourseIdentifier.toString(id))

  if (
    workspaceManager.val.activeCourse === courseName &&
    workspaceManager.val.activeCourseBackend === course.kind
  ) {
    Logger.info("Closing course workspace because it was removed.")
    await vscode.commands.executeCommand("workbench.action.closeFolder")
  }
}
