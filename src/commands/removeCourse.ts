import * as actions from "../actions"
import type { ReadyActionContext } from "../actions/types"
import { withOperation } from "../api/withOperation"
import type { CourseIdentifier } from "../shared/shared"
import { LocalCourseData } from "../shared/shared"
import { pickCourse } from "./pickCourse"

/**
 * Removes a course from the user's courses once they confirm; its downloaded exercises stay
 * on disk.
 *
 * @param courseId The course to remove; asks the user to pick one when omitted.
 */
export async function removeCourse(
  actionContext: ReadyActionContext,
  courseId?: CourseIdentifier,
): Promise<void> {
  const { dialog } = actionContext
  const { userData } = actionContext.startup
  const target =
    courseId ??
    (await pickCourse(actionContext, {
      title: "Remove Course",
      placeHolder: "Which course do you want to remove?",
    }))
  if (!target) {
    return
  }
  const course = userData.getCourse(target)
  if (course.err) {
    void dialog.reportError("Failed to remove the course.", course.val, target.kind)
    return
  }

  const title = LocalCourseData.getCourseTitle(course.val)
  const confirmed = await dialog.confirm(`Remove ${title} from your courses?`, {
    confirmLabel: "Remove Course",
    detail: "Your downloaded exercises stay on disk, and you can add the course again later.",
  })
  if (!confirmed) {
    return
  }

  const removed = await withOperation(
    dialog,
    { failure: "Failed to remove the course.", backend: target.kind },
    () => actions.removeCourse(actionContext, target),
  )
  if (removed.ok) {
    dialog.statusMessage(`Removed ${title}.`)
  }
}
