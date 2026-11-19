import type * as vscode from "vscode"

import type { ReadyActionContext } from "../actions/types"
import { showExerciseResults } from "./showExerciseResults"

/**
 * Opens the History of the exercise's results panel, which lists its earlier submissions to
 * restore.
 *
 * @param resource An exercise file or folder; the active editor's exercise when omitted.
 */
export async function downloadOldSubmission(
  actionContext: ReadyActionContext,
  resource: vscode.Uri | undefined,
): Promise<void> {
  await showExerciseResults(actionContext, resource, { name: "history", shouldPaste: false })
}
