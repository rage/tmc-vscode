import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"

import { backendName } from "../shared/shared"
import type { ReadyActionContext } from "./types"

/**
 * Converts a thrown exception into an `Err` Result so a failure in one
 * backend's deauthenticate call can't skip the other in `logout`.
 */
async function safeDeauthenticate(
  deauthenticate: () => Promise<Result<void, Error>>,
): Promise<Result<void, Error>> {
  try {
    return await deauthenticate()
  } catch (e) {
    return Err(e instanceof Error ? e : new Error(String(e)))
  }
}

/**
 * Logs the user out of both backends, updating UI state.
 *
 * Both deauthenticate calls run unconditionally so a failure in one doesn't
 * skip the other; each failure gets its own notification, and the returned
 * `Result` reports whichever failed (tmc's, if both did).
 */
export async function logout(actionContext: ReadyActionContext): Promise<Result<void, Error>> {
  const { dialog } = actionContext
  const { langs } = actionContext.startup

  const result = await safeDeauthenticate(() => langs.deauthenticate())
  if (result.err) {
    dialog.reportError(`Failed to log out of ${backendName("tmc")}.`, result.val, "tmc")
  }
  const moocResult = await safeDeauthenticate(() => langs.deauthenticateMooc())
  if (moocResult.err) {
    dialog.reportError(`Failed to log out of ${backendName("mooc")}.`, moocResult.val, "mooc")
  }

  if (result.err) {
    return result
  }
  if (moocResult.err) {
    return moocResult
  }
  return Ok.EMPTY
}
