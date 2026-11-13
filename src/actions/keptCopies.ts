import { createHash } from "crypto"
import { promises as fs } from "fs"
import * as path from "path"

import type { KeptCopy } from "../api/keptCopies"
import type { WorkspaceExercise } from "../api/workspaceManager"
import { Logger } from "../utilities"
import type { ReadyActionContext } from "./types"

/**
 * A digest of the exercise's student files, paths and contents, or `undefined` when they
 * cannot be read. Never rejects.
 */
export async function fingerprintStudentFiles(
  actionContext: ReadyActionContext,
  exercise: Pick<WorkspaceExercise, "uri">,
): Promise<string | undefined> {
  const exercisePath = exercise.uri.fsPath
  try {
    const studentPaths = await actionContext.startup.langs.getStudentFilePaths(exercisePath)
    if (studentPaths.err) {
      Logger.warn("Could not read the student files to fingerprint", studentPaths.val)
      return undefined
    }
    const files = (
      await Promise.all(studentPaths.val.map((x) => filesUnder(path.resolve(exercisePath, x))))
    )
      .flat()
      .toSorted()
    const hash = createHash("sha256")
    for (const file of files) {
      hash.update(path.relative(exercisePath, file)).update("\0")
      hash.update(await fs.readFile(file)).update("\0")
    }
    return hash.digest("hex")
  } catch (e) {
    Logger.warn("Could not fingerprint the student files", e)
    return undefined
  }
}

async function filesUnder(entry: string): Promise<string[]> {
  const stat = await fs.stat(entry).catch(() => undefined)
  if (stat?.isFile()) {
    return [entry]
  }
  if (!stat?.isDirectory()) {
    return []
  }
  const children = (await fs.readdir(entry)).filter(
    (child) => !child.startsWith(".") && child !== "__pycache__",
  )
  return (await Promise.all(children.map((child) => filesUnder(path.join(entry, child))))).flat()
}

/**
 * Fingerprints the exercise's student files and records them as the newest copy of kind `copy`.
 * Never rejects; files that cannot be read record nothing.
 */
export async function recordKeptCopy(
  actionContext: ReadyActionContext,
  exercise: Pick<WorkspaceExercise, "id" | "uri">,
  copy: KeptCopy,
): Promise<void> {
  const fingerprint = await fingerprintStudentFiles(actionContext, exercise)
  await actionContext.startup.keptCopies.record(exercise.id, copy, fingerprint)
}

/**
 * Where a copy of the exercise's current student files already exists, so keeping them again
 * would add nothing; `undefined` when none is known or the files cannot be read.
 */
export async function findKeptCopy(
  actionContext: ReadyActionContext,
  exercise: Pick<WorkspaceExercise, "id" | "uri">,
): Promise<KeptCopy | undefined> {
  return actionContext.startup.keptCopies.copyOf(
    exercise.id,
    await fingerprintStudentFiles(actionContext, exercise),
  )
}
