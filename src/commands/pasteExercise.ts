import * as vscode from "vscode"

import * as actions from "../actions"
import type { ReadyActionContext } from "../actions/types"
import { pasteServiceName } from "../shared/shared"
import { failure, runForExercise } from "./runForExercise"

export async function pasteExercise(
  actionContext: ReadyActionContext,
  resource: vscode.Uri | undefined,
): Promise<void> {
  const { dialog } = actionContext
  const pasteResult = await runForExercise(
    actionContext,
    resource,
    "Pasting the exercise",
    async (exercise) => {
      const result = await actions.pasteExercise(
        actionContext,
        exercise.backend,
        exercise.courseSlug,
        exercise.exerciseSlug,
      )
      if (result.ok) {
        return result
      }
      return failure(
        `Failed to send the exercise to ${pasteServiceName(exercise.backend)}.`,
        result.val,
      )
    },
  )
  if (pasteResult.err) {
    return
  }

  dialog.notification(`Paste link: ${pasteResult.val}`, [
    "Open URL",
    (): Thenable<boolean> => vscode.env.openExternal(vscode.Uri.parse(pasteResult.val)),
  ])
}
