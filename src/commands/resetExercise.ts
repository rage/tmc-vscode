import { Ok } from "ts-results"
import type * as vscode from "vscode"

import { backendName } from "../../shared/lib"
import { checkAiUse, resetExercise as resetExerciseAction } from "../actions"
import type { ReadyActionContext } from "../actions/types"
import { failure } from "../api/withOperation"
import { revertExerciseDocuments } from "../window/exerciseDocuments"
import { confirmSubmitBeforeDestructiveAction } from "./confirmSubmitBeforeDestructiveAction"
import { runForExercise } from "./runForExercise"

/**
 * Resets an exercise to its initial state, optionally submitting it beforehand.
 *
 * @param resource An exercise file or folder; the active editor's exercise when omitted.
 */
export async function resetExercise(
  actionContext: ReadyActionContext,
  resource: vscode.Uri | undefined,
): Promise<void> {
  const { dialog } = actionContext
  const { userData } = actionContext.startup
  await runForExercise(actionContext, resource, "Resetting the exercise", async (exercise) => {
    const stored = userData.getExercise(exercise.id)
    if (stored.err) {
      return failure(`Missing exercise data for ${exercise.exerciseSlug}.`, stored.val)
    }

    const { id } = exercise
    const submitFirst = await confirmSubmitBeforeDestructiveAction(actionContext, exercise, {
      message: `Reset ${exercise.exerciseSlug}?`,
      replacement: "the exercise template",
      verb: "Reset",
      serverName: backendName(id.kind),
    })
    if (submitFirst === undefined) {
      return Ok.EMPTY
    }
    if (submitFirst) {
      const allowed = await checkAiUse(actionContext, exercise)
      if (allowed.err) {
        return allowed
      }
    }

    const resetResult = await dialog.progressNotification(
      submitFirst
        ? `Submitting and resetting ${exercise.exerciseSlug}…`
        : `Resetting ${exercise.exerciseSlug}…`,
      () => resetExerciseAction(actionContext, id, exercise, submitFirst),
    )
    if (resetResult.err) {
      return failure("Failed to reset exercise.", resetResult.val)
    }

    await revertExerciseDocuments(exercise)
    dialog.statusMessage(`Reset ${exercise.exerciseSlug}.`)
    return Ok.EMPTY
  })
}
