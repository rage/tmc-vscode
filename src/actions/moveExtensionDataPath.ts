import * as path from "path"

import * as fs from "fs-extra"
import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import type * as vscode from "vscode"

import { FileSystemError, InitializationError } from "../errors"
import { Logger } from "../utilities"
import { refreshLocalExercises } from "./refreshLocalExercises"
import type { ActionContext } from "./types"

/**
 * Moves the physical location of all exercises on disk, then refreshes them.
 *
 * @param newPath Folder the user chose. A non-empty one is not used as-is; the
 * exercises go into a `tmcdata` subfolder of it instead.
 * @returns The folder the exercises actually ended up in, which callers must
 * report rather than `newPath`.
 */
export async function moveExtensionDataPath(
  actionContext: ActionContext,
  newPath: vscode.Uri,
  onUpdate?: (value: { percent: number; message?: string }) => void,
): Promise<Result<string, Error>> {
  const { resources, langs } = actionContext
  if (!(langs.ok && resources.ok)) {
    return new Err(new InitializationError("Extension was not initialized properly"))
  }
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

  const moveResult = await langs.val.moveProjectsDirectory(newFsPath, onUpdate)
  if (moveResult.err) {
    return moveResult
  }

  resources.val.projectsDirectory = newFsPath
  const refreshed = await refreshLocalExercises(actionContext)
  return refreshed.ok ? Ok(newFsPath) : refreshed
}
