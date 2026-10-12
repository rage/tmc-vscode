import * as path from "path"

import * as fs from "fs-extra"
import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import type * as vscode from "vscode"

import type { FractionProgress } from "../api/dialog"
import { FileSystemError } from "../errors"
import { Logger } from "../utilities"
import { refreshLocalExercises } from "./refreshLocalExercises"
import type { ReadyActionContext } from "./types"

/** Where {@link moveExtensionDataPath} moved the exercises. */
export interface MovedExercisesFolder {
  /** The folder the exercises ended up in, which callers must report rather than the choice. */
  projectsDirectory: string
  /**
   * Why the exercises could not be listed in their new place, when they could not; the move
   * itself is done either way.
   */
  rescanError: Error | undefined
}

/**
 * Moves the physical location of all exercises on disk and refreshes them.
 *
 * @param newPath Folder the user chose. A non-empty one is not used as-is; the
 * exercises go into a `tmcdata` subfolder of it instead. Errs, moving nothing, for the
 * current exercises folder or a folder inside it.
 */
export async function moveExtensionDataPath(
  actionContext: ReadyActionContext,
  newPath: vscode.Uri,
  onUpdate?: (progress: FractionProgress) => void,
): Promise<Result<MovedExercisesFolder, Error>> {
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

  const current = resources.projectsDirectory
  if (current !== undefined) {
    const relative = path.relative(current, newFsPath)
    if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
      return Err(
        new Error(
          `The exercises folder cannot be moved into itself: ${newFsPath} is inside ${current}.`,
        ),
      )
    }
  }

  const moveResult = await langs.moveProjectsDirectory(newFsPath, onUpdate)
  if (moveResult.err) {
    return moveResult
  }

  resources.projectsDirectory = newFsPath
  const refreshed = await refreshLocalExercises(actionContext)
  if (refreshed.err) {
    Logger.error("Failed to list the exercises in their new folder", refreshed.val)
  }
  return Ok({
    projectsDirectory: newFsPath,
    rescanError: refreshed.err ? refreshed.val : undefined,
  })
}
