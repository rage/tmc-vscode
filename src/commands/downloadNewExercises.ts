import { Ok } from "ts-results"

import { downloadNewExercisesForCourse } from "../actions"
import type { ReadyActionContext } from "../actions/types"
import { failure, withOperation } from "../api/withOperation"
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

  await withOperation(
    dialog,
    { failure: "Failed to download new exercises.", backend: courseId.kind },
    async () => {
      const courseResult = userData.getCourse(courseId)
      if (courseResult.err) {
        return failure("Failed to read the selected course.", courseResult.val)
      }
      const courseName = LocalCourseData.getCourseName(courseResult.val)
      if (LocalCourseData.getNewExercises(courseResult.val).length === 0) {
        void dialog.notification(`There are no new exercises for the course ${courseName}.`)
        return Ok.EMPTY
      }
      const downloadResult = await downloadNewExercisesForCourse(actionContext, courseId)
      return downloadResult.err
        ? failure(
            `Failed to download new exercises for course "${courseName}".`,
            downloadResult.val,
          )
        : downloadResult
    },
  )
}
