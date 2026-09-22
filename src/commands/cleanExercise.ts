import type * as vscode from "vscode"

import type { ReadyActionContext } from "../actions/types"
import { failure, runForExercise } from "./runForExercise"

/**
 * Removes language specific meta files from exercise directory.
 */
export async function cleanExercise(
  actionContext: ReadyActionContext,
  resource: vscode.Uri | undefined,
): Promise<void> {
  const { langs } = actionContext.startup
  await runForExercise(actionContext, resource, "Cleaning the exercise", async (exercise) => {
    const result = await langs.clean(exercise.uri.fsPath)
    return result.err ? failure("Failed to clean exercise.", result.val) : result
  })
}
