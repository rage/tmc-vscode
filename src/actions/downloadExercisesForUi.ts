import { Result } from "ts-results"

import { postUpdateables } from "../panels/exerciseLists"
import { TmcPanel } from "../panels/TmcPanel"
import type { CourseIdentifier, ExerciseIdentifier } from "../shared/shared"
import { LocalCourseData } from "../shared/shared"
import { Logger } from "../utilities/"
import { downloadOrUpdateExercises } from "./downloadOrUpdateExercises"
import { refreshLocalExercises } from "./refreshLocalExercises"
import type { ActionContext } from "./types"

/**
 * Downloads exercises and pushes the resulting state back to the webview.
 *
 * `mode === "update"` drives the CourseDetails "update available" list; any other
 * mode drives the MyCourses "new exercises" list.
 */
export async function downloadExercisesForUi(
  actionContext: ActionContext,
  mode: string,
  courseId: CourseIdentifier,
  exerciseIds: ExerciseIdentifier[],
): Promise<void> {
  const { userData } = actionContext
  if (userData.err) {
    Logger.error("Extension was not initialized properly")
    return
  }

  if (mode === "update") {
    postUpdateables(courseId, [])
    const downloadResult = await downloadOrUpdateExercises(actionContext, exerciseIds, courseId)
    if (downloadResult.ok) {
      postUpdateables(courseId, downloadResult.val.failed)
    }
    return
  }

  TmcPanel.postMessage({
    type: "setNewExercises",
    target: {
      type: "MyCourses",
    },
    courseId: courseId,
    exerciseIds: [],
  })

  const downloadResult = await downloadOrUpdateExercises(actionContext, exerciseIds, courseId)
  if (downloadResult.err) {
    actionContext.dialog.errorNotification("Failed to download new exercises.", downloadResult.val)
    return
  }

  const refreshResult = Result.all(
    await userData.val.clearFromNewExercises(courseId, downloadResult.val.successful),
    await refreshLocalExercises(actionContext),
  )
  if (refreshResult.err) {
    actionContext.dialog.errorNotification("Failed to refresh local exercises.", refreshResult.val)
  }

  const course = userData.val.getCourse(courseId)
  if (course.err) {
    actionContext.dialog.errorNotification("Failed to read the course.", course.val)
    return
  }

  TmcPanel.postMessage({
    type: "setNewExercises",
    target: { type: "MyCourses" },
    courseId: courseId,
    exerciseIds: LocalCourseData.getNewExercises(course.val),
  })
  // Per-exercise status is already posted by `downloadOrUpdateExercises` keyed by
  // the correct identifier (exercise id for both backends), so there is no need to
  // re-post a blanket "closed" for every input id here — doing so used to paper
  // over the mooc task-id/exercise-id key mismatch and would also wrongly mark
  // failed downloads as closed.
}
