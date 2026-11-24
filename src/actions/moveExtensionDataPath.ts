import * as path from "path"

import * as fs from "fs-extra"
import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import type * as vscode from "vscode"

import type { FractionProgress } from "../api/dialog"
import { langsError } from "../api/langsErrors"
import { FileSystemError, ProjectsDirMoveError, ProjectsDirMoveRefusedError } from "../errors"
import { isPathInside, isSamePath, Logger } from "../utilities"
import { releaseExerciseEditors } from "../window/exerciseDocuments"
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
    existingEntries = await fs.readdir(newFsPath)
  } catch (e) {
    return new Err(new FileSystemError(e, `Failed to read the folder ${newFsPath}`))
  }
  if (existingEntries.length > 0) {
    newFsPath = path.join(newFsPath, "tmcdata")
  }

  const current = resources.projectsDirectory
  // tmc-langs refuses this too, with links resolved, but only after the editors were closed.
  if (current !== undefined && isPathInside(current, newFsPath)) {
    return Err(
      langsError(
        {
          kind: isSamePath(current, newFsPath)
            ? "projects-dir-move-to-itself"
            : "projects-dir-move-into-itself",
        },
        `${newFsPath} is inside ${current}`,
        "",
        undefined,
      ),
    )
  }

  if (current !== undefined) {
    const released = await releaseExerciseEditors(current)
    if (released.err) {
      return released
    }
  }

  const moveResult = await langs.moveProjectsDirectory(newFsPath, onUpdate)
  if (moveResult.err && moveResult.val instanceof ProjectsDirMoveRefusedError) {
    return moveResult
  }
  if (moveResult.err) {
    // A move that stopped part way may have recorded either folder; show whichever it did.
    const settings = await langs.listSettings()
    if (settings.ok) {
      resources.projectsDirectory = settings.val.projects_dir
    }
    await refreshLocalExercises(actionContext)
    const where = resources.projectsDirectory ?? current
    return Err(
      new ProjectsDirMoveError(moveResult.val, where ? `Your exercises are now in ${where}.` : ""),
    )
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
