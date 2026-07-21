import * as vscode from "vscode"

import * as actions from "../actions"
import type { ActionContext } from "../actions/types"
import { BottleneckError } from "../errors"
import { matchBackend } from "../shared/shared"
import { Logger } from "../utilities"

export async function pasteExercise(
  actionContext: ActionContext,
  resource: vscode.Uri | undefined,
): Promise<void> {
  const { dialog, workspaceManager } = actionContext
  Logger.info("Pasting exercise")
  if (workspaceManager.err) {
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

  const pasteResult = await matchBackend(
    exercise,
    () => actions.pasteTmcExercise(actionContext, exercise.courseSlug, exercise.exerciseSlug),
    () => actions.pasteMoocExercise(actionContext, exercise.courseSlug, exercise.exerciseSlug),
  )
  if (pasteResult.err) {
    if (pasteResult.val instanceof BottleneckError) {
      Logger.warn(`Paste submission was cancelled: ${pasteResult.val.message}.`)
      return
    }

    const pasteService = matchBackend(
      exercise,
      () => "TMC Paste",
      () => "courses.mooc.fi paste",
    )
    dialog.errorNotification(`Failed to send the exercise to ${pasteService}.`, pasteResult.val)
    return
  }

  dialog.notification(`Paste link: ${pasteResult.val}`, [
    "Open URL",
    (): Thenable<boolean> => vscode.env.openExternal(vscode.Uri.parse(pasteResult.val)),
  ])
}
