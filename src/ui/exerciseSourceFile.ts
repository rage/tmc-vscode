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
    const uri = vscode.Uri.file(file)
    await vscode.window.showTextDocument(uri, { preview: false, viewColumn: columnOf(uri) })
    return true
  } catch (e) {
    Logger.warn(`Could not show the source file of ${exercise.exerciseSlug}`, e)
    return false
  }
}

/** The editor group already showing `uri`, else the first one, which holds the exercise files. */
function columnOf(uri: vscode.Uri): vscode.ViewColumn {
  const showing = vscode.window.tabGroups.all.find((group) =>
    group.tabs.some(
      (tab) => (tab.input as { uri?: vscode.Uri } | undefined)?.uri?.toString() === uri.toString(),
    ),
  )
  return showing?.viewColumn ?? vscode.ViewColumn.One
}
