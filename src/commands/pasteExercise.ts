import * as vscode from "vscode"

import * as actions from "../actions"
import type { ActionContext } from "../actions/types"
import { matchBackend } from "../shared/shared"
import { runForExercise } from "./runForExercise"

export async function pasteExercise(
  actionContext: ActionContext,
  resource: vscode.Uri | undefined,
): Promise<void> {
  const { dialog } = actionContext
  const pasteResult = await runForExercise(
    actionContext,
    resource,
    "Pasting the exercise",
    (exercise) =>
      matchBackend(
        exercise,
        () => actions.pasteTmcExercise(actionContext, exercise.courseSlug, exercise.exerciseSlug),
        () => actions.pasteMoocExercise(actionContext, exercise.courseSlug, exercise.exerciseSlug),
      ),
  )
  if (pasteResult.err) {
    return
  }

  dialog.notification(`Paste link: ${pasteResult.val}`, [
    "Open URL",
    (): Thenable<boolean> => vscode.env.openExternal(vscode.Uri.parse(pasteResult.val)),
  ])
}
