import * as vscode from "vscode"

import { findExerciseSourceFile } from "../actions"
import type { ReadyActionContext } from "../actions/types"
import type { WorkspaceExercise } from "../api/workspaceManager"
import { Logger } from "../utilities"

/**
 * Opens the exercise's main source file in an editor. Never rejects: the exercise is already
 * open by the time this runs, so a file that cannot be shown is only logged.
 *
 * @returns Whether a file was opened; `false` when the exercise holds no source file.
 */
export async function showExerciseSourceFile(
  actionContext: ReadyActionContext,
  exercise: Pick<WorkspaceExercise, "uri" | "exerciseSlug">,
): Promise<boolean> {
  try {
    const file = await findExerciseSourceFile(actionContext, exercise)
    if (!file) {
      Logger.info(`${exercise.exerciseSlug} has no source file to open`)
      return false
    }
    await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: false })
    return true
  } catch (e) {
    Logger.warn(`Could not show the source file of ${exercise.exerciseSlug}`, e)
    return false
  }
}
