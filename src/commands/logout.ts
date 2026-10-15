import * as actions from "../actions"
import type { ReadyActionContext } from "../actions/types"
import { withOperation } from "../api/withOperation"

/** Logs out, without asking: logging in again is one click. */
export async function logout(actionContext: ReadyActionContext): Promise<void> {
  const { dialog } = actionContext
  const result = await withOperation(dialog, { failure: "Failed to log out." }, () =>
    actions.logout(actionContext),
  )
  if (result.ok) {
    dialog.statusMessage("Logged out.")
  }
}
