import * as vscode from "vscode"

import type { ReadyActionContext } from "../actions/types"
import type { CourseIdentifier } from "../shared/shared"
import { LocalCourseData } from "../shared/shared"
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
    void actionContext.dialog.reportError(
      "Failed to open the course workspace.",
      course.val,
      courseId.kind,
    )
    return
  }
  await openWorkspace(actionContext, LocalCourseData.getCourseName(course.val), course.val.kind)
}

export async function switchWorkspace(actionContext: ReadyActionContext): Promise<void> {
  Logger.info("Switching workspace")

  // Workspace files are named `<slug>-<backend>`, so compare against the tagged name.
  const currentWorkspace = vscode.workspace.name?.split(" ")[0]
  const courseWorkspace = await pickCourse(actionContext, {
    title: "Switch Course Workspace",
    placeHolder: "Select a course workspace to open",
    value: (course: LocalCourseData) => course,
    decorate: (course: LocalCourseData, title: string) => {
      const taggedName = `${LocalCourseData.getCourseName(course)}-${course.kind}`
      return taggedName === currentWorkspace ? `${title} (Currently open)` : title
    },
  })
  if (courseWorkspace) {
    await openWorkspace(
      actionContext,
      LocalCourseData.getCourseName(courseWorkspace),
      courseWorkspace.kind,
    )
  }
}
