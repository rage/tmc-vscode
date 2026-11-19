import { Err } from "ts-results"
import type * as vscode from "vscode"

import type { ReadyActionContext } from "../actions/types"
import type { ExerciseTestController } from "../testing/exerciseTestController"
import { runForExercise } from "./runForExercise"

/**
 * Runs an exercise's tests through the test controller, so the results land in Test Results.
 *
 * @param controller `undefined` when activation set up no local testing.
 */
export async function testExercise(
  actionContext: ReadyActionContext,
  controller: ExerciseTestController | undefined,
  resource: vscode.Uri | undefined,
): Promise<void> {
  await runForExercise(actionContext, resource, "Testing the exercise", async (exercise) => {
    return controller
      ? controller.runExercise(exercise)
      : Err(new Error("Local testing is not available."))
  })
}
