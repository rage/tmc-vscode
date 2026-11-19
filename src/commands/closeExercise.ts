import { Ok } from "ts-results"
import type * as vscode from "vscode"

import * as actions from "../actions"
import type { ReadyActionContext } from "../actions/types"
import { failure } from "../api/withOperation"
import { closeExerciseEditors } from "../window/exerciseDocuments"
import { runForExercise } from "./runForExercise"

/** Closes an exercise; its files stay, and it opens again from the Courses view. */
export async function closeExercise(
  actionContext: ReadyActionContext,
  resource: vscode.Uri | undefined,
): Promise<void> {
  await runForExercise(actionContext, resource, "Closing the exercise", async (exercise) => {
    const result = await actions.closeExercises(actionContext, [exercise.id], exercise.courseId)
    if (result.err) {
      return failure("Error when closing exercise.", result.val)
    }

    await closeExerciseEditors(exercise)
    return Ok.EMPTY
  })
}
