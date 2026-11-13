import type { CourseIdentifier } from "../../shared/lib"
import { backendName, LocalCourseData } from "../../shared/lib"
import type { ReadyActionContext } from "../actions/types"
import { openWebLink } from "../utilities"
import { pickCourse } from "./pickCourse"

/**
 * Opens a courses.mooc.fi course's page, where the student enrolls on it.
 *
 * @param courseId The course; when omitted, the one courses.mooc.fi last refused the student on,
 * else one the student picks.
 */
export async function enrollOnCourse(
  actionContext: ReadyActionContext,
  courseId?: CourseIdentifier,
): Promise<void> {
  const { userData } = actionContext.startup
  const notEnrolled = userData
    .getCourses()
    .filter((course) => LocalCourseData.isNotEnrolled(course))
  const [only, ...others] = notEnrolled
  const target =
    courseId ??
    (only && others.length === 0
      ? LocalCourseData.getCourseId(only)
      : await pickCourse(actionContext, {
          title: "Enroll on a Course",
          placeHolder: `Pick the course to open on ${backendName("mooc")}`,
        }))
  if (!target) {
    return
  }
  const course = userData.getCourse(target)
  const url = course.ok ? LocalCourseData.getMaterialUrl(course.val) : undefined
  if (url === undefined) {
    await actionContext.dialog.notification(
      `Open the course on ${backendName("mooc")} to enroll on it.`,
    )
    return
  }
  await openWebLink(url)
}
