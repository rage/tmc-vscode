import * as vscode from "vscode"

import * as actions from "../actions"
import type { ActionContext } from "../actions/types"
import { matchBackend } from "../shared/shared"
import { failure, runForExercise } from "./runForExercise"

export async function pasteExercise(
  actionContext: ActionContext,
  resource: vscode.Uri | undefined,
): Promise<void> {
  const { dialog } = actionContext
  const pasteResult = await runForExercise(
    actionContext,
    resource,
    "Pasting the exercise",
    async (exercise) => {
      const result = await matchBackend(
        exercise,
        () => actions.pasteTmcExercise(actionContext, exercise.courseSlug, exercise.exerciseSlug),
        () => actions.pasteMoocExercise(actionContext, exercise.courseSlug, exercise.exerciseSlug),
      )
      if (result.ok) {
        return result
      }

      const pasteService = matchBackend(
        exercise,
        () => "TMC Paste",
        () => "courses.mooc.fi paste",
      )
      return failure(`Failed to send the exercise to ${pasteService}.`, result.val)
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
