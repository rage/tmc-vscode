import { modelSolutionUrlOf } from "../../shared/lib"
import { TMC_BACKEND_URL } from "../config/constants"
import type { StoredExercise } from "../config/userdata"

/**
 * The page that shows an exercise's model solution, once its backend shows it to the student;
 * `undefined` before that.
 *
 * A tmc exercise's solution page follows tmc-server's own rule: shown once the exercise is
 * passed, unless the course hides submission results.
 */
export function modelSolutionUrl({ exercise, course }: StoredExercise): string | undefined {
  if (exercise.kind === "mooc") {
    return modelSolutionUrlOf(exercise)
  }
  if (!exercise.data.passed || (course.kind === "tmc" && course.data.perhapsExamMode)) {
    return undefined
  }
  // The server the CLI talks to, which tests point at the mock one.
  const root = process.env.TMC_LANGS_TMC_ROOT_URL ?? TMC_BACKEND_URL
  return new URL(`exercises/${exercise.data.id}/solution`, root.endsWith("/") ? root : `${root}/`)
    .href
}
