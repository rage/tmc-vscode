import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import type * as vscode from "vscode"

import type { RunResult, StyleValidationResult } from "../../shared/langsSchema"
import { LocalCourseData } from "../../shared/lib"
import type { WorkspaceExercise } from "../api/workspaceManager"
import { exerciseOperations } from "../ui/exerciseOperations"
import { Logger } from "../utilities"
import { resolvePythonInterpreter } from "../window"
import { saveExerciseDocuments } from "../window/exerciseDocuments"
import { checkWorkspaceTrust } from "./checkWorkspaceTrust"
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
 * @param options.isAiUseChecked The caller has just had `checkAiUse` pass, so it is not asked
 * again.
 * @returns `Err(BottleneckError)` while another operation on the exercise is in flight,
 * `Err(AiUseRefusedError)` while AI assistance may be on, `Err(WorkspaceUntrustedError)` in
 * Restricted Mode, and `Err` when the tests could not be run at all.
 */
export async function testExercise(
  actionContext: ReadyActionContext,
  exercise: WorkspaceExercise,
  token: vscode.CancellationToken,
  options: { isAiUseChecked?: boolean } = {},
): Promise<Result<ExerciseTestOutcome, Error>> {
  const { langs, userData } = actionContext.startup

  const stored = userData.getExercise(exercise.id)
  if (stored.err) {
    return stored
  }
  const { course } = stored.val
  if (LocalCourseData.isExamMode(course)) {
    return Ok({ kind: "examMode" })
  }
  const trusted = checkWorkspaceTrust(actionContext)
  if (trusted.err) {
    return trusted
  }
  const refused =
    !options.isAiUseChecked && (await actionContext.startup.aiUseGate.refusal(course, exercise.uri))
  if (refused) {
    return Err(refused)
  }

  // guards the run-tests + checkstyle pair as one unit against a second click
  const exercisePath = exercise.uri.fsPath
  return exerciseOperations.run(
    exercise.id,
    "testing",
    async (): Promise<Result<ExerciseTestOutcome, Error>> => {
      const saved = await saveExerciseDocuments(exercise)
      if (saved.err) {
        return saved
      }
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
          isCourseDisabled: LocalCourseData.isDisabled(course),
        })
      } finally {
        cancellation.dispose()
      }
    },
  )
}
