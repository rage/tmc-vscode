import type { CourseIdentifier } from "../../shared/lib"
import { LocalCourseData } from "../../shared/lib"
import type { ReadyActionContext } from "../actions/types"
import { Logger } from "../utilities"
import { openWorkspace } from "./openWorkspace"
import { pickCourse } from "./pickCourse"

/**
 * Opens a course's workspace in this window.
 *
 * @param courseId The course whose workspace to open; asks the user to pick one when omitted.
 */
export async function openCourseWorkspace(
  actionContext: ReadyActionContext,
  courseId: CourseIdentifier | undefined,
): Promise<void> {
  if (!courseId) {
    return switchWorkspace(actionContext)
  }
  const course = actionContext.startup.userData.getCourse(courseId)
  if (course.err) {
    void actionContext.dialog.reportError("Failed to open the course workspace.", course.val)
    return
  }
  await openWorkspace(actionContext, course.val)
}

export async function switchWorkspace(actionContext: ReadyActionContext): Promise<void> {
  Logger.info("Switching workspace")

  const { workspaceManager } = actionContext.startup
  const courseId = await pickCourse(actionContext, {
    title: "Switch Course Workspace",
    placeHolder: "Select a course workspace to open",
    decorate: (course, title) =>
      course.kind === workspaceManager.activeCourseBackend &&
      LocalCourseData.getCourseName(course) === workspaceManager.activeCourse
        ? `${title} (Currently open)`
        : title,
  })
  if (courseId) {
    await openCourseWorkspace(actionContext, courseId)
  }
}
