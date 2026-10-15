import * as vscode from "vscode"

import { moveExtensionDataPath } from "../actions"
import type { ReadyActionContext } from "../actions/types"
import { withOperation } from "../api/withOperation"
import { Logger } from "../utilities"

/**
 * Asks for a new folder for the extension's data and moves the exercises there.
 */
export async function changeTmcDataPath(actionContext: ReadyActionContext): Promise<void> {
  const { dialog } = actionContext
  const { resources, workspaceManager } = actionContext.startup
  Logger.info("Moving the exercises folder")
  const openCourse = workspaceManager.activeCourse
  const openCourseBackend = workspaceManager.activeCourseBackend
  const old = resources.projectsDirectory
  const options: vscode.OpenDialogOptions = {
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Move Here",
    defaultUri: vscode.Uri.file(old),
  }

  const newPath = (await vscode.window.showOpenDialog(options))?.[0]
  if (!newPath) {
    return
  }

  const res = await withOperation(
    dialog,
    {
      failure: "Failed to move the exercises folder.",
      progress: "Moving the exercises folder…",
    },
    (report) => moveExtensionDataPath(actionContext, newPath, report),
  )
  if (res.err) {
    return
  }
  const { projectsDirectory, rescanError } = res.val
  Logger.info(`Moved workspace folder from ${old} to ${projectsDirectory}`)
  dialog.notification(
    projectsDirectory === newPath.fsPath
      ? `Moved the exercises folder to ${projectsDirectory}.`
      : `Moved the exercises folder to ${projectsDirectory}. The folder you chose was not empty,` +
          " so a tmcdata subfolder was used.",
  )
  if (rescanError) {
    dialog.warningNotification("The exercises could not be listed in their new folder.", [
      "Refresh Courses",
      (): void => void vscode.commands.executeCommand("tmcTreeView.refreshCourses"),
    ])
  }
  // The open course workspace's file moved with the exercises.
  if (openCourse !== undefined && openCourseBackend !== undefined) {
    await vscode.commands.executeCommand(
      "vscode.openFolder",
      vscode.Uri.file(resources.getWorkspaceFilePath(openCourse, openCourseBackend)),
    )
  }
}
