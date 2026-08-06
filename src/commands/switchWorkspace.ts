import * as vscode from "vscode"

import * as actions from "../actions"
import type { ActionContext } from "../actions/types"
import { backendName, LocalCourseData } from "../shared/shared"
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
    ...courses.map<[string, LocalCourseData, string]>((c) => {
      const name = LocalCourseData.getCourseName(c)
      const taggedName = `${name}-${c.kind}`
      const open = taggedName === currentWorkspace
      return [open ? `${name} (Currently open)` : name, c, backendName(c.kind)]
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
