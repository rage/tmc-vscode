import * as vscode from "vscode"

import * as actions from "../actions"
import type { ActionContext } from "../actions/types"
import { LocalCourseData, LocalCourseExercise } from "../shared/shared"
import { Logger } from "../utilities"

export async function closeExercise(
  actionContext: ActionContext,
  resource: vscode.Uri | undefined,
): Promise<void> {
  const { dialog, userData, workspaceManager } = actionContext
  Logger.info("Closing exercise")
  if (!(workspaceManager.ok && userData.ok)) {
    Logger.error("Extension was not initialized properly")
    return
  }

  const exercise = resource
    ? workspaceManager.val.getExerciseByPath(resource)
    : workspaceManager.val.activeExercise
  if (!exercise) {
    dialog.errorNotification("The active editor is not part of a course exercise.")
    return
  }

  // Both lookups are qualified by the backend the on-disk exercise belongs to.
  // A name-only lookup would resolve to the wrong backend — or to nothing at all
  // — whenever a tmc and a mooc course happen to share a slug.
  const localExercise = userData.val.getExerciseByName(
    exercise.backend,
    exercise.courseSlug,
    exercise.exerciseSlug,
  )
  const exerciseId = localExercise ? LocalCourseExercise.getId(localExercise) : undefined
  if (
    exerciseId &&
    (userData.val.getPassed(exerciseId) ||
      (await dialog.confirmation(
        `Are you sure you want to close uncompleted exercise ${exercise.exerciseSlug}?`,
      )))
  ) {
    const course = userData.val.getCourseBySlug(exercise.backend, exercise.courseSlug)
    const courseId = LocalCourseData.getCourseId(course)
    const result = await actions.closeExercises(actionContext, [exerciseId], courseId)
    if (result.err) {
      dialog.errorNotification("Error when closing exercise.", result.val)
      return
    }

    vscode.commands.executeCommand("workbench.action.closeActiveEditor")
  }
}
