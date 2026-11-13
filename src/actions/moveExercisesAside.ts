import * as fs from "fs-extra"
import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"

import { FileSystemError } from "../errors"
import { refreshLocalExercises } from "./refreshLocalExercises"
import type { ReadyActionContext } from "./types"

/**
 * Moves every exercise on disk out of the exercises folder into a sibling folder, so whoever
 * is logged in now starts from the course templates and cannot submit another student's work
 * as their own. Nothing is deleted.
 *
 * @returns The folder the exercises are now in.
 */
export async function moveExercisesAside(
  actionContext: ReadyActionContext,
  now: Date = new Date(),
): Promise<Result<string, Error>> {
  const { keptCopies, resources } = actionContext.startup
  const projectsDirectory = resources.projectsDirectory
  if (!projectsDirectory) {
    return Err(new Error("The exercises folder is not known."))
  }
  const stamp = now
    .toISOString()
    .replaceAll(":", "-")
    .replace(/\.\d+Z$/, "")
  const target = `${projectsDirectory}-moved-${stamp}`
  try {
    await fs.move(projectsDirectory, target)
    await fs.ensureDir(projectsDirectory)
  } catch (e) {
    return Err(new FileSystemError(e, `Failed to move ${projectsDirectory} to ${target}.`))
  }
  // The fingerprints and paste links describe the moved files and the previous account.
  await keptCopies.clear()
  const refreshed = await refreshLocalExercises(actionContext)
  if (refreshed.err) {
    return refreshed
  }
  return Ok(target)
}
