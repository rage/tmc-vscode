import * as vscode from "vscode"

import { findExerciseSourceFile } from "../actions"
import type { ReadyActionContext } from "../actions/types"
import type { WorkspaceExercise } from "../api/workspaceManager"
import { SIDE_PANEL_VIEW_TYPE } from "../panels/TmcPanel"
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
    const viewColumn = codeColumn()
    await vscode.window.showTextDocument(vscode.Uri.file(file), {
      preview: false,
      ...(viewColumn !== undefined && { viewColumn }),
    })
    return true
  } catch (e) {
    Logger.warn(`Could not show the source file of ${exercise.exerciseSlug}`, e)
    return false
  }
}

/**
 * The active editor group, unless it holds the submission result: the result opens in a split
 * beside the code, and a file shown there would squeeze it and split the window further.
 */
function codeColumn(): vscode.ViewColumn | undefined {
  const { activeTabGroup, all } = vscode.window.tabGroups
  if (!activeTabGroup || !holdsSubmissionResult(activeTabGroup)) {
    return undefined
  }
  return all.find((group) => !holdsSubmissionResult(group))?.viewColumn
}

function holdsSubmissionResult(group: vscode.TabGroup): boolean {
  // A webview tab's view type carries a prefix of VS Code's own.
  return group.tabs.some((tab) =>
    (tab.input as { viewType?: string } | undefined)?.viewType?.endsWith(SIDE_PANEL_VIEW_TYPE),
  )
}
