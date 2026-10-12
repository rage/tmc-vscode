import * as path from "path"

import * as fs from "fs-extra"
import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import type * as vscode from "vscode"
import { z } from "zod"

import type { MigratedData } from "."
import validateData from "."
import type Dialog from "../../api/dialog"
import type Langs from "../../api/langs"
import { closedExercisesSettingKey } from "../../config/constants"
import { Logger } from "../../utilities"
import * as data from "../data"

export function v0_exerciseIsClosed(
  exerciseStatus?: data.v0.ExerciseStatus,
  isOpen?: boolean,
): boolean {
  if (exerciseStatus === data.v0.ExerciseStatus.CLOSED) {
    return true
  } else if (isOpen === false) {
    return true
  }

  return false
}

export function v0_resolveExercisePath(
  id: number,
  name: string,
  course: string,
  organization: string,
  exercisePath?: string,
  dataPath?: string,
): Result<string, Error> {
  const workspacePath = dataPath && data.v0.exercisesDataPath(dataPath)
  const candidates = [
    exercisePath,
    workspacePath && path.join(workspacePath, organization, course, name),
    dataPath && data.v0.closedExerciseDataPath(dataPath, id.toString()),
  ]
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return Ok(candidate)
    }
    Logger.debug("Invalid candidate", candidate)
  }

  return Err(
    new Error(
      `Failed to resolve new exercise path for exercise ${name} with paths ${candidates.join(
        ", ",
      )}`,
    ),
  )
}

/**
 * Hands v0 exercises that are still on disk over to langs, which owns the exercise
 * directory from v1 on.
 *
 * Returns the exercises langs refused, each with `path` set to where its files were
 * found, so a retry needs nothing else from v0 storage. Exercises whose files are
 * already gone are dropped rather than returned: there is nothing left to point at.
 */
async function handOverToLangs(
  exercises: data.v0.LocalExerciseData[],
  dataPath: string | undefined,
  langs: Langs,
  onProgress?: (fraction: number) => void,
): Promise<data.v0.LocalExerciseData[]> {
  const refused: data.v0.LocalExerciseData[] = []
  let index = 0
  for (const exercise of exercises) {
    const { checksum, course, id, name, organization } = exercise
    const pathResult = v0_resolveExercisePath(
      id,
      name,
      course,
      organization,
      exercise.path,
      dataPath,
    )
    if (pathResult.err) {
      Logger.error(`Have to discard exercise ${course}/${name}:`, pathResult.val)
    } else {
      const migrationResult = await langs.migrateExercise(
        course,
        checksum,
        id,
        pathResult.val,
        name,
      )
      if (migrationResult.err) {
        Logger.error(`Migration failed for exercise ${course}/${name}:`, migrationResult.val)
        refused.push({ ...exercise, path: pathResult.val })
      }
    }
    onProgress?.(++index / exercises.length)
  }
  return refused
}

/** Records each course's closed v0 exercises under the setting the workspace manager reads. */
async function migrateClosedExercises(
  exercises: data.v0.LocalExerciseData[],
  langs: Langs,
): Promise<void> {
  const closedByCourse = new Map<string, string[]>()
  for (const { course, isOpen, name, status } of exercises) {
    if (v0_exerciseIsClosed(status, isOpen)) {
      closedByCourse.set(course, [...(closedByCourse.get(course) ?? []), name])
    }
  }
  for (const [course, closed] of closedByCourse) {
    const result = await langs.setSetting(closedExercisesSettingKey("tmc", course), closed)
    if (result.err) {
      Logger.error("Failed to migrate status of closed exercises.", result.val)
    }
  }
}

/**
 * Moves pre-2.0 exercises into langs' care.
 *
 * Exercises langs refuses are kept under {@link data.v3.PENDING_EXERCISE_MIGRATION_KEY}
 * and retried quietly on later activations; only the first attempt shows progress and
 * warns.
 */
export default async function migrateExerciseDataToLatest(
  memento: vscode.Memento,
  dialog: Dialog,
  langs: Langs,
): Promise<MigratedData<data.v0.LocalExerciseData[]>> {
  const exercisesSchema = z.array(data.v0.localExerciseDataSchema)
  const supersededKeys = [data.v0.EXERCISE_DATA_KEY, data.v3.PENDING_EXERCISE_MIGRATION_KEY]

  let refused: data.v0.LocalExerciseData[]
  const dataV0 = validateData(memento.get(data.v0.EXERCISE_DATA_KEY), exercisesSchema)
  if (dataV0) {
    const dataPath = memento.get<{ dataPath?: string }>(data.v0.EXTENSION_SETTINGS_KEY)?.dataPath
    await migrateClosedExercises(dataV0, langs)
    const message =
      "Migrating exercises on disk for extension version 2. Please do not close the editor…"
    refused = await dialog.progressNotification(message, (progress) =>
      handOverToLangs(dataV0, dataPath, langs, (fraction) =>
        progress.report({ fraction, message }),
      ),
    )
    if (refused.length > 0) {
      void dialog.warningNotification(
        `${refused.length} exercise(s) could not be migrated and were left where they are. ` +
          "The migration will try again the next time the extension starts.",
      )
    }
  } else {
    const pending = validateData(
      memento.get(data.v3.PENDING_EXERCISE_MIGRATION_KEY),
      exercisesSchema,
    )
    if (!pending) {
      return { data: undefined, supersededKeys: [], destinationKey: undefined }
    }
    refused = await handOverToLangs(pending, undefined, langs)
  }

  if (refused.length === 0) {
    return { data: undefined, supersededKeys, destinationKey: undefined }
  }
  Logger.error(
    "Exercises left unmigrated:",
    refused.map(({ course, name }) => `${course}/${name}`).join(", "),
  )
  return {
    data: refused,
    supersededKeys,
    destinationKey: data.v3.PENDING_EXERCISE_MIGRATION_KEY,
  }
}
