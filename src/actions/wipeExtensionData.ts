import * as fs from "fs-extra"
import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"

import type { FractionProgress } from "../api/dialog"
import { FileSystemError } from "../errors"
import type { ReadyActionContext } from "./types"

/**
 * Resets settings, logs out of both backends, clears stored user data and
 * workspace files, and removes the projects directory.
 *
 * The exercises are deleted last: every earlier step is recoverable, so a
 * failure there leaves the student's work on disk.
 */
export async function wipeExtensionData(
  actionContext: ReadyActionContext,
  projectsDirectory: string,
  onProgress?: (progress: FractionProgress) => void,
): Promise<Result<void, Error>> {
  const { langs, userData, workspaceManager } = actionContext.startup
  const report = onProgress ?? ((): void => {})

  const settingsReset = await langs.resetSettings()
  if (settingsReset.err) {
    return settingsReset
  }
  report({ fraction: 0.2 })

  // `deauthenticate` fires the logout events with `expected: true`, so the
  // session-expiry warning stays quiet and the auth context updates itself.
  const tmcLogout = await langs.deauthenticate()
  if (tmcLogout.err) {
    return tmcLogout
  }
  const moocLogout = await langs.deauthenticateMooc()
  if (moocLogout.err) {
    return moocLogout
  }
  report({ fraction: 0.4 })

  await userData.wipeDataFromStorage()
  report({ fraction: 0.6 })

  const workspaceFilesRemoved = await workspaceManager.deleteAllWorkspaceFiles()
  if (workspaceFilesRemoved.err) {
    return workspaceFilesRemoved
  }
  report({ fraction: 0.8 })

  try {
    fs.removeSync(projectsDirectory)
  } catch (e) {
    return Err(new FileSystemError(e, "Failed to remove projects directory."))
  }
  report({ fraction: 1 })

  return Ok.EMPTY
}
