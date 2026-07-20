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
import { ExerciseMigrationError } from "../../errors"
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

// from v1, the directory for the exercises is managed by langs
export async function v1_migrateFromV0(
  exerciseData: data.v0.LocalExerciseData[],
  memento: vscode.Memento,
  dialog: Dialog,
  langs: Langs,
): Promise<void> {
  interface ExtensionSettingsPartial {
    dataPath: string
  }

  const dataPath = memento.get<ExtensionSettingsPartial>(data.v0.EXTENSION_SETTINGS_KEY)?.dataPath
  const closedExercises: Record<string, string[]> = {}

  const exercisesToMigrate: [data.v0.LocalExerciseData, string][] = []
  for (const exercise of exerciseData) {
    const { id, course, isOpen, name, path: exercisePath, organization, status } = exercise
    if (v0_exerciseIsClosed(status, isOpen)) {
      if (closedExercises[course]) {
        closedExercises[course].push(name)
      } else {
        closedExercises[course] = [name]
      }
    }

    const pathResult = v0_resolveExercisePath(
      id,
      name,
      course,
      organization,
      exercisePath,
      dataPath,
    )
    if (pathResult.err) {
      Logger.error(`Have to discard exercise ${course}/${name}:`, pathResult.val)
      continue
    }

    exercisesToMigrate.push([exercise, pathResult.val])
  }

  if (exercisesToMigrate.length === 0) {
    return
  }

  const message =
    "Migrating exercises on disk for extension version 2. Please do not close the editor..."
  const result = await dialog.progressNotification(message, async (progress) => {
    let atLeastOneSuccess = false
    let index = 0
    for (const [exercise, targetPath] of exercisesToMigrate) {
      const { checksum, course, id, name } = exercise
      const migrationResult = await langs.migrateExercise(course, checksum, id, targetPath, name)
      if (migrationResult.ok) {
        atLeastOneSuccess = true
      } else {
        Logger.error(`Migration failed for exercise ${course}/${name}:`, migrationResult.val)
      }

      progress.report({
        percent: ++index / exercisesToMigrate.length,
        message,
      })
    }

    return atLeastOneSuccess ? Ok.EMPTY : Err("Exercise migration failed.")
  })

  if (result.err) {
    throw new ExerciseMigrationError(result.val, "Exercise migration failed.")
  }

  for (const key of Object.keys(closedExercises)) {
    const closeExercisesResult = await langs.setSetting(
      data.v2.langsClosedExercisesKey(key),
      closedExercises[key],
    )
    if (closeExercisesResult.err) {
      Logger.error("Failed to migrate status of closed exercises.", closeExercisesResult.val)
    }
  }
}

export default async function migrateExerciseDataToLatest(
  memento: vscode.Memento,
  dialog: Dialog,
  tmc: Langs,
): Promise<MigratedData<undefined>> {
  const obsoleteKeys: string[] = []

  // v0 => v1
  const dataV0 = validateData(
    memento.get(data.v0.EXERCISE_DATA_KEY),
    z.array(data.v0.localExerciseDataSchema),
  )
  if (dataV0) {
    await v1_migrateFromV0(dataV0, memento, dialog, tmc)
    obsoleteKeys.push(data.v0.EXERCISE_DATA_KEY)
  }

  // to support the mooc backend, langs stores new courses in distinct tmc and mooc dirs
  // but it also supports the old way of storing courses so there's no need to do anything here
  // though we can still do the migration later if we want to just for consistency
  // await v3_migrateFromV1();

  return { data: undefined, obsoleteKeys }
}
