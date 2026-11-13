import type { Result } from "ts-results"
import { Err } from "ts-results"

import type { WorkspaceExercise } from "../api/workspaceManager"
import type { StoredExercise } from "../config/userdata"
import { ExerciseRemovedError } from "../errors"
import type { ReadyActionContext } from "./types"

/**
 * The stored course data of an exercise on disk. Errs with `ExerciseRemovedError` when its
 * course is still added but no longer lists it, as after the teacher removed it.
 */
export function storedExerciseOf(
  actionContext: ReadyActionContext,
  exercise: Pick<WorkspaceExercise, "id" | "courseId" | "exerciseSlug">,
): Result<StoredExercise, Error> {
  const { userData } = actionContext.startup
  const stored = userData.getExercise(exercise.id)
  if (stored.err && userData.getCourse(exercise.courseId).ok) {
    return Err(
      new ExerciseRemovedError(
        `${exercise.exerciseSlug} was removed from the course, so it can no longer be ` +
          "submitted or restored. Its files stay on this computer, and Run Tests still works.",
      ),
    )
  }
  return stored
}
