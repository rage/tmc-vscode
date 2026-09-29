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
  Logger.info("Moving the exercises folder")
  if (!resources.projectsDirectory) {
    await dialog.errorNotification(
      "Moving the exercises folder is unavailable: the TestMyCode tools did not report where the exercises folder is.",
      new Error("tmc-langs did not report an exercise directory"),
    )
    return
  }

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
  if (res.ok) {
    Logger.info(`Moved workspace folder from ${old} to ${res.val}`)
    dialog.notification(
      res.val === newPath.fsPath
        ? `Moved the exercises folder to ${res.val}.`
        : `Moved the exercises folder to ${res.val}. The folder you chose was not empty, so a` +
            " tmcdata subfolder was used.",
    )
  }
}
