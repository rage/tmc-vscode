import * as vscode from "vscode"

import type { ReadyActionContext } from "../actions/types"

/** Reveals the extension's downloaded-exercises directory in the OS file explorer. */
export async function openExercisesFolder(actionContext: ReadyActionContext): Promise<void> {
  const { dialog } = actionContext
  const { projectsDirectory } = actionContext.startup.resources
  if (!projectsDirectory) {
    void dialog.errorNotification(
      "Opening the exercises folder is unavailable: tmc-langs did not report an exercise directory.",
      new Error("tmc-langs did not report an exercise directory"),
    )
    return
  }

  await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(projectsDirectory))
}
