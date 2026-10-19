import * as fs from "fs-extra"
import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"

import { ensureCourseWorkspaceFile, ensureWorkspaceRootFile } from "../api/workspaceManager"
import Resources from "../config/resources"
import { CorruptStoredDataError, FileSystemError } from "../errors"
import type Storage from "../storage"
import { unpinExtensionSettings } from "../storage/migration/courseWorkspaceFiles"
import { Logger } from "../utilities/logger"

/**
 * Creates the directories and workspace files the extension needs, and describes where
 * they live.
 *
 * Returns `Err` for every failure, such as a filesystem the user cannot write to.
 * Activation degrades on that `Err` instead of aborting, so nothing here may throw.
 * Unreadable stored courses are not a failure here: `UserData` reports them, and only
 * what needs the courses degrades.
 */
export async function resourceInitialization(
  storage: Storage,
  tmcDataPath: string | undefined,
  workspaceFileFolder: string,
): Promise<Result<Resources, Error>> {
  try {
    if (tmcDataPath) {
      const created = await fs.mkdir(tmcDataPath, { recursive: true })
      if (created !== undefined) {
        Logger.info(`Created tmc data directory at ${tmcDataPath}`)
      }
    } else {
      Logger.warn("Skipped tmc data directory check")
    }

    const resources = new Resources(workspaceFileFolder, tmcDataPath)
    await unpinExtensionSettings(workspaceFileFolder)

    const userData = readableUserData(storage)
    const storedCourses = [
      ["tmc", userData?.courses ?? []],
      ["mooc", userData?.mooc_courses ?? []],
    ] as const

    // A course whose workspace file went missing is unopenable, so every stored
    // course gets one back on startup.
    await Promise.all([
      ensureWorkspaceRootFile(workspaceFileFolder),
      ...storedCourses.flatMap(([backend, courses]) =>
        courses.map((course) =>
          ensureCourseWorkspaceFile(resources.getWorkspaceFilePath(course.name, backend)),
        ),
      ),
    ])

    return new Ok(resources)
  } catch (e) {
    return new Err(new FileSystemError(e, "Failed to create the extension's workspace files"))
  }
}

/** The stored courses, or `undefined` when unreadable: reading them is `UserData`'s failure to report. */
function readableUserData(storage: Storage): ReturnType<Storage["getUserData"]> {
  try {
    return storage.getUserData()
  } catch (e) {
    if (e instanceof CorruptStoredDataError) {
      Logger.warn("Skipped restoring course workspace files: stored courses are unreadable.")
      return undefined
    }
    throw e
  }
}
