import * as fs from "fs-extra"
import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import type * as vscode from "vscode"

import { ensureCourseWorkspaceFile, ensureWorkspaceRootFile } from "../api/workspaceManager"
import Resources from "../config/resources"
import { CorruptStoredDataError, FileSystemError } from "../errors"
import type Storage from "../storage"
import { Logger } from "../utilities/logger"

/**
 * Creates the directories and workspace files the extension needs, and describes where
 * they live.
 *
 * Returns `Err` for every failure, including a filesystem the user cannot write to and
 * unreadable stored course data. Activation degrades on that `Err` instead of aborting,
 * so nothing here may throw.
 */
export async function resourceInitialization(
  extensionContext: vscode.ExtensionContext,
  storage: Storage,
  extensionVersion: string,
  tmcDataPath: string | undefined,
  workspaceFileFolder: string,
): Promise<Result<Resources, Error>> {
  try {
    const cssPath = extensionContext.asAbsolutePath("resources/styles")
    const htmlPath = extensionContext.asAbsolutePath("resources/templates")
    const mediaPath = extensionContext.asAbsolutePath("media")

    if (tmcDataPath) {
      const created = await fs.mkdir(tmcDataPath, { recursive: true })
      if (created !== undefined) {
        Logger.info(`Created tmc data directory at ${tmcDataPath}`)
      }
    } else {
      Logger.warn("Skipped tmc data directory check")
    }

    const resources = new Resources(
      cssPath,
      extensionVersion,
      htmlPath,
      mediaPath,
      workspaceFileFolder,
      tmcDataPath,
    )

    const userData = storage.getUserData()
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
    // Unreadable stored data already explains itself; anything else here is a rejected write.
    return new Err(
      e instanceof CorruptStoredDataError
        ? e
        : new FileSystemError(e, "Failed to create the extension's workspace files"),
    )
  }
}
