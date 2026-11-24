import * as path from "path"

import * as vscode from "vscode"

import { moveExtensionDataPath } from "../actions"
import type { ReadyActionContext } from "../actions/types"
import { withOperation } from "../api/withOperation"
import { isPathInside, Logger } from "../utilities"

/** Asks for a new folder for the extension's data and moves the exercises there. */
export async function changeTmcDataPath(actionContext: ReadyActionContext): Promise<void> {
  const { dialog } = actionContext
  const { resources } = actionContext.startup
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
  const risk = riskyFolderReason(newPath.fsPath)
  if (risk) {
    const isMoving = await dialog.choose(
      `${risk} Exercises work best in a local folder that no app syncs, such as C:\\TMC.`,
      { detail: "Tests and submissions may fail there, or files may be held or duplicated." },
      ["Move Anyway", true],
      ["Cancel", false],
    )
    if (!isMoving) {
      return
    }
  }

  Logger.info(`Moving the exercises folder to ${newPath.fsPath}`)
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
}

const SYNCED_FOLDER_NAMES = /[\\/](OneDrive[^\\/]*|Dropbox|Google Drive|iCloud Drive|Box)([\\/]|$)/i

/** Why `folder` is a poor place for exercises, as a sentence, or `undefined` when it is fine. */
export function riskyFolderReason(
  folder: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const syncRoots = [env.OneDrive, env.OneDriveCommercial, env.OneDriveConsumer].filter(
    (root): root is string => !!root,
  )
  if (
    SYNCED_FOLDER_NAMES.test(folder) ||
    syncRoots.some((root) => isPathInside(root, folder, path.win32))
  ) {
    return `${folder} is synced to the cloud.`
  }
  if (/^(\\\\|\/\/)/.test(folder)) {
    return `${folder} is on a network drive.`
  }
  if (/^\/(media|mnt|Volumes)\//.test(folder)) {
    return `${folder} may be on a removable or network drive.`
  }
  if (folder.length > 120) {
    return `${folder} is a long path, and the exercises' own files add to it.`
  }
  return undefined
}
