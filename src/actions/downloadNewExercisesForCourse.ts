import { Ok, Result } from "ts-results"

import { withOptimisticList } from "../panels/exerciseLists"
import { TmcPanel } from "../panels/TmcPanel"
import type { CourseIdentifier, ExerciseIdentifier } from "../shared/shared"
import { LocalCourseData } from "../shared/shared"
import { Logger } from "../utilities"
import { downloadOrUpdateExercises } from "./downloadOrUpdateExercises"
import { refreshLocalExercises } from "./refreshLocalExercises"
import type { ReadyActionContext } from "./types"

/**
 * Downloads course's new exercises using relevate data from the context's UserData. Also handles
 * messages to UI and refreshing the results.
 *
 * @param courseId Course to update.
 */
export async function downloadNewExercisesForCourse(
  actionContext: ReadyActionContext,
  courseId: CourseIdentifier,
): Promise<Result<void, Error>> {
  const { userData } = actionContext.startup
  const courseResult = userData.getCourse(courseId)
  if (courseResult.err) {
    return courseResult
  }
  const course = courseResult.val
  Logger.info("Downloading new exercises for course")

  const postNewExercises = (exerciseIds: ExerciseIdentifier[]): void => {
    TmcPanel.postMessage({
      type: "setNewExercises",
      target: {
        type: "MyCourses",
      },
      courseId,
      exerciseIds,
    })
  }

  // Read the list back from storage rather than restoring the pre-download
  // snapshot, which re-announces the exercises the student just received.
  const postRemainingNewExercises = (): void => {
    const current = userData.getCourse(courseId)
    if (current.err) {
      Logger.error("Failed to read the course's new exercises.", current.val)
      return
    }
    postNewExercises(LocalCourseData.getNewExercises(current.val))
  }

  return await withOptimisticList(
    () => postNewExercises([]),
    async (): Promise<Result<void, Error>> => {
      const newExercises = LocalCourseData.getNewExercises(course)
      const downloadResult = await downloadOrUpdateExercises(actionContext, newExercises, courseId)
      if (downloadResult.err) {
        Logger.error("Failed to download new exercises.", downloadResult.val)
        return downloadResult
      }

      const refreshResult = Result.all(
        await userData.clearFromNewExercises(courseId, downloadResult.val.successful),
        await refreshLocalExercises(actionContext),
      )
      if (refreshResult.err) {
        Logger.error("Failed to refresh workspace.", refreshResult.val)
        return refreshResult
      }

      return Ok.EMPTY
    },
    postRemainingNewExercises,
  )
}
