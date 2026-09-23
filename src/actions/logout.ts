import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"

import { failure } from "../api/withOperation"
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
 * skip the other. The returned `Result` carries whichever failed (tmc's, if
 * both did) for `withOperation` to report; when both fail, the other one is
 * warned here instead of being lost.
 */
export async function logout(actionContext: ReadyActionContext): Promise<Result<void, Error>> {
  const { dialog } = actionContext
  const { langs } = actionContext.startup

  const result = await safeDeauthenticate(() => langs.deauthenticate())
  const moocResult = await safeDeauthenticate(() => langs.deauthenticateMooc())

  if (result.err) {
    if (moocResult.err) {
      dialog.reportError(`Failed to log out of ${backendName("mooc")}.`, moocResult.val, "mooc")
    }
    return failure(`Failed to log out of ${backendName("tmc")}.`, result.val, "tmc")
  }
  if (moocResult.err) {
    return failure(`Failed to log out of ${backendName("mooc")}.`, moocResult.val, "mooc")
  }
  return Ok.EMPTY
}
