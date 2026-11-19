import { ExerciseIdentifier, LocalCourseExercise } from "../../shared/lib"
import type { ReadyActionContext } from "./types"

/** The name the student knows `exerciseId` by, or its id if no stored course has it. */
export function exerciseName(
  actionContext: ReadyActionContext,
  exerciseId: ExerciseIdentifier,
): string {
  const stored = actionContext.startup.userData.getExercise(exerciseId)
  return stored.ok
    ? LocalCourseExercise.getSlug(stored.val.exercise)
    : ExerciseIdentifier.toString(exerciseId)
}

const LISTED_EXERCISE_LIMIT = 5

/** Names the exercises in a sentence, e.g. "the exercise loops" or "2 exercises: a, b". */
export function describeExercises(names: string[]): string {
  const listed = names.slice(0, LISTED_EXERCISE_LIMIT).join(", ")
  const rest = names.length - LISTED_EXERCISE_LIMIT
  if (names.length === 1) {
    return `the exercise ${listed}`
  }
  return `${names.length} exercises: ${listed}${rest > 0 ? ` and ${rest} more` : ""}`
}
