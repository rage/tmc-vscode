import { Ok, Result } from "ts-results"

import type { Warned } from "../api/withOperation"
import { logWarnings } from "../api/withOperation"
import type { CourseIdentifier } from "../shared/shared"
import { LocalCourseData } from "../shared/shared"
import { Logger } from "../utilities"
import { downloadOrUpdateExercises } from "./downloadOrUpdateExercises"
import { refreshLocalExercises } from "./refreshLocalExercises"
import type { ReadyActionContext } from "./types"

/**
 * Downloads a course's new exercises and takes the downloaded ones off its new-exercise list.
 *
 * An exercise that fails to download is a warning and stays on the list; the `Err` is for
 * a course that is not stored or a list or rescan that could not be updated, and a
 * `BottleneckError` while some of the exercises are busy with another operation.
 */
export async function downloadNewExercisesForCourse(
  actionContext: ReadyActionContext,
  courseId: CourseIdentifier,
): Promise<Result<Warned, Error>> {
  const { userData } = actionContext.startup
  const courseResult = userData.getCourse(courseId)
  if (courseResult.err) {
    return courseResult
  }
  Logger.info("Downloading new exercises for course")

  const newExercises = LocalCourseData.getNewExercises(courseResult.val)
  const downloaded = await downloadOrUpdateExercises(actionContext, newExercises, courseId)
  if (downloaded.err) {
    return downloaded
  }
  const refreshResult = Result.all(
    await userData.clearFromNewExercises(courseId, downloaded.val.successful),
    await refreshLocalExercises(actionContext),
  )
  if (refreshResult.err) {
    logWarnings(downloaded.val.warnings)
    return refreshResult
  }
  return Ok({ warnings: downloaded.val.warnings })
}
