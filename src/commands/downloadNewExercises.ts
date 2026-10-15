import type { CourseIdentifier } from "../../shared/lib"
import { LocalCourseData } from "../../shared/lib"
import { downloadNewExercisesForCourse } from "../actions"
import type { ReadyActionContext } from "../actions/types"
import type { Warned } from "../api/withOperation"
import { withOperation } from "../api/withOperation"
import { Logger } from "../utilities"
import { downloadExercisesOfCourse } from "./downloadExercisesOfCourse"
import { pickCourse } from "./pickCourse"

/**
 * Downloads the exercises a course has gained since they were last downloaded; for a course
 * with none, the exercises not downloaded yet, so a course just added is not a dead end.
 *
 * @param target The course; asks the user to pick one when omitted.
 */
export async function downloadNewExercises(
  actionContext: ReadyActionContext,
  target?: CourseIdentifier,
): Promise<void> {
  const { dialog } = actionContext
  const { userData } = actionContext.startup
  Logger.info("Downloading new exercises")

  const courseId =
    target ??
    (await pickCourse(actionContext, {
      title: "Download New Exercises",
      placeHolder: "Which course's new exercises do you want to download?",
    }))
  if (!courseId) {
    return
  }
  const courseResult = userData.getCourse(courseId)
  if (courseResult.err) {
    void dialog.reportError("Failed to read the selected course.", courseResult.val)
    return
  }
  if (LocalCourseData.getNewExercises(courseResult.val).length === 0) {
    await downloadExercisesOfCourse(actionContext, courseId)
    return
  }
  const title = LocalCourseData.getCourseTitle(courseResult.val)
  await withOperation<Warned>(
    dialog,
    { failure: `Failed to download the new exercises of ${title}.` },
    () => downloadNewExercisesForCourse(actionContext, courseId),
  )
}
