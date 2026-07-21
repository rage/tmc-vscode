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

const closedExercisesSettingSchema = z.array(z.string()).nullable()
const isClosedExercisesSetting = (object: unknown): object is string[] | null =>
  closedExercisesSettingSchema.safeParse(object).success

/**
 * One-time migration for two stores that keyed a course by a bare name/slug —
 * collision-prone once tmc and mooc courses can share a name — to per-backend
 * keys: the `closed-exercises-for:<name>` setting and the
 * `<name>.code-workspace` file. Legacy data predates mooc, so it migrates into
 * the tmc namespace. Idempotent: already-migrated keys/files are skipped.
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

  for (const name of courseNames) {
    await migrateClosedExercisesSetting(langs, name)
    migrateWorkspaceFile(workspaceFileFolder, name)
  }

  await memento.update(BACKEND_NAMESPACING_MIGRATION_DONE_KEY, true)
}

async function migrateClosedExercisesSetting(langs: Langs, name: string): Promise<void> {
  const legacyKey = legacyClosedExercisesSettingKey(name)
  const existing = await langs.getSetting(legacyKey, isClosedExercisesSetting)
  if (existing.err) {
    Logger.warn(`Could not read legacy closed-exercises setting for "${name}".`, existing.val)
    return
  }
  if (existing.val === undefined) {
    // Nothing stored under the legacy key (or already migrated).
    return
  }

  const setResult = await langs.setSetting(closedExercisesSettingKey("tmc", name), existing.val)
  if (setResult.err) {
    Logger.warn(`Failed to migrate closed-exercises setting for "${name}".`, setResult.val)
    return
  }
  const unsetResult = await langs.unsetSetting(legacyKey)
  if (unsetResult.err) {
    // Non-fatal: the namespaced key already holds the data; a stray legacy key is harmless.
    Logger.warn(`Migrated closed-exercises for "${name}" but failed to clear legacy key.`)
  }
}

function migrateWorkspaceFile(workspaceFileFolder: string, name: string): void {
  const legacyPath = path.join(workspaceFileFolder, legacyWorkspaceFileName(name))
  const newPath = path.join(workspaceFileFolder, workspaceFileName(name, "tmc"))
  if (!fs.existsSync(legacyPath)) {
    return
  }
  if (fs.existsSync(newPath)) {
    // Target already exists (e.g. a partial earlier run); don't clobber it.
    return
  }
  try {
    fs.moveSync(legacyPath, newPath)
    Logger.info(`Renamed legacy workspace file ${legacyPath} -> ${newPath}`)
  } catch (e) {
    Logger.warn(`Failed to rename legacy workspace file for "${name}".`, e)
  }
}
