import * as path from "path"

import * as fs from "fs-extra"
import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import type * as vscode from "vscode"

import {
  workspaceFileName,
  WORKSPACE_ROOT_FILE_TEXT,
  WORKSPACE_SETTINGS,
} from "../config/constants"
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
      if (!fs.existsSync(tmcDataPath)) {
        fs.mkdirSync(tmcDataPath, { recursive: true })
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

    // Verify that all course .code-workspaces are in-place on startup.
    fs.ensureDirSync(workspaceFileFolder)
    const userData = storage.getUserData()
    userData?.courses.forEach((course) => {
      const tmcWorkspaceFilePath = path.join(
        workspaceFileFolder,
        workspaceFileName(course.name, "tmc"),
      )
      if (!fs.existsSync(tmcWorkspaceFilePath)) {
        fs.writeFileSync(tmcWorkspaceFilePath, JSON.stringify(WORKSPACE_SETTINGS))
        Logger.info(`Created tmc workspace file at ${tmcWorkspaceFilePath}`)
      }
    })
    userData?.mooc_courses.forEach((course) => {
      const moocWorkspaceFilePath = path.join(
        workspaceFileFolder,
        workspaceFileName(course.name, "mooc"),
      )
      if (!fs.existsSync(moocWorkspaceFilePath)) {
        fs.writeFileSync(moocWorkspaceFilePath, JSON.stringify(WORKSPACE_SETTINGS))
        Logger.info(`Created mooc workspace file at ${moocWorkspaceFilePath}`)
      }
    })

    // Verify that .tmc folder and its contents exists
    fs.ensureDirSync(resources.workspaceRootFolder.fsPath)
    fs.writeFileSync(resources.workspaceRootFile.fsPath, WORKSPACE_ROOT_FILE_TEXT)

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
