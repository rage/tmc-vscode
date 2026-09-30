import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import type * as vscode from "vscode"

import type { WorkspaceExercise } from "../api/workspaceManager"
import { CLI_PROCESS_TIMEOUT } from "../config/constants"
import { findStoredExercise } from "../config/userdata"
import type { RunResult, StyleValidationResult } from "../shared/langsSchema"
import { LocalCourseExercise } from "../shared/shared"
import { exerciseOperations } from "../ui/exerciseOperations"
import { Logger } from "../utilities"
import { resolvePythonInterpreter } from "../window"
import type { ReadyActionContext } from "./types"

/** What running an exercise's tests locally produced. */
export type ExerciseTestOutcome =
  | { kind: "examMode" }
  | {
      kind: "ran"
      runResult: RunResult
      /** `Ok(null)` when the exercise's language has no code quality checks. */
      styleValidation: Result<StyleValidationResult | null, Error>
      isCourseDisabled: boolean
    }

/**
 * Runs an exercise's tests and code quality checks locally.
 *
 * Reports nothing to the user: the Testing API controller in `src/testing` does that.
 *
 * @param token Stops both CLI processes. A cancelled run resolves with whatever the CLI
 * made of being interrupted, so check the token before reporting the outcome.
 * @returns `Err(BottleneckError)` while another run of the same exercise is in flight,
 * `Err(AiUseRefusedError)` while AI assistance may be on, and `Err` when the tests could not
 * be run at all.
 */
export async function testExercise(
  actionContext: ReadyActionContext,
  exercise: WorkspaceExercise,
  token: vscode.CancellationToken,
): Promise<Result<ExerciseTestOutcome, Error>> {
  const { langs, userData } = actionContext.startup

  const stored = findStoredExercise(userData, exercise)
  if (stored.err) {
    return stored
  }
  const { course, exercise: courseExercise } = stored.val
  if (course.data.perhapsExamMode) {
    return Ok({ kind: "examMode" })
  }
  const refused = await actionContext.startup.aiUseGate.refusal(course, exercise.uri)
  if (refused) {
    return Err(refused)
  }

  // guards the run-tests + checkstyle pair as one unit against a second click
  const exercisePath = exercise.uri.fsPath
  return exerciseOperations.run(
    LocalCourseExercise.getId(courseExercise),
    "testing",
    2 * CLI_PROCESS_TIMEOUT + 30_000,
    async (): Promise<Result<ExerciseTestOutcome, Error>> => {
      const { process: testRunner, interrupt: testInterrupt } = langs.runTests(
        exercisePath,
        resolvePythonInterpreter(exercise.uri),
      )
      const { process: validationRunner, interrupt: validationInterrupt } =
        langs.runCheckstyle(exercisePath)
      const cancellation = token.onCancellationRequested(() => {
        testInterrupt()
        validationInterrupt()
      })
      const exerciseName = exercise.exerciseSlug

      try {
        Logger.info(`Running local tests and validations for ${exerciseName}`)
        const testResults = await testRunner
        Logger.info(`Tests finished for ${exerciseName}`)
        if (testResults.err) {
          validationInterrupt()
          return testResults
        }

        const styleValidation = await validationRunner
        Logger.info(`Validations finished for ${exerciseName}`)
        if (styleValidation.err) {
          Logger.error(`Code quality checks failed to run for ${exerciseName}`, styleValidation.val)
        }
        return Ok({
          kind: "ran",
          runResult: testResults.val,
          styleValidation,
          isCourseDisabled: course.data.disabled,
        })
      } finally {
        cancellation.dispose()
      }
    },
  )
}
