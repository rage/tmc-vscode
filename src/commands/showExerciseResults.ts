import * as path from "path"

import type * as vscode from "vscode"

import type { ExerciseSection } from "../../shared/lib"
import { exerciseResultsPanel } from "../actions"
import type { ReadyActionContext } from "../actions/types"
import { exerciseFor } from "../api/workspaceManager"
import { submissionViews } from "../ui/submissionViews"

/**
 * Shows the exercise's results panel, focused: its latest submission, or else where the
 * exercise stands.
 *
 * @param resource An exercise file or folder; the active editor's exercise when omitted.
 * @param section The section to open, with a paste sent there for `shouldPaste`.
 */
export async function showExerciseResults(
  actionContext: ReadyActionContext,
  resource: vscode.Uri | undefined,
  section?: { name: ExerciseSection; shouldPaste: boolean },
): Promise<void> {
  const { dialog } = actionContext
  const exercise = exerciseFor(actionContext.startup.workspaceManager, resource)
  if (!exercise) {
    void dialog.errorNotification(
      resource
        ? `${path.basename(resource.fsPath)} is not part of a course exercise.`
        : "Open a file of an exercise first.",
    )
    return
  }
  const panel = exerciseResultsPanel(actionContext, exercise)
  if (panel.err) {
    void dialog.errorNotification(panel.val.message)
    return
  }
  submissionViews.reveal(panel.val, section)
}
