import * as fs from "fs-extra"
import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"

import type { FractionProgress } from "../api/dialog"
import { FileSystemError } from "../errors"
import { downloadFailures } from "../ui/downloadFailures"
import { failedUpdates } from "../ui/failedUpdates"
import { updateablesRegistry } from "../ui/updateablesRegistry"
import type { ReadyActionContext } from "./types"

/**
 * Resets settings, logs out, clears stored user data and
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

  // `deauthenticate` fires the logout event with `expected: true`, so the
  // session-expiry warning stays quiet and the auth context updates itself.
  const loggedOut = await langs.deauthenticate()
  if (loggedOut.err) {
    return loggedOut
  }
  report({ fraction: 0.4 })

  const storageWiped = await userData.wipeDataFromStorage()
  if (storageWiped.err) {
    return storageWiped
  }
  updateablesRegistry.clear()
  downloadFailures.clear()
  failedUpdates.clear()
  report({ fraction: 0.6 })

  const workspaceFilesRemoved = await workspaceManager.deleteAllWorkspaceFiles()
  if (workspaceFilesRemoved.err) {
    return workspaceFilesRemoved
  }
  report({ fraction: 0.8 })

  try {
    await fs.remove(projectsDirectory)
  } catch (e) {
    return Err(new FileSystemError(e, "Failed to remove projects directory."))
  }
  report({ fraction: 1 })

  return Ok.EMPTY
}
