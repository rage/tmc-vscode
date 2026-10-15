import type { CourseIdentifier } from "../../shared/lib"
import { LocalCourseData } from "../../shared/lib"
import { downloadCourseExercises } from "../actions"
import type { ReadyActionContext } from "../actions/types"
import { withOperation } from "../api/withOperation"
import { exercisesToDownload, onDiskByCourse } from "../ui/treeview/courseViewModel"
import { countOf } from "../utilities"
import { pickCourse } from "./pickCourse"

/**
 * Downloads a course's exercises that are not on disk yet and can still be submitted.
 *
 * @param target The course; asks the user to pick one when omitted.
 * @param scope See `exercisesToDownload`.
 */
export async function downloadExercisesOfCourse(
  actionContext: ReadyActionContext,
  target?: CourseIdentifier,
  scope: "all" | "startingParts" = "all",
): Promise<void> {
  const { dialog } = actionContext
  const { userData, workspaceManager } = actionContext.startup
  const courseId =
    target ??
    (await pickCourse(actionContext, {
      title: "Download All Exercises",
      placeHolder: "Which course's exercises do you want to download?",
    }))
  if (!courseId) {
    return
  }
  const course = userData.getCourse(courseId)
  if (course.err) {
    void dialog.reportError("Failed to download the course's exercises.", course.val)
    return
  }
  const title = LocalCourseData.getCourseTitle(course.val)
  const onDisk = onDiskByCourse(workspaceManager.getExercises())(course.val)
  const ids = exercisesToDownload(course.val, onDisk, new Date(), scope)
  if (ids.length === 0) {
    dialog.statusMessage(`Every exercise of ${title} is already downloaded.`)
    return
  }
  const downloaded = await withOperation(
    dialog,
    { failure: `Failed to download the exercises of ${title}.` },
    () => downloadCourseExercises(actionContext, courseId, ids),
  )
  if (downloaded.ok && downloaded.val.warnings.length === 0) {
    dialog.statusMessage(`Downloaded ${countOf(ids.length, "exercise")} of ${title}.`)
  }
}
