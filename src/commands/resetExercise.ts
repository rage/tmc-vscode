import * as vscode from "vscode"

import type { ActionContext } from "../actions/types"
import { backendName, ExerciseIdentifier } from "../shared/shared"
import { Logger } from "../utilities"

/**
 * Resets an exercise to its initial state. Optionally submits the exercise beforehand.
 *
 * @param id ID of the exercise to reset.
 * @param options Optional parameters that can be used to control the action behavior.
 */
export async function resetExercise(
  actionContext: ActionContext,
  resource: vscode.Uri | undefined,
): Promise<void> {
  const { dialog, langs, userData, workspaceManager } = actionContext
  Logger.info("Resetting exercise")
  if (!(langs.ok && userData.ok && workspaceManager.ok)) {
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

  // Look up by known backend rather than a name-only match, which could
  // resolve to the wrong backend if a tmc and mooc exercise share a slug.
  const exerciseDetails =
    exercise.backend === "mooc"
      ? userData.val.getMoocExerciseByName(exercise.courseSlug, exercise.exerciseSlug)
      : userData.val.getTmcExerciseByName(exercise.courseSlug, exercise.exerciseSlug)
  if (!exerciseDetails) {
    dialog.errorNotification(`Missing exercise data for ${exercise.exerciseSlug}.`)
    return
  }

  const id = ExerciseIdentifier.from(exerciseDetails.id)
  const serverName = backendName(id.kind)
  const submitFirst = await dialog.confirmation(
    `Do you want to save the current state of the exercise by submitting it to ${serverName}?`,
  )
  if (submitFirst === undefined) {
    Logger.debug("Answer for submitting first not provided, returning early.")
    return
  }

  const editor = vscode.window.activeTextEditor
  const document = editor?.document.uri
  const resetResult = await langs.val.resetExercise(id, exercise.uri.fsPath, submitFirst)
  if (resetResult.err) {
    dialog.errorNotification("Failed to reset exercise.", resetResult.val)
    return
  }

  if (editor && document) {
    Logger.debug(`Reopening original file "${document.fsPath}"`)
    await vscode.commands.executeCommand("workbench.action.files.revert", document)
  }
}
