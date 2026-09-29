import * as actions from "../actions"
import type { ReadyActionContext } from "../actions/types"
import { withOperation } from "../api/withOperation"

export async function logout(actionContext: ReadyActionContext): Promise<void> {
  const { dialog } = actionContext
  const confirmed = await dialog.confirm("Log out of TestMyCode?", {
    confirmLabel: "Log Out",
    detail: "You need to log in again to download or submit exercises.",
  })
  if (confirmed) {
    const result = await withOperation(dialog, { failure: "Failed to log out." }, () =>
      actions.logout(actionContext),
    )
    if (result.ok) {
      dialog.notification("Logged out.")
    }
  }
}
