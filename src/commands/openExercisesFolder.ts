import * as vscode from "vscode"

import type { ReadyActionContext } from "../actions/types"

/** Reveals the extension's downloaded-exercises directory in the OS file explorer. */
export async function openExercisesFolder(actionContext: ReadyActionContext): Promise<void> {
  const { projectsDirectory } = actionContext.startup.resources
  await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(projectsDirectory))
}
