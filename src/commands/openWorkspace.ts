import { Ok } from "ts-results"
import * as vscode from "vscode"

import type { ReadyActionContext } from "../actions/types"
import { withOperation } from "../api/withOperation"
import type { BackendKind } from "../shared/shared"
import { backendName } from "../shared/shared"
import { Logger } from "../utilities"

/**
 * Opens `backend`'s course workspace in explorer. If a workspace is already open,
 * asks the user first.
 */
export async function openWorkspace(
  actionContext: ReadyActionContext,
  name: string,
  backend: BackendKind,
): Promise<void> {
  const { dialog } = actionContext
  const { resources, workspaceManager } = actionContext.startup

  const currentWorkspaceFile = vscode.workspace.workspaceFile
  const workspaceFile = resources.getWorkspaceFilePath(name, backend)
  const workspaceAsUri = vscode.Uri.file(workspaceFile)
  Logger.info(`Current workspace: ${currentWorkspaceFile?.fsPath}`)
  Logger.info(`${backendName(backend)} workspace: ${workspaceFile}`)

  // `vscode.openFolder` reloads the window even for the workspace already open,
  // discarding unsaved editors, so only focus the explorer in that case.
  if (currentWorkspaceFile?.fsPath === workspaceAsUri.fsPath) {
    Logger.info("Workspace already open, changing focus to this workspace.")
    await vscode.commands.executeCommand("workbench.files.action.focusFilesExplorer")
    return
  }

  const openCourseWorkspace = async (): Promise<void> => {
    await withOperation(
      dialog,
      { failure: "Failed to open the course workspace.", backend },
      async () => {
        await workspaceManager.createWorkspaceFile(name, backend)
        await vscode.commands.executeCommand("vscode.openFolder", workspaceAsUri)
        return Ok.EMPTY
      },
    )
  }

  if (
    !currentWorkspaceFile ||
    (await dialog.confirmation(
      `Do you want to open the ${backendName(backend)} workspace and close the current one?`,
    ))
  ) {
    await openCourseWorkspace()
  } else {
    void dialog.warningNotification(
      "Please close the current workspace before opening a course workspace.",
      ["Close current & open Course Workspace", openCourseWorkspace],
    )
  }
}
