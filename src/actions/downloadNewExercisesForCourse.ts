import { Err, Ok, Result } from "ts-results"

import { InitializationError } from "../errors"
import { TmcPanel } from "../panels/TmcPanel"
import type { CourseIdentifier, ExerciseIdentifier } from "../shared/shared"
import { LocalCourseData } from "../shared/shared"
import { Logger } from "../utilities"
import { downloadOrUpdateExercises } from "./downloadOrUpdateExercises"
import { refreshLocalExercises } from "./refreshLocalExercises"
import type { ActionContext } from "./types"

/**
 * Downloads course's new exercises using relevate data from the context's UserData. Also handles
 * messages to UI and refreshing the results.
 *
 * @param courseId Course to update.
 */
export async function downloadNewExercisesForCourse(
  actionContext: ActionContext,
  courseId: CourseIdentifier,
): Promise<Result<void, Error>> {
  const { userData } = actionContext
  if (userData.err) {
    return new Err(new InitializationError("Extension was not initialized properly"))
  }
  const course = userData.val.getCourse(courseId)
  Logger.info("Downloading new exercises for course")

  const postNewExercises = async (exerciseIds: ExerciseIdentifier[]): Promise<void> =>
    await TmcPanel.postMessage({
      type: "setNewExercises",
      target: {
        type: "MyCourses",
      },
      courseId,
      exerciseIds,
    })

  postNewExercises([])

  const newExercises = LocalCourseData.getNewExercises(course)
  const downloadResult = await downloadOrUpdateExercises(actionContext, newExercises, courseId)
  if (downloadResult.err) {
    Logger.error("Failed to download new exercises.", downloadResult.val)
    postNewExercises(newExercises)
    return downloadResult
  }

  const refreshResult = Result.all(
    await userData.val.clearFromNewExercises(courseId, downloadResult.val.successful),
    await refreshLocalExercises(actionContext),
  )
  if (refreshResult.err) {
    Logger.error("Failed to refresh workspace.", downloadResult.val)
    postNewExercises(newExercises)
    return refreshResult
  }

  postNewExercises(newExercises)

  return Ok.EMPTY
}
