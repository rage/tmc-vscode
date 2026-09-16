import type * as vscode from "vscode"

import * as actions from "../actions"
import type { ActionContext } from "../actions/types"
import { BottleneckError } from "../errors"
import { Logger } from "../utilities"

export async function testExercise(
  context: vscode.ExtensionContext,
  actionContext: ActionContext,
  resource: vscode.Uri | undefined,
): Promise<void> {
  const { dialog, workspaceManager } = actionContext
  Logger.info("Testing exercise")
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

  const result = await actions.testExercise(context, actionContext, exercise)
  if (result.err) {
    if (result.val instanceof BottleneckError) {
      Logger.warn("Test run was rejected:", result.val)
      return
    }

    dialog.errorNotification("Exercise test run failed.", result.val)
  }
}
