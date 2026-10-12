import type * as vscode from "vscode"

import { pasteServiceName } from "../../shared/lib"
import * as actions from "../actions"
import type { ReadyActionContext } from "../actions/types"
import { failure } from "../api/withOperation"
import { openWebLink } from "../utilities"
import { runForExercise } from "./runForExercise"

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
      const result = await dialog.progressNotification(
        `Sending ${exercise.exerciseSlug} to ${pasteServiceName(exercise.backend)}…`,
        () => actions.pasteExercise(actionContext, exercise.id),
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
    (): Promise<boolean> => openWebLink(pasteResult.val),
  ])
}
