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
 * Downloads a course's new exercises and takes the downloaded ones off its new-exercise list.
 *
 * An exercise that fails to download is warned about and stays on the list; the `Err` is for
 * a course that is not stored or a list or rescan that could not be updated.
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
      const { successful } = await downloadOrUpdateExercises(actionContext, newExercises, courseId)
      const refreshResult = Result.all(
        await userData.clearFromNewExercises(courseId, successful),
        await refreshLocalExercises(actionContext),
      )
      return refreshResult.err ? refreshResult : Ok.EMPTY
    },
    postRemainingNewExercises,
  )
}
