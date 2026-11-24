import * as fs from "fs-extra"
import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"

import { ProjectsRestoreConflictError } from "../errors"
import { isGoneFromReachableParent } from "../utilities"
import { releaseExerciseEditors } from "../window/exerciseDocuments"
import { refreshLocalExercises } from "./refreshLocalExercises"
import type { ReadyActionContext } from "./types"

/**
 * Moves every exercise on disk out of the exercises folder into a sibling folder, so whoever
 * is logged in now downloads their own and cannot submit another student's work as theirs.
 * Nothing is deleted; unsaved editor changes are saved first and the editors closed.
 *
 * @returns The folder the exercises are now in; `Err`, with the exercises left in place, when an
 *   editor could not be saved or stayed open, or an entry could not be moved.
 */
export async function moveExercisesAside(
  actionContext: ReadyActionContext,
  now: Date = new Date(),
): Promise<Result<string, Error>> {
  const { keptCopies, langs, resources } = actionContext.startup
  const projectsDirectory = resources.projectsDirectory
  if (!projectsDirectory) {
    return Err(new Error("The exercises folder is not known."))
  }
  const stamp = now
    .toISOString()
    .replaceAll(":", "-")
    .replace(/\.\d+Z$/, "")
  const target = `${projectsDirectory}-moved-${stamp}`
  const released = await releaseExerciseEditors(projectsDirectory)
  if (released.err) {
    return released
  }
  const setAside = await langs.setProjectsAside(target)
  if (setAside.err) {
    return setAside
  }
  // The fingerprints and paste links describe the moved files and the previous account.
  await keptCopies.clear()
  const refreshed = await refreshLocalExercises(actionContext)
  if (refreshed.err) {
    return refreshed
  }
  return Ok(target)
}

/**
 * Moves exercises moved aside by {@link moveExercisesAside} back into the exercises folder.
 *
 * @returns `false`, moving nothing, when the exercises folder is not empty: merging two sets of
 *   exercises would credit one account with the other's.
 */
export async function bringBackMovedExercises(
  actionContext: ReadyActionContext,
  folder: string,
): Promise<Result<boolean, Error>> {
  const { langs, resources } = actionContext.startup
  const projectsDirectory = resources.projectsDirectory
  if (!projectsDirectory) {
    return Err(new Error("The exercises folder is not known."))
  }
  // langs refuses an absent exercises folder as unreachable; one deleted by hand is just empty.
  if (await isGoneFromReachableParent(projectsDirectory)) {
    await fs.ensureDir(projectsDirectory)
  }
  const restored = await langs.restoreProjects(folder)
  if (restored.err) {
    return restored.val instanceof ProjectsRestoreConflictError ? Ok(false) : restored
  }
  const refreshed = await refreshLocalExercises(actionContext)
  return refreshed.err ? refreshed : Ok(true)
}
