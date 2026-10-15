import { createHash } from "crypto"
import { promises as fs } from "fs"
import * as path from "path"

import { ExerciseIdentifier } from "../../shared/lib"
import type { WorkspaceExercise } from "../api/workspaceManager"
import { Logger } from "../utilities"
import type { ReadyActionContext } from "./types"

/** Per exercise key, the fingerprint of the student files the last submission sent. */
const submittedFingerprints = new Map<string, string>()

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

/** Remembers `fingerprint` as what the exercise's last submission sent. */
export function recordSubmittedFingerprint(
  exerciseId: ExerciseIdentifier,
  fingerprint: string | undefined,
): void {
  const key = ExerciseIdentifier.key(exerciseId)
  if (fingerprint === undefined) {
    submittedFingerprints.delete(key)
  } else {
    submittedFingerprints.set(key, fingerprint)
  }
}

/**
 * Whether the exercise's student files are what a submission made from this window last sent,
 * so submitting them again keeps no copy that is not already kept. `false` when unknown.
 */
export async function isUnchangedSinceSubmission(
  actionContext: ReadyActionContext,
  exercise: Pick<WorkspaceExercise, "id" | "uri">,
): Promise<boolean> {
  const submitted = submittedFingerprints.get(ExerciseIdentifier.key(exercise.id))
  return (
    submitted !== undefined &&
    submitted === (await fingerprintStudentFiles(actionContext, exercise))
  )
}
