import * as vscode from "vscode"

import * as actions from "../actions"
import type { ActionContext } from "../actions/types"
import { LocalCourseData } from "../shared/shared"
import { Logger } from "../utilities"

export async function switchWorkspace(actionContext: ActionContext): Promise<void> {
  const { dialog, userData } = actionContext
  Logger.info("Switching workspace")
  if (userData.err) {
    Logger.error("Extension was not initialized properly")
    return
  }

  const courses = userData.val.getCourses()
  // Workspace files are named `<slug>-<backend>`, so compare against the tagged name.
  const currentWorkspace = vscode.workspace.name?.split(" ")[0]
  const courseWorkspace = await dialog.selectItem(
    { title: "Switch Course Workspace", placeHolder: "Select a course workspace to open" },
    ...courses.map<[string, LocalCourseData]>((c) => {
      const name = LocalCourseData.getCourseName(c)
      const taggedName = `${name}-${c.kind}`
      return [taggedName === currentWorkspace ? `${name} (Currently open)` : name, c]
    }),
  )
  if (courseWorkspace) {
    actions.openWorkspace(
      actionContext,
      LocalCourseData.getCourseName(courseWorkspace),
      courseWorkspace.kind,
    )
  }
}
