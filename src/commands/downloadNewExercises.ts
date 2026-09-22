import * as actions from "../actions"
import type { ReadyActionContext } from "../actions/types"
import { LocalCourseData } from "../shared/shared"
import { Logger } from "../utilities"
import { pickCourse } from "./pickCourse"

export async function downloadNewExercises(actionContext: ReadyActionContext): Promise<void> {
  const { dialog } = actionContext
  const { userData } = actionContext.startup
  Logger.info("Downloading new exercises")

  const courseId = await pickCourse(actionContext, {
    title: "Download New Exercises",
    placeHolder: "Download new exercises for course?",
  })
  if (!courseId) {
    return
  }

  const courseResult = userData.getCourse(courseId)
  if (courseResult.err) {
    dialog.reportError("Failed to read the selected course.", courseResult.val, courseId.kind)
    return
  }
  const course = courseResult.val
  if (LocalCourseData.getNewExercises(course).length === 0) {
    dialog.notification(
      `There are no new exercises for the course ${LocalCourseData.getCourseName(course)}.`,
    )
    return
  }

  const downloadResult = await actions.downloadNewExercisesForCourse(actionContext, courseId)
  if (downloadResult.err) {
    dialog.reportError(
      `Failed to download new exercises for course "${LocalCourseData.getCourseName(course)}."`,
      downloadResult.val,
      courseId.kind,
    )
  }
}
