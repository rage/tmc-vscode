import * as path from "path"

import * as fs from "fs-extra"
import type * as vscode from "vscode"
import { z } from "zod"

import type Langs from "../../api/langs"
import {
  closedExercisesSettingKey,
  legacyClosedExercisesSettingKey,
  legacyWorkspaceFileName,
  workspaceFileName,
} from "../../config/constants"
import { Logger } from "../../utilities"
import type * as data from "../data"

/** Marks the one-time backend-namespacing migration as done; avoids a `settings get` CLI call per course on every startup. */
export const BACKEND_NAMESPACING_MIGRATION_DONE_KEY = "migration:backend-namespacing-done-v1"

/** Courses already fully namespaced, so a run that follows a failed one only retries what is left. */
export const BACKEND_NAMESPACING_MIGRATED_COURSES_KEY = "migration:backend-namespacing-courses-v1"

const closedExercisesSettingSchema = z.array(z.string()).nullable()
const isClosedExercisesSetting = (object: unknown): object is string[] | null =>
  closedExercisesSettingSchema.safeParse(object).success

/**
 * One-time migration for two stores that keyed a course by a bare name/slug —
 * collision-prone once tmc and mooc courses can share a name — to per-backend
 * keys: the `closed-exercises-for:<name>` setting and the
 * `<name>.code-workspace` file. Legacy data predates mooc, so it migrates into
 * the tmc namespace. Idempotent: already-migrated keys/files are skipped.
 *
 * Marks itself done only once every course is through, so a run that the CLI or
 * the filesystem defeated is retried instead of leaving a half-namespaced store
 * behind for good.
 */
export default async function migrateBackendNamespacing(
  memento: vscode.Memento,
  langs: Langs,
  workspaceFileFolder: string,
  userData: data.UserData | undefined,
): Promise<void> {
  if (memento.get<boolean>(BACKEND_NAMESPACING_MIGRATION_DONE_KEY)) {
    return
  }

  // Legacy state was tmc-only regardless of a same-named course's current backend,
  // so every known slug migrates to the tmc namespace.
  const courseNames = new Set<string>()
  userData?.courses.forEach((c) => courseNames.add(c.name))
  userData?.mooc_courses.forEach((c) => courseNames.add(c.name))

  const alreadyMigrated = migratedCourseNames(memento)
  const migrated = new Set(alreadyMigrated)
  let everyCourseMigrated = true
  for (const name of courseNames) {
    if (migrated.has(name)) {
      continue
    }
    const settingMigrated = await migrateClosedExercisesSetting(langs, name)
    const workspaceFileMigrated = migrateWorkspaceFile(workspaceFileFolder, name)
    if (settingMigrated && workspaceFileMigrated) {
      migrated.add(name)
    } else {
      everyCourseMigrated = false
    }
  }

  if (!everyCourseMigrated) {
    await memento.update(BACKEND_NAMESPACING_MIGRATED_COURSES_KEY, [...migrated])
    return
  }

  if (alreadyMigrated.length > 0) {
    await memento.update(BACKEND_NAMESPACING_MIGRATED_COURSES_KEY, undefined)
  }
  await memento.update(BACKEND_NAMESPACING_MIGRATION_DONE_KEY, true)
}

function migratedCourseNames(memento: vscode.Memento): string[] {
  return (
    z.array(z.string()).safeParse(memento.get(BACKEND_NAMESPACING_MIGRATED_COURSES_KEY)).data ?? []
  )
}

async function migrateClosedExercisesSetting(langs: Langs, name: string): Promise<boolean> {
  const legacyKey = legacyClosedExercisesSettingKey(name)
  const existing = await langs.getSetting(legacyKey, isClosedExercisesSetting)
  if (existing.err) {
    Logger.warn(`Could not read legacy closed-exercises setting for "${name}".`, existing.val)
    return false
  }
  if (existing.val === undefined) {
    // Nothing stored under the legacy key (or already migrated).
    return true
  }

  const setResult = await langs.setSetting(closedExercisesSettingKey("tmc", name), existing.val)
  if (setResult.err) {
    Logger.warn(`Failed to migrate closed-exercises setting for "${name}".`, setResult.val)
    return false
  }
  const unsetResult = await langs.unsetSetting(legacyKey)
  if (unsetResult.err) {
    // Non-fatal: the namespaced key already holds the data; a stray legacy key is harmless.
    Logger.warn(`Migrated closed-exercises for "${name}" but failed to clear legacy key.`)
  }
  return true
}

function migrateWorkspaceFile(workspaceFileFolder: string, name: string): boolean {
  const legacyPath = path.join(workspaceFileFolder, legacyWorkspaceFileName(name))
  const newPath = path.join(workspaceFileFolder, workspaceFileName(name, "tmc"))
  if (!fs.existsSync(legacyPath)) {
    return true
  }
  if (fs.existsSync(newPath)) {
    // Target already exists (e.g. a partial earlier run); don't clobber it.
    return true
  }
  try {
    fs.moveSync(legacyPath, newPath)
    Logger.info(`Renamed legacy workspace file ${legacyPath} -> ${newPath}`)
    return true
  } catch (e) {
    Logger.warn(`Failed to rename legacy workspace file for "${name}".`, e)
    return false
  }
}
