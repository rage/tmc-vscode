import * as fs from "fs-extra"
import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import type { ActionContext } from "../actions/types"
import { FileSystemError } from "../errors"
import { Logger } from "../utilities"

export async function wipe(
  actionContext: ActionContext,
  context: vscode.ExtensionContext,
): Promise<void> {
  const { authState, dialog, resources, langs, userData, workspaceManager } = actionContext
  Logger.info("Wiping")
  if (
    !(
      workspaceManager.ok &&
      resources.ok &&
      langs.ok &&
      userData.ok &&
      resources.val.projectsDirectory
    )
  ) {
    Logger.error("Extension was not initialized properly")
    return
  }

  // The guard above narrows a property, which does not survive into the progress
  // closure below; binding it here is what keeps the wipe target checked.
  const projectsDirectory = resources.val.projectsDirectory

  if (workspaceManager.val.activeCourse) {
    dialog.warningNotification(
      "Extension data can't be wiped now because a TMC Workspace is open. \
Please close the workspace and any related files before running this command again.",
      [
        "Close workspace",
        (): void => {
          vscode.commands.executeCommand("workbench.action.closeFolder")
        },
      ],
    )
    return
  }

  const confirmed = await dialog.explicitConfirmation(
    "Are you sure you want to wipe all data for the TMC Extension?",
  )
  if (!confirmed) {
    return
  }

  const reallyWipe = await dialog.explicitConfirmation(
    "This cannot be undone. Your downloaded exercises will be deleted, you will be logged out, \
and every setting and course this extension has stored will be cleared.",
  )
  if (!reallyWipe) {
    return
  }

  // Change to Explorer view to avoid instant restart
  await vscode.commands.executeCommand("workbench.files.action.focusFilesExplorer")

  const message = "Removing extension data..."
  // Deleting the exercises is the one step that cannot be recovered from, so it
  // goes last: a failure anywhere before it leaves the student's work on disk.
  const wipeResult = await dialog.progressNotification(message, async (progress) => {
    const settingsReset = await langs.val.resetSettings()
    if (settingsReset.err) {
      return settingsReset
    }
    progress.report({ message, fraction: 0.2 })

    // `deauthenticate` fires the logout events with `expected: true`, so the
    // session-expiry warning stays quiet and the auth context updates itself.
    const tmcLogout = await langs.val.deauthenticate()
    if (tmcLogout.err) {
      return tmcLogout
    }
    const moocLogout = await langs.val.deauthenticateMooc()
    if (moocLogout.err) {
      return moocLogout
    }
    progress.report({ message, fraction: 0.4 })

    await userData.val.wipeDataFromStorage()
    progress.report({ message, fraction: 0.6 })

    const workspaceFilesRemoved = await workspaceManager.val.deleteAllWorkspaceFiles()
    if (workspaceFilesRemoved.err) {
      return workspaceFilesRemoved
    }
    progress.report({ message, fraction: 0.8 })

    try {
      fs.removeSync(projectsDirectory)
    } catch (e) {
      return Err(new FileSystemError(e, "Failed to remove projects directory."))
    }
    progress.report({ message, fraction: 1 })

    return Ok.EMPTY
  })

  if (wipeResult.err) {
    dialog.errorNotification("Failed to wipe extension data.", wipeResult.val)
    return
  }

  await authState.clear()
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
