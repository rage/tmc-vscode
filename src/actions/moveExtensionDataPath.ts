import * as path from "path"

import * as fs from "fs-extra"
import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import type { FractionProgress } from "../api/dialog"
import { FileSystemError } from "../errors"
import { isPathInside, Logger } from "../utilities"
import { closeExerciseEditors, saveExerciseDocuments } from "../window/exerciseDocuments"
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
  // Real paths, so a junction, symlink or subst drive spelling the same folder is caught too.
  const realNew = path.join(
    await realPath(newPath.fsPath),
    path.relative(newPath.fsPath, newFsPath),
  )
  if (
    current !== undefined &&
    (isPathInside(current, newFsPath) || isPathInside(await realPath(current), realNew))
  ) {
    return Err(
      new Error(
        `The exercises folder cannot be moved into itself: ${newFsPath} is inside ${current}.`,
      ),
    )
  }

  // An editor left open would save into the old folder once its files have moved.
  if (current !== undefined) {
    const folder = { uri: vscode.Uri.file(current) }
    const saved = await saveExerciseDocuments(folder)
    if (saved.err) {
      return saved
    }
    if (!(await closeExerciseEditors(folder))) {
      return Err(new Error("Close the exercises' editors before moving the exercises folder."))
    }
  }

  const moveResult = await langs.moveProjectsDirectory(newFsPath, onUpdate)
  if (moveResult.err) {
    // A move that stopped part way may have recorded either folder; show whichever it did.
    const settings = await langs.listSettings()
    if (settings.ok) {
      resources.projectsDirectory = settings.val.projects_dir
    }
    await refreshLocalExercises(actionContext)
    const where = resources.projectsDirectory ?? current
    return Err(
      Object.assign(moveResult.val, {
        message:
          `${moveResult.val.message.replace(/\.?$/, ".")} Close terminals and programs that use ` +
          `the exercises, then try again.${where ? ` Your exercises are now in ${where}.` : ""}`,
      }),
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

/** `folder` with its links resolved, or as given when it cannot be resolved. */
async function realPath(folder: string): Promise<string> {
  try {
    return await fs.promises.realpath(folder)
  } catch {
    return folder
  }
}
