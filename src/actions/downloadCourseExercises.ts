import { Ok, Result } from "ts-results"

import type { CourseIdentifier, ExerciseIdentifier } from "../../shared/lib"
import type { Warned } from "../api/withOperation"
import { downloadOrUpdateExercises } from "./downloadOrUpdateExercises"
import { refreshLocalExercises } from "./refreshLocalExercises"
import type { ReadyActionContext } from "./types"

/**
 * Downloads exercises of one course, takes them off its new-exercise list and rescans the
 * disk, so the Courses view shows the result. Errs, with nothing downloaded, only while some
 * of the exercises are busy with another operation; any other failure is a warning.
 *
 * For exercises already on disk, see `downloadExerciseUpdates`.
 */
export async function downloadCourseExercises(
  actionContext: ReadyActionContext,
  courseId: CourseIdentifier,
  exerciseIds: ExerciseIdentifier[],
): Promise<Result<Warned, Error>> {
  const { userData } = actionContext.startup
  const downloaded = await downloadOrUpdateExercises(actionContext, exerciseIds, courseId)
  if (downloaded.err) {
    return downloaded
  }
  const refreshed = Result.all(
    await userData.clearFromNewExercises(courseId, downloaded.val.successful),
    await refreshLocalExercises(actionContext),
  )
  const { warnings } = downloaded.val
  if (refreshed.err) {
    warnings.push({ headline: "Failed to refresh local exercises.", error: refreshed.val })
  }
  return Ok({ warnings })
}
