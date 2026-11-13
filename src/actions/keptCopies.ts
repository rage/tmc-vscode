import { createHash } from "crypto"
import { promises as fs } from "fs"
import * as path from "path"

import type { KeptCopy } from "../api/keptCopies"
import type { WorkspaceExercise } from "../api/workspaceManager"
import { Logger } from "../utilities"
import type { ReadyActionContext } from "./types"

/** The exercise's student files, relative to it and sorted; `undefined` when unreadable. */
async function listStudentFiles(
  actionContext: ReadyActionContext,
  exercisePath: string,
): Promise<string[] | undefined> {
  const studentPaths = await actionContext.startup.langs.getStudentFilePaths(exercisePath)
  if (studentPaths.err) {
    Logger.warn("Could not read the student files", studentPaths.val)
    return undefined
  }
  return (await Promise.all(studentPaths.val.map((x) => filesUnder(path.resolve(exercisePath, x)))))
    .flat()
    .map((file) => path.relative(exercisePath, file))
    .toSorted()
}

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
    const files = await listStudentFiles(actionContext, exercisePath)
    if (files === undefined) {
      return undefined
    }
    const hash = createHash("sha256")
    for (const file of files) {
      hash.update(file).update("\0")
      hash.update(await fs.readFile(path.join(exercisePath, file))).update("\0")
    }
    return hash.digest("hex")
  } catch (e) {
    Logger.warn("Could not fingerprint the student files", e)
    return undefined
  }
}

/**
 * The student files the exercise had after its last download, reset or restore that are gone
 * now, relative to the exercise; empty when none are, or nothing was recorded. Never rejects.
 */
export async function findMissingStudentFiles(
  actionContext: ReadyActionContext,
  exercise: Pick<WorkspaceExercise, "id" | "uri">,
): Promise<string[]> {
  const given = actionContext.startup.keptCopies.files(exercise.id)
  if (!given || given.length === 0) {
    return []
  }
  try {
    const present = await listStudentFiles(actionContext, exercise.uri.fsPath)
    return present === undefined ? [] : given.filter((file) => !present.includes(file))
  } catch (e) {
    Logger.warn("Could not list the student files", e)
    return []
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
 * Fingerprints the exercise's student files and records them as the newest copy of kind `copy`,
 * and after a download, reset or restore which files there are, for
 * {@link findMissingStudentFiles}. Never rejects; files that cannot be read record nothing.
 */
export async function recordKeptCopy(
  actionContext: ReadyActionContext,
  exercise: Pick<WorkspaceExercise, "id" | "uri">,
  copy: KeptCopy,
): Promise<void> {
  const fingerprint = await fingerprintStudentFiles(actionContext, exercise)
  const { keptCopies } = actionContext.startup
  await keptCopies.record(exercise.id, copy, fingerprint)
  if (copy === "download" || copy === "reset" || copy === "restore") {
    const files = await listStudentFiles(actionContext, exercise.uri.fsPath).catch(() => undefined)
    if (files !== undefined) {
      await keptCopies.recordFiles(exercise.id, files)
    }
  }
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
