import * as vscode from "vscode"

import * as actions from "../actions"
import type { ActionContext } from "../actions/types"
import { LocalCourseData } from "../shared/shared"
import { Logger } from "../utilities"
import { pickCourse } from "./pickCourse"

export async function switchWorkspace(actionContext: ActionContext): Promise<void> {
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
    actions.openWorkspace(
      actionContext,
      LocalCourseData.getCourseName(courseWorkspace),
      courseWorkspace.kind,
    )
  }
}
