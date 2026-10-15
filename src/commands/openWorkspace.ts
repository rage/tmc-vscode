import { Ok } from "ts-results"
import * as vscode from "vscode"

import { LocalCourseData } from "../../shared/lib"
import type { ReadyActionContext } from "../actions/types"
import { withOperation } from "../api/withOperation"
import { Logger } from "../utilities"
import { withholdCourseWorkspaceOffer } from "./offerCourseWorkspace"

/**
 * Opens a course's workspace in this window.
 *
 * Asks first only when that closes something of the student's own, a folder or a workspace
 * that is not a course workspace, and then offers a new window instead. Another course's
 * workspace has nothing to lose: course workspaces save on focus change.
 */
export async function openWorkspace(
  actionContext: ReadyActionContext,
  course: LocalCourseData,
): Promise<void> {
  const { dialog } = actionContext
  const { courseWorkspaceSwitches, resources, workspaceManager } = actionContext.startup

  const courseSlug = LocalCourseData.getCourseName(course)
  withholdCourseWorkspaceOffer({ backend: course.kind, courseSlug })
  const currentWorkspaceFile = vscode.workspace.workspaceFile
  const workspaceFile = resources.getWorkspaceFilePath(courseSlug, course.kind)
  const workspaceAsUri = vscode.Uri.file(workspaceFile)
  Logger.info(`Current workspace: ${currentWorkspaceFile?.fsPath}`)
  Logger.info(`Course workspace: ${workspaceFile}`)

  // `vscode.openFolder` reloads the window even for the workspace already open,
  // discarding unsaved editors, so only focus the explorer in that case.
  if (currentWorkspaceFile?.fsPath === workspaceAsUri.fsPath) {
    Logger.info("Workspace already open, changing focus to this workspace.")
    await vscode.commands.executeCommand("workbench.files.action.focusFilesExplorer")
    return
  }

  const isEmptyWindow =
    !currentWorkspaceFile && (vscode.workspace.workspaceFolders ?? []).length === 0
  const where =
    isEmptyWindow || workspaceManager.activeCourse !== undefined
      ? "here"
      : await dialog.choose(
          `Open the ${LocalCourseData.getCourseTitle(course)} course workspace?`,
          { detail: `${vscode.workspace.name ?? "The open folder"} will close in this window.` },
          ["Open Here", "here" as const],
          ["Open in New Window", "newWindow" as const],
        )
  if (where === undefined) {
    return
  }

  await withOperation(dialog, { failure: "Failed to open the course workspace." }, async () => {
    await workspaceManager.createWorkspaceFile(courseSlug, course.kind)
    await courseWorkspaceSwitches.record(workspaceAsUri.fsPath)
    await vscode.commands.executeCommand("vscode.openFolder", workspaceAsUri, {
      forceNewWindow: where === "newWindow",
    })
    return Ok.EMPTY
  })
}
