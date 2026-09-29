import { Err } from "ts-results"
import type * as vscode from "vscode"

import type { ReadyActionContext } from "../actions/types"
import { activeTestController } from "../testing/localTesting"
import { runForExercise } from "./runForExercise"

/** Runs an exercise's tests through the test controller, so the results land in Test Results. */
export async function testExercise(
  _context: vscode.ExtensionContext,
  actionContext: ReadyActionContext,
  resource: vscode.Uri | undefined,
): Promise<void> {
  await runForExercise(actionContext, resource, "Testing the exercise", async (exercise) => {
    const controller = activeTestController()
    return controller
      ? controller.runExercise(exercise)
      : Err(new Error("Local testing is not available."))
  })
}
