import * as vscode from "vscode"

import type { ReadyActionContext } from "../actions/types"

/** Reveals the extension's downloaded-exercises directory in the OS file explorer. */
export async function openExercisesFolder(actionContext: ReadyActionContext): Promise<void> {
  const { dialog } = actionContext
  const { projectsDirectory } = actionContext.startup.resources
  if (!projectsDirectory) {
    void dialog.errorNotification(
      "Opening the exercises folder is unavailable: the TestMyCode tools did not report where the exercises folder is.",
      new Error("tmc-langs did not report an exercise directory"),
    )
    return
  }

  await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(projectsDirectory))
}
