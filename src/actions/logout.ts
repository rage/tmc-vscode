import type { Result } from "ts-results"

import type { ReadyActionContext } from "./types"

/**
 * Logs the user out, removing every stored credential.
 *
 * A failed logout may have removed some of them, so the session is checked again
 * before the failure is returned.
 */
export async function logout(actionContext: ReadyActionContext): Promise<Result<void, Error>> {
  const result = await actionContext.startup.langs.deauthenticate()
  if (result.err) {
    await actionContext.authState.refresh()
  }
  return result
}
