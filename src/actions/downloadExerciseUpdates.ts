import type { Result } from "ts-results"
import { Ok } from "ts-results"

import { CourseIdentifier, ExerciseIdentifier } from "../../shared/lib"
import type { OperationWarning, Warned } from "../api/withOperation"
import { isSessionLost, presentationFor } from "../errors"
import { failedUpdates } from "../ui/failedUpdates"
import { updateablesRegistry } from "../ui/updateablesRegistry"
import { downloadOrUpdateExercises } from "./downloadOrUpdateExercises"
import { exerciseName } from "./exerciseNames"
import { refreshLocalExercises } from "./refreshLocalExercises"
import type { ReadyActionContext } from "./types"

/** What {@link downloadExerciseUpdates} updated. */
export interface ExerciseUpdates extends Warned {
  updated: ExerciseIdentifier[]
}

interface ExerciseUpdate {
  courseId: CourseIdentifier
  exerciseId: ExerciseIdentifier
}

/**
 * Downloads pending updates that may span several courses, then rescans the disk.
 *
 * Each course's "update available" list is emptied while the download runs, so the student
 * sees the work begin, and afterwards holds only the exercises that failed. It is refilled
 * even when the download throws, lest the student conclude there is nothing left to update.
 * Errs, with nothing downloaded, only while some of the exercises are busy with another
 * operation. The exercises that failed stay in `failedUpdates` until they update or have no
 * update left; a requested update also warns of them.
 *
 * For exercises not on disk yet, see `downloadCourseExercises`.
 *
 * @param isUnrequested See `downloadOrUpdateExercises`'s options.
 */
export async function downloadExerciseUpdates(
  actionContext: ReadyActionContext,
  updates: readonly ExerciseUpdate[],
  isUnrequested = false,
): Promise<Result<ExerciseUpdates, Error>> {
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

  setUpdateablesByCourse([])
  let stillUpdateable = updates.map((x) => x.exerciseId)
  let warnings: OperationWarning[] = []
  let updated: ExerciseIdentifier[] = []
  try {
    const [onlyCourse, ...otherCourses] = courseIds.values()
    const downloaded = await downloadOrUpdateExercises(
      actionContext,
      updates.map((x) => x.exerciseId),
      otherCourses.length === 0 ? onlyCourse : undefined,
      { isUpdate: true, isUnrequested },
    )
    if (downloaded.err) {
      return downloaded
    }
    const { successful, failed, failureCause } = downloaded.val
    stillUpdateable = failed
    warnings = downloaded.val.warnings
    const reason = failureCause ? presentationFor(failureCause).message : ""
    failedUpdates.record(
      updates
        .filter((x) =>
          failed.some((id) => ExerciseIdentifier.key(id) === ExerciseIdentifier.key(x.exerciseId)),
        )
        .map((x) => ({ ...x, exerciseName: exerciseName(actionContext, x.exerciseId), reason })),
      successful,
    )
    if (isUnrequested && failureCause && isSessionLost(failureCause)) {
      // A lost session still warns: that warning is what offers Log In.
      warnings.push({ headline: "Failed to update exercises.", error: failureCause })
    }
    updated = successful
  } finally {
    setUpdateablesByCourse(stillUpdateable)
  }

  const refreshed = await refreshLocalExercises(actionContext)
  if (refreshed.err) {
    warnings.push({ headline: "Failed to refresh local exercises.", error: refreshed.val })
  }
  return Ok({ updated, warnings })
}
