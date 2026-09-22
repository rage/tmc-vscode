import * as vscode from "vscode"

import { moveExtensionDataPath } from "../actions"
import type { ReadyActionContext } from "../actions/types"
import { Logger } from "../utilities"

/**
 * Asks for a new folder for the extension's data and moves the exercises there.
 */
export async function changeTmcDataPath(actionContext: ReadyActionContext): Promise<void> {
  const { dialog } = actionContext
  const { resources } = actionContext.startup
  Logger.info("Changing TMC data path")
  if (!resources.projectsDirectory) {
    await dialog.errorNotification(
      "Changing the TMC data path is unavailable: tmc-langs did not report an exercise directory.",
      new Error("tmc-langs did not report an exercise directory"),
    )
    return
  }

  const old = resources.projectsDirectory
  const options: vscode.OpenDialogOptions = {
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Select folder",
    defaultUri: vscode.Uri.file(old),
  }

  const newPath = (await vscode.window.showOpenDialog(options))?.[0]
  if (newPath) {
    const res = await dialog.progressNotification("Moving projects directory...", (progress) => {
      return moveExtensionDataPath(actionContext, newPath, (update) => progress.report(update))
    })
    if (res.ok) {
      Logger.info(`Moved workspace folder from ${old} to ${res.val}`)
      dialog.notification(
        res.val === newPath.fsPath
          ? `TMC Data was successfully moved to ${res.val}`
          : `TMC Data was successfully moved to ${res.val} — the folder you chose was not empty, \
so a tmcdata subfolder was used.`,
      )
    } else {
      dialog.reportError("Failed to move the projects directory.", res.val)
    }
  }
}
