import * as vscode from "vscode"

import { MAIN_PANEL_VIEW_TYPE, SIDE_PANEL_VIEW_TYPE } from "../panels/TmcPanel"
import { Logger } from "../utilities"

/**
 * Moves an exercise file that opens beside a TestMyCode screen, as one clicked while the
 * results screen has the focus does, into the first editor group, which holds the exercise
 * files. A file already open there is focused instead of opened twice. Files opened in any other
 * group stay where the student put them.
 *
 * @param isExerciseFile Whether a file belongs to an exercise of the workspace.
 */
export function keepExerciseFilesInFirstGroup(
  isExerciseFile: (uri: vscode.Uri) => boolean,
): vscode.Disposable {
  return vscode.window.onDidChangeActiveTextEditor((editor) => {
    const column = editor?.viewColumn
    if (!editor || column === undefined || column === vscode.ViewColumn.One) {
      return
    }
    const group = vscode.window.tabGroups.all.find((shown) => shown.viewColumn === column)
    if (!group || !holdsScreen(group) || !isExerciseFile(editor.document.uri)) {
      return
    }
    // Moving keeps the selection a test failure's link set, and VS Code merges the moved editor
    // into one already open in the first group.
    void Promise.resolve(
      vscode.commands.executeCommand("workbench.action.moveEditorToFirstGroup"),
    ).catch((error) => Logger.warn("Could not move an exercise file to the first group", error))
  })
}

function holdsScreen(group: vscode.TabGroup): boolean {
  return group.tabs.some((tab) => {
    // VS Code prefixes the type a webview was created with, e.g. "mainThreadWebview-".
    const viewType = (tab.input as { viewType?: unknown } | undefined)?.viewType
    return (
      typeof viewType === "string" &&
      (viewType.endsWith(SIDE_PANEL_VIEW_TYPE) || viewType.endsWith(MAIN_PANEL_VIEW_TYPE))
    )
  })
}
