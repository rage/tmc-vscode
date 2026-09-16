import type * as vscode from "vscode"

import type { ActionContext } from "../actions/types"
import { Logger } from "../utilities"
import { runForExercise } from "./runForExercise"

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

  await runForExercise(actionContext, resource, "Cleaning the exercise", (exercise) =>
    langs.val.clean(exercise.uri.fsPath),
  )
}
