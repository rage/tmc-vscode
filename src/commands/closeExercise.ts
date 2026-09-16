import { Ok } from "ts-results"
import * as vscode from "vscode"

import * as actions from "../actions"
import type { ActionContext } from "../actions/types"
import { LocalCourseData, LocalCourseExercise } from "../shared/shared"
import { Logger } from "../utilities"
import { runForExercise } from "./runForExercise"

export async function closeExercise(
  actionContext: ActionContext,
  resource: vscode.Uri | undefined,
): Promise<void> {
  const { dialog, userData } = actionContext
  if (userData.err) {
    Logger.error("Extension was not initialized properly")
    return
  }

  await runForExercise(actionContext, resource, "Closing the exercise", async (exercise) => {
    // Both lookups are qualified by the backend the on-disk exercise belongs to.
    // A name-only lookup would resolve to the wrong backend — or to nothing at all
    // — whenever a tmc and a mooc course happen to share a slug.
    const localExercise = userData.val.getExerciseByName(
      exercise.backend,
      exercise.courseSlug,
      exercise.exerciseSlug,
    )
    if (!localExercise) {
      return Ok.EMPTY
    }

    const exerciseId = LocalCourseExercise.getId(localExercise)
    const confirmed =
      userData.val.getPassed(exerciseId) ||
      (await dialog.confirmation(
        `Are you sure you want to close uncompleted exercise ${exercise.exerciseSlug}?`,
      ))
    if (!confirmed) {
      return Ok.EMPTY
    }

    const course = userData.val.getCourseBySlug(exercise.backend, exercise.courseSlug)
    if (course.err) {
      return course
    }

    const result = await actions.closeExercises(
      actionContext,
      [exerciseId],
      LocalCourseData.getCourseId(course.val),
    )
    if (result.err) {
      return result
    }

    vscode.commands.executeCommand("workbench.action.closeActiveEditor")
    return Ok.EMPTY
  })
}
