import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import type * as vscode from "vscode"

import type { WorkspaceExercise } from "../api/workspaceManager"
import { CLI_PROCESS_TIMEOUT } from "../config/constants"
import { nextPanelId, TmcPanel } from "../panels/TmcPanel"
import type { ExerciseTestsPanel, TestResultData } from "../shared/shared"
import { LocalCourseData, LocalCourseExercise, panelTarget, toWebviewError } from "../shared/shared"
import { Logger, runSingleFlight } from "../utilities"
import { getActiveEditorExecutablePath } from "../window"
import type { ReadyActionContext } from "./types"

export const testInterrupts = new Map<number, (() => void)[]>()

/** Stops the test run `testRunId`. Does nothing if it already finished. */
export function cancelTestRun(testRunId: number): void {
  const interrupts = testInterrupts.get(testRunId)
  if (interrupts) {
    for (const interrupt of interrupts) {
      interrupt()
    }
    testInterrupts.delete(testRunId)
  }
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
