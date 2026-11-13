import * as path from "path"

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
 * Resets settings, logs out, clears stored user data and workspace files, and deletes the
 * exercises: what tmc-langs keeps in the projects directory, and the directory itself once
 * nothing else is left in it.
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
    for (const entry of await managedEntries(projectsDirectory)) {
      await fs.remove(path.join(projectsDirectory, entry))
    }
    if ((await readEntries(projectsDirectory))?.length === 0) {
      await fs.rmdir(projectsDirectory)
    }
  } catch (e) {
    return Err(new FileSystemError(e, "Failed to remove the exercises."))
  }
  report({ fraction: 1 })

  return Ok.EMPTY
}

/** The tmc-langs lock older versions kept in the projects directory. */
const LEGACY_LOCK_FILE = ".tmc.lock"

/** The file tmc-langs marks each course folder with. */
const COURSE_CONFIG_FILE = "course_config.toml"

/**
 * The entries of the projects directory tmc-langs owns: a folder per backend, and the course
 * folders older versions kept in the directory itself. Coupled to tmc-langs' `ProjectsConfig`.
 */
async function managedEntries(projectsDirectory: string): Promise<string[]> {
  const entries = (await readEntries(projectsDirectory)) ?? []
  const isManaged = async (entry: string): Promise<boolean> =>
    entry === "tmc" ||
    entry === "mooc" ||
    entry === LEGACY_LOCK_FILE ||
    (await fs.pathExists(path.join(projectsDirectory, entry, COURSE_CONFIG_FILE)))
  const managed: string[] = []
  for (const entry of entries) {
    if (await isManaged(entry)) {
      managed.push(entry)
    }
  }
  return managed
}

/** The directory's entries; `undefined` when it does not exist. */
async function readEntries(directory: string): Promise<string[] | undefined> {
  try {
    return await fs.readdir(directory)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined
    }
    throw e
  }
}
