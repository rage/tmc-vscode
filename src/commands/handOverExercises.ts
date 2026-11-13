import { moveExercisesAside } from "../actions"
import type { ReadyActionContext } from "../actions/types"
import { withOperation } from "../api/withOperation"

/**
 * After a login that follows a logout, asks whether the exercises on disk belong to whoever
 * logged in, and moves them aside if not. A student who never logged out is not asked.
 */
export async function handOverExercises(actionContext: ReadyActionContext): Promise<void> {
  const { dialog } = actionContext
  const { accountHandover, resources, workspaceManager } = actionContext.startup
  if (!(await accountHandover.takeLogout()) || workspaceManager.getExercises().length === 0) {
    return
  }
  const isMovedAside = await dialog.choose(
    "Are the exercises on this computer yours?",
    {
      detail:
        "Someone logged out of courses.mooc.fi here earlier. If you are not that student, move " +
        `their exercises out of ${resources.projectsDirectory ?? "the exercises folder"}, so ` +
        "you don't see or submit their work as your own. Nothing is deleted.",
    },
    ["Move Them Aside", true],
    ["They Are Mine", false],
  )
  if (!isMovedAside) {
    return
  }
  const moved = await withOperation(
    dialog,
    { failure: "Failed to move the exercises aside." },
    () => moveExercisesAside(actionContext),
  )
  if (moved.ok) {
    void dialog.notification(`Moved the previous student's exercises to ${moved.val}.`)
  }
}
