import { Ok } from "ts-results"
import type * as vscode from "vscode"

import * as actions from "../actions"
import type { ReadyActionContext } from "../actions/types"
import { failure } from "../api/withOperation"
import { closeExerciseEditors } from "../window/exerciseDocuments"
import { runForExercise } from "./runForExercise"

export async function closeExercise(
  actionContext: ReadyActionContext,
  resource: vscode.Uri | undefined,
): Promise<void> {
  const { dialog } = actionContext
  const { userData } = actionContext.startup
  await runForExercise(actionContext, resource, "Closing the exercise", async (exercise) => {
    const exerciseId = exercise.id
    const confirmed =
      userData.getPassed(exerciseId) ||
      (await dialog.confirm(`Close ${exercise.exerciseSlug}?`, {
        confirmLabel: "Close Exercise",
        detail:
          "You have not passed this exercise yet. Its files are kept, and you can open it again from the Courses view.",
      }))
    if (!confirmed) {
      return Ok.EMPTY
    }

    const result = await actions.closeExercises(actionContext, [exerciseId], exercise.courseId)
    if (result.err) {
      return failure("Error when closing exercise.", result.val)
    }

    await closeExerciseEditors(exercise)
    return Ok.EMPTY
  })
}
