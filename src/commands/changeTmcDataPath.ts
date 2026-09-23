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
  const { resources } = actionContext.startup
  Logger.info("Changing TMC data path")
  if (!resources.projectsDirectory) {
    await dialog.errorNotification(
      "Changing the data path is unavailable: tmc-langs did not report an exercise directory.",
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
  if (!newPath) {
    return
  }

  const res = await withOperation(
    dialog,
    {
      failure: "Failed to move the projects directory.",
      progress: "Moving projects directory...",
    },
    (report) => moveExtensionDataPath(actionContext, newPath, report),
  )
  if (res.ok) {
    Logger.info(`Moved workspace folder from ${old} to ${res.val}`)
    dialog.notification(
      res.val === newPath.fsPath
        ? `TMC Data was successfully moved to ${res.val}`
        : `TMC Data was successfully moved to ${res.val} — the folder you chose was not empty, \
so a tmcdata subfolder was used.`,
    )
  }
}
