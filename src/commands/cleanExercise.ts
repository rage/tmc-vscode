import type * as vscode from "vscode"

import { cleanExercise as cleanExerciseAction } from "../actions/cleanExercise"
import type { ReadyActionContext } from "../actions/types"
import { failure, runForExercise } from "./runForExercise"

/**
 * Removes language specific meta files from exercise directory.
 */
export async function cleanExercise(
  actionContext: ReadyActionContext,
  resource: vscode.Uri | undefined,
): Promise<void> {
  await runForExercise(actionContext, resource, "Cleaning the exercise", async (exercise) => {
    const result = await cleanExerciseAction(actionContext, exercise)
    return result.err ? failure("Failed to clean exercise.", result.val) : result
  })
}
