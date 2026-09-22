import * as actions from "../actions"
import type { ActionContext } from "../actions/types"

export async function logout(actionContext: ActionContext): Promise<void> {
  const { dialog } = actionContext
  if (await dialog.confirmation("Are you sure you want to log out?")) {
    // The action layer reports failures itself; only announce success here.
    const deauth = await actions.logout(actionContext)
    if (deauth.ok) {
      dialog.notification("Logged out.")
    }
  }
}
