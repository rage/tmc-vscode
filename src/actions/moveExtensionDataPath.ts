import * as path from "path"

import * as fs from "fs-extra"
import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import type * as vscode from "vscode"

import type { FractionProgress } from "../api/dialog"
import { FileSystemError } from "../errors"
import { TmcPanel } from "../panels/TmcPanel"
import { Logger } from "../utilities"
import { refreshLocalExercises } from "./refreshLocalExercises"
import type { ReadyActionContext } from "./types"

/**
 * Moves the physical location of all exercises on disk, refreshes them, and
 * tells an open My Courses panel where they now are, whether or not the move
 * succeeded.
 *
 * @param newPath Folder the user chose. A non-empty one is not used as-is; the
 * exercises go into a `tmcdata` subfolder of it instead.
 * @returns The folder the exercises actually ended up in, which callers must
 * report rather than `newPath`.
 */
export async function moveExtensionDataPath(
  actionContext: ReadyActionContext,
  newPath: vscode.Uri,
  onUpdate?: (progress: FractionProgress) => void,
): Promise<Result<string, Error>> {
  const result = await moveProjectsDirectory(actionContext, newPath, onUpdate)
  const { projectsDirectory } = actionContext.startup.resources
  if (projectsDirectory) {
    TmcPanel.postMessage({
      type: "setTmcDataPath",
      tmcDataPath: projectsDirectory,
      target: { type: "MyCourses" },
    })
  }
  return result
}

async function moveProjectsDirectory(
  actionContext: ReadyActionContext,
  newPath: vscode.Uri,
  onUpdate?: (progress: FractionProgress) => void,
): Promise<Result<string, Error>> {
  const { langs, resources } = actionContext.startup
  Logger.info("Moving extension data path")

  let newFsPath = newPath.fsPath
  let existingEntries: string[]
  try {
    existingEntries = fs.readdirSync(newFsPath)
  } catch (e) {
    return new Err(new FileSystemError(e, `Failed to read the folder ${newFsPath}`))
  }
  if (existingEntries.length > 0) {
    newFsPath = path.join(newFsPath, "tmcdata")
  }

  const moveResult = await langs.moveProjectsDirectory(newFsPath, onUpdate)
  if (moveResult.err) {
    return moveResult
  }

  resources.projectsDirectory = newFsPath
  const refreshed = await refreshLocalExercises(actionContext)
  return refreshed.ok ? Ok(newFsPath) : refreshed
}
