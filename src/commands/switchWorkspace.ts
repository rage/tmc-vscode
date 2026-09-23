import * as vscode from "vscode"

import type { ReadyActionContext } from "../actions/types"
import { LocalCourseData } from "../shared/shared"
import { Logger } from "../utilities"
import { openWorkspace } from "./openWorkspace"
import { pickCourse } from "./pickCourse"

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
    openWorkspace(
      actionContext,
      LocalCourseData.getCourseName(courseWorkspace),
      courseWorkspace.kind,
    )
  }
}
