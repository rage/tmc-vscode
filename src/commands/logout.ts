import * as actions from "../actions"
import type { ReadyActionContext } from "../actions/types"
import { withOperation } from "../api/withOperation"

export async function logout(actionContext: ReadyActionContext): Promise<void> {
  const { dialog } = actionContext
  if (await dialog.confirmation("Are you sure you want to log out?")) {
    const result = await withOperation(dialog, { failure: "Failed to log out." }, () =>
      actions.logout(actionContext),
    )
    if (result.ok) {
      dialog.notification("Logged out.")
    }
  }
}
