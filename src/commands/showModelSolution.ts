import type * as vscode from "vscode"

import { modelSolutionUrlOf } from "../../shared/lib"
import type { ReadyActionContext } from "../actions/types"
import { exerciseFor } from "../api/workspaceManager"
import { openWebLink } from "../utilities"

/**
 * Opens the course material page that shows the exercise's model solution, or says when there
 * is none to show yet.
 *
 * @param resource An exercise file or folder; the active editor's exercise when omitted.
 */
export async function showModelSolution(
  actionContext: ReadyActionContext,
  resource: vscode.Uri | undefined,
): Promise<void> {
  const { dialog } = actionContext
  const { userData, workspaceManager } = actionContext.startup
  const exercise = exerciseFor(workspaceManager, resource)
  if (!exercise) {
    void dialog.errorNotification("Open a file of an exercise first.")
    return
  }
  const stored = userData.getExercise(exercise.id)
  const url = stored.ok ? modelSolutionUrlOf(stored.val.exercise) : undefined
  if (!url) {
    void dialog.notification(
      exercise.backend === "mooc"
        ? `The model solution of ${exercise.exerciseSlug} is shown once you pass it or run ` +
            "out of tries."
        : `The model solution of ${exercise.exerciseSlug} is linked from its submission result.`,
    )
    return
  }
  await openWebLink(url)
}
