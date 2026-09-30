import type { Result } from "ts-results"

import { withOptimisticList } from "../panels/exerciseLists"
import { CourseIdentifier, ExerciseIdentifier } from "../shared/shared"
import { updateablesRegistry } from "../ui/updateablesRegistry"
import { downloadOrUpdateExercises } from "./downloadOrUpdateExercises"
import type { ReadyActionContext } from "./types"

interface ExerciseUpdate {
  courseId: CourseIdentifier
  exerciseId: ExerciseIdentifier
}

/**
 * Downloads pending updates that may span several courses, emptying each course's
 * "update available" list while the download runs and leaving only the exercises
 * that failed. Errs, with nothing downloaded, only while some of them are already downloading.
 *
 * For one course's list, see `downloadExercisesForUi`.
 */
export async function downloadExerciseUpdates(
  actionContext: ReadyActionContext,
  updates: readonly ExerciseUpdate[],
): Promise<Result<void, Error>> {
  // Each `courseId` is a fresh object, so only a key tells two of them are one course.
  const courseIds = new Map(updates.map((x) => [CourseIdentifier.key(x.courseId), x.courseId]))

  const setUpdateablesByCourse = (exerciseIds: ExerciseIdentifier[]): void => {
    const wanted = new Set(exerciseIds.map((x) => ExerciseIdentifier.key(x)))
    updateablesRegistry.setMany(
      Array.from(courseIds, ([key, courseId]) => [
        courseId,
        updates
          .filter(
            (x) =>
              CourseIdentifier.key(x.courseId) === key &&
              wanted.has(ExerciseIdentifier.key(x.exerciseId)),
          )
          .map((x) => x.exerciseId),
      ]),
    )
  }

  const downloaded = await withOptimisticList(
    () => setUpdateablesByCourse([]),
    () =>
      downloadOrUpdateExercises(
        actionContext,
        updates.map((x) => x.exerciseId),
      ),
    (outcome) =>
      setUpdateablesByCourse(outcome?.ok ? outcome.val.failed : updates.map((x) => x.exerciseId)),
  )
  return downloaded.map(() => undefined)
}
