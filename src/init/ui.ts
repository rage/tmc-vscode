import type { ActionContext } from "../actions/types"

/**
 * Fills the Courses view from the user's courses. A failed activation leaves it empty, and
 * package.json's `viewsWelcome` then offers the way out.
 */
export function fillCoursesView(actionContext: ActionContext): void {
  const { ui, startup } = actionContext
  if (startup.kind === "ready") {
    const { userData, workspaceManager } = startup
    ui.treeDP.setSource({
      getCourses: () => userData.getCourses(),
      onDidChangeCourses: userData.onDidChangeCourses,
      workspaceManager,
    })
  }
}
