import { postUpdateables, withOptimisticList } from "../panels/exerciseLists"
import { CourseIdentifier, ExerciseIdentifier } from "../shared/shared"
import { downloadOrUpdateExercises } from "./downloadOrUpdateExercises"
import type { ReadyActionContext } from "./types"

interface ExerciseUpdate {
  courseId: CourseIdentifier
  exerciseId: ExerciseIdentifier
}

/**
 * Downloads pending updates that may span several courses, emptying each course's
 * "update available" list while the download runs and leaving only the exercises
 * that failed.
 *
 * Reports a failed download itself. For one course's list driven from its own
 * panel, see `downloadExercisesForUi`.
 */
export async function downloadExerciseUpdates(
  actionContext: ReadyActionContext,
  updates: readonly ExerciseUpdate[],
): Promise<void> {
  const { dialog } = actionContext

  // Keyed by canonical string because each `courseId` is a fresh object, so
  // anything comparing them by reference sees every exercise as its own course.
  const courseIds = new Map(updates.map((x) => [CourseIdentifier.toString(x.courseId), x.courseId]))

  // Broadcast per course so a CourseDetails panel only applies its own list.
  const postUpdateablesByCourse = (exerciseIds: ExerciseIdentifier[]): void => {
    const wanted = new Set(exerciseIds.map((x) => ExerciseIdentifier.unwrap(x)))
    for (const [key, courseId] of courseIds) {
      postUpdateables(
        courseId,
        updates
          .filter(
            (x) =>
              CourseIdentifier.toString(x.courseId) === key &&
              wanted.has(ExerciseIdentifier.unwrap(x.exerciseId)),
          )
          .map((x) => x.exerciseId),
      )
    }
  }

  await withOptimisticList(
    () => postUpdateablesByCourse([]),
    async (): Promise<ExerciseIdentifier[] | undefined> => {
      const downloadResult = await downloadOrUpdateExercises(
        actionContext,
        updates.map((x) => x.exerciseId),
      )
      if (downloadResult.err) {
        dialog.reportError("Failed to update exercises.", downloadResult.val)
        return undefined
      }
      return downloadResult.val.failed
    },
    (failed) => postUpdateablesByCourse(failed ?? updates.map((x) => x.exerciseId)),
  )
}
