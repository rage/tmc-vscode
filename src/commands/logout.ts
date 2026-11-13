import * as actions from "../actions"
import type { ReadyActionContext } from "../actions/types"
import { withOperation } from "../api/withOperation"
import { submissionViews } from "../ui/submissionViews"

/**
 * Logs out, without asking: logging in again is one click. The submissions shown close, and
 * the next login asks whether the exercises on disk belong to whoever logs in.
 */
export async function logout(actionContext: ReadyActionContext): Promise<void> {
  const { dialog } = actionContext
  const { accountHandover, workspaceManager } = actionContext.startup
  const result = await withOperation(dialog, { failure: "Failed to log out." }, () =>
    actions.logout(actionContext),
  )
  if (result.ok) {
    submissionViews.clear()
    if (workspaceManager.getExercises().length > 0) {
      await accountHandover.recordLogout()
    }
    dialog.statusMessage("Logged out.")
  }
}
