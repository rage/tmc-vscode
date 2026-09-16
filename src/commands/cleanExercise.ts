import type * as vscode from "vscode"

import type { ActionContext } from "../actions/types"
import { Logger } from "../utilities"
import { failure, runForExercise } from "./runForExercise"

/**
 * Removes language specific meta files from exercise directory.
 */
export async function cleanExercise(
  actionContext: ActionContext,
  resource: vscode.Uri | undefined,
): Promise<void> {
  const { langs } = actionContext
  if (langs.err) {
    Logger.error("Extension was not initialized properly")
    return
  }

  await runForExercise(actionContext, resource, "Cleaning the exercise", async (exercise) => {
    const result = await langs.val.clean(exercise.uri.fsPath)
    return result.err ? failure("Failed to clean exercise.", result.val) : result
  })
}
