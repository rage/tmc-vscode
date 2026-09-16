import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import type * as vscode from "vscode"

import * as actions from "../actions"
import type { ActionContext } from "../actions/types"
import { BottleneckError } from "../errors"
import { Logger } from "../utilities"

export async function submitExercise(
  context: vscode.ExtensionContext,
  actionContext: ActionContext,
  resource: vscode.Uri | undefined,
): Promise<Result<void, Error>> {
  const { dialog, workspaceManager } = actionContext
  Logger.info("Submitting exercise")
  if (workspaceManager.err) {
    Logger.error("Extension was not initialized properly")
    return workspaceManager
  }

  const exercise = resource
    ? workspaceManager.val.getExerciseByPath(resource)
    : workspaceManager.val.activeExercise
  if (!exercise) {
    const error = new Error("The active editor is not part of a course exercise.")
    dialog.errorNotification(error.message)
    return Err(error)
  }

  const result =
    exercise.backend === "mooc"
      ? await actions.submitMoocExercise(context, actionContext, exercise)
      : await actions.submitTmcExercise(context, actionContext, exercise)
  if (result.err) {
    if (result.val instanceof BottleneckError) {
      Logger.warn("Submission was cancelled:", result.val)
      return result
    }

    dialog.errorNotification("Exercise submission failed.", result.val)
    return result
  }
  return Ok.EMPTY
}
