import * as vscode from "vscode"

import { wipeExtensionData } from "../actions"
import type { ReadyActionContext } from "../actions/types"
import { withOperation } from "../api/withOperation"
import { Logger } from "../utilities"

export async function wipe(
  actionContext: ReadyActionContext,
  context: vscode.ExtensionContext,
): Promise<void> {
  const { authState, dialog } = actionContext
  const { resources, workspaceManager } = actionContext.startup
  Logger.info("Wiping")
  const projectsDirectory = resources.projectsDirectory
  if (!projectsDirectory) {
    void dialog.errorNotification(
      "Wiping the extension data is unavailable: the TestMyCode tools did not report where the exercises folder is.",
      new Error("tmc-langs did not report an exercise directory"),
    )
    return
  }

  if (workspaceManager.activeCourse) {
    dialog.warningNotification(
      "Extension data can't be wiped now because a course workspace is open. \
Please close the workspace and any related files before running this command again.",
      [
        "Close Workspace",
        (): void => {
          vscode.commands.executeCommand("workbench.action.closeFolder")
        },
      ],
    )
    return
  }

  const typed = await dialog.explicitConfirmation(
    "Type DELETE to delete your downloaded exercises, log out and clear every course and" +
      " setting TestMyCode has stored. This cannot be undone.",
    "DELETE",
  )
  if (!typed) {
    return
  }

  // Change to Explorer view to avoid instant restart
  await vscode.commands.executeCommand("workbench.files.action.focusFilesExplorer")

  const wipeResult = await withOperation(
    dialog,
    { failure: "Failed to wipe extension data.", progress: "Removing extension data…" },
    (report) => wipeExtensionData(actionContext, projectsDirectory, report),
  )
  if (wipeResult.err) {
    return
  }

  await authState.set(false)
  await vscode.commands.executeCommand("setContext", "test-my-code:WorkspaceActive", undefined)

  for (const sub of context.subscriptions) {
    try {
      sub.dispose()
    } catch (e) {
      Logger.error(e)
    }
  }

  Logger.info("Extension wipe completed.")
  await vscode.commands.executeCommand("workbench.action.reloadWindow")
}
