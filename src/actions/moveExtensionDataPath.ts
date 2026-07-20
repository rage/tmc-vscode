import * as path from "path"

import * as fs from "fs-extra"
import type { Result } from "ts-results"
import { Err } from "ts-results"
import type * as vscode from "vscode"

import { InitializationError } from "../errors"
import { Logger } from "../utilities"
import { refreshLocalExercises } from "./refreshLocalExercises"
import type { ActionContext } from "./types"

/**
 * Moves the physical location of all exercises on disk, then refreshes them.
 *
 * Exercises are no longer closed before the move: that step was removed
 * deliberately (commit d39605f) as unnecessary on current VS Code.
 *
 * @param newPath New disk location for exercises.
 */
export async function moveExtensionDataPath(
  actionContext: ActionContext,
  newPath: vscode.Uri,
  onUpdate?: (value: { percent: number; message?: string }) => void,
): Promise<Result<void, Error>> {
  const { resources, langs } = actionContext
  if (!(langs.ok && resources.ok)) {
    return new Err(new InitializationError("Extension was not initialized properly"))
  }
  Logger.info("Moving extension data path")

  // Use given path if empty dir, otherwise append
  let newFsPath = newPath.fsPath
  if (fs.readdirSync(newFsPath).length > 0) {
    newFsPath = path.join(newFsPath, "tmcdata")
  }

  const moveResult = await langs.val.moveProjectsDirectory(newFsPath, onUpdate)
  if (moveResult.err) {
    return moveResult
  }

  resources.val.projectsDirectory = newFsPath
  return refreshLocalExercises(actionContext)
}
