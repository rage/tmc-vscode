import type * as vscode from "vscode"

import type { ReadyActionContext } from "../actions/types"
import { exerciseFor } from "../api/workspaceManager"
import type { StoredExercise } from "../config/userdata"
import { modelSolutionUrl } from "../ui/modelSolution"
import { openWebLink } from "../utilities"

/**
 * Opens the page that shows the exercise's model solution, or says when there is none to show
 * yet.
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
  const url = stored.ok ? solutionPageOf(stored.val) : undefined
  if (!url) {
    void dialog.notification(
      exercise.backend === "mooc"
        ? `${exercise.exerciseSlug} has no model solution to show yet. If it has one, it shows ` +
            "once you pass the exercise or run out of tries."
        : `The model solution of ${exercise.exerciseSlug} is shown once you pass it.`,
    )
    return
  }
  await openWebLink(url)
}

/** For mooc, the course material page, which shows the model solution once it is sent. */
function solutionPageOf(stored: StoredExercise): string | undefined {
  const { exercise } = stored
  if (exercise.kind === "mooc") {
    return exercise.data.hasModelSolution ? exercise.data.pageUrl : undefined
  }
  return modelSolutionUrl(stored)
}
