import * as path from "path"

import * as fs from "fs-extra"
import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import { FileSystemError } from "../errors"
import { Logger } from "../utilities"
import { closeExerciseEditors, saveExerciseDocuments } from "../window/exerciseDocuments"
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
  // An editor left open would write its file back into the emptied exercises folder on save.
  const folder = { uri: vscode.Uri.file(projectsDirectory) }
  const saved = await saveExerciseDocuments(folder)
  if (saved.err) {
    return saved
  }
  if (!(await closeExerciseEditors(folder))) {
    return Err(new Error("Some of the exercises' editors are still open."))
  }
  // Entry by entry, without graceful-fs's minute of silent retries, to name what is held.
  try {
    await fs.ensureDir(target)
    const moved: string[] = []
    for (const entry of await fs.readdir(projectsDirectory)) {
      try {
        await fs.promises.rename(path.join(projectsDirectory, entry), path.join(target, entry))
        moved.push(entry)
      } catch (e) {
        // Nothing records a partly moved folder, so a bring-back would never find these.
        await moveBack(moved, target, projectsDirectory)
        const code = (e as NodeJS.ErrnoException).code
        const isHeld = code === "EBUSY" || code === "EPERM" || code === "EACCES"
        return Err(
          new FileSystemError(
            e,
            isHeld
              ? `${entry} is in use, so the exercises could not all be moved to ${target}. ` +
                  "Close terminals, programs and other VS Code windows using it, then log in again."
              : `Failed to move ${entry} to ${target}.`,
          ),
        )
      }
    }
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

async function moveBack(entries: string[], from: string, to: string): Promise<void> {
  for (const entry of entries) {
    try {
      await fs.promises.rename(path.join(from, entry), path.join(to, entry))
    } catch (e) {
      Logger.warn(`Could not move ${entry} back from ${from}`, e)
    }
  }
  await fs.promises.rmdir(from).catch(() => undefined)
}

/** Names, in the exercises folder, the folder a bring-back is moving exercises from. */
const BRING_BACK_MARKER = ".tmc-bringing-back"

/** Files the OS puts in any folder, which do not make the exercises folder hold exercises. */
const OS_METADATA_FILES = new Set([".ds_store", "thumbs.db", "desktop.ini", BRING_BACK_MARKER])

/**
 * Moves exercises moved aside by {@link moveExercisesAside} back into the exercises folder.
 *
 * @returns `false`, moving nothing, when the exercises folder is not empty: merging two sets of
 *   exercises could overwrite one with the other.
 */
export async function bringBackMovedExercises(
  actionContext: ReadyActionContext,
  folder: string,
): Promise<Result<boolean, Error>> {
  const projectsDirectory = actionContext.startup.resources.projectsDirectory
  if (!projectsDirectory) {
    return Err(new Error("The exercises folder is not known."))
  }
  const marker = path.join(projectsDirectory, BRING_BACK_MARKER)
  try {
    const entries = (await fs.readdir(projectsDirectory).catch(() => [])).filter(
      (entry) => !OS_METADATA_FILES.has(entry.toLowerCase()),
    )
    const resumedFrom = await fs.readFile(marker, "utf-8").catch(() => undefined)
    // A bring-back cut short left the marker, and its own entries, behind.
    if (entries.length > 0 && resumedFrom !== folder) {
      return Ok(false)
    }
    // Fills the folder rather than replacing it: every tmc-langs call recreates a missing one.
    await fs.ensureDir(projectsDirectory)
    await fs.writeFile(marker, folder)
    for (const entry of await fs.readdir(folder)) {
      const destination = path.join(projectsDirectory, entry)
      if (await fs.pathExists(destination)) {
        continue
      }
      await fs.move(path.join(folder, entry), destination)
    }
    await fs.remove(marker)
    await fs.rmdir(folder)
  } catch (e) {
    return Err(new FileSystemError(e, `Failed to move ${folder} back to ${projectsDirectory}.`))
  }
  const refreshed = await refreshLocalExercises(actionContext)
  return refreshed.err ? refreshed : Ok(true)
}
