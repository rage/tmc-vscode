import * as vscode from "vscode"

import { LocalCourseData } from "../../shared/lib"
import type { ReadyActionContext } from "../actions/types"
import type { CourseWorkspaceKey } from "../api/workspaceManager"
import { Logger } from "../utilities"

/**
 * Tells the student that exercises they just opened show only in their course's workspace,
 * which this window does not show, and offers to open it. Asks once for as long as the
 * notification for that course is up.
 */
export function createCourseWorkspaceOffer(
  actionContext: ReadyActionContext,
): (course: CourseWorkspaceKey) => void {
  const shown = new Set<string>()
  return ({ backend, courseSlug }) => {
    const course = actionContext.startup.userData
      .getCourses()
      .find((x) => x.kind === backend && LocalCourseData.getCourseName(x) === courseSlug)
    const key = `${backend}:${courseSlug}`
    if (!course || shown.has(key)) {
      return
    }
    shown.add(key)
    Logger.info(`Exercises of ${courseSlug} opened outside its course workspace`)
    const courseId = LocalCourseData.getCourseId(course)
    void actionContext.dialog
      .notification(
        `The exercises of ${LocalCourseData.getCourseTitle(course)} open in its course workspace.`,
        [
          "Open Course Workspace",
          (): void => void vscode.commands.executeCommand("tmc.openCourseWorkspace", courseId),
        ],
      )
      .finally(() => shown.delete(key))
  }
}
