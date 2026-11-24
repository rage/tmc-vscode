import * as path from "path"

import { last } from "lodash"
import * as vscode from "vscode"
import { z } from "zod"

import type Dialog from "../api/dialog"
import type Langs from "../api/langs"
import { EXTENSION_VERSION } from "../config/constants"
import { CorruptStoredDataError, StoredDataMigrationError } from "../errors"
import { Logger } from "../utilities"
import * as storage from "./data"
import { v0 } from "./data"
import type { MigratedData } from "./migration"
import { obsoleteKeys } from "./migration"
import migrateExerciseDataToLatest from "./migration/exerciseData"
import migrateExtensionSettingsToLatest from "./migration/extensionSettings"
import {
  appendMigrationRun,
  backUpLegacyData,
  formatMigrationLog,
  keepUnreadableLegacyValues,
  lastSeenVersion,
  readMigrationLog,
  RecordingMemento,
} from "./migration/log"
import migrateSessionState from "./migration/sessionState"
import type { UserDataMigration } from "./migration/userData"
import migrateUserDataToLatest, { syncLegacyMirror } from "./migration/userData"

/** The only access to VS Code's storage; nothing else reads or writes mementos or settings. */
export default class Storage {
  private readonly _memento: vscode.Memento
  // Unset by a write that may have failed half-way, so the next one resyncs the mirror.
  private _isLegacyMirrorSynced = false
  /** A read found courses this version cannot parse, which writes must keep. */
  private _hasUnreadableCourses = false

  /** @param memento The extension's `globalState`, behind its `SerializedMemento`. */
  public constructor(memento: vscode.Memento) {
    this._memento = memento
  }

  /**
   * The stored courses this version can read. A course it cannot, such as one a newer version
   * wrote, is left out here and kept as stored by {@link updateUserData}.
   *
   * @throws {CorruptStoredDataError} if the value is not a course list at all.
   */
  public getUserData(): storage.UserData | undefined {
    const stored = this._memento.get<unknown>(storage.USER_DATA_KEY)
    if (stored === undefined) {
      return undefined
    }
    const lists = storedCourseLists(stored)
    if (!lists) {
      return this._readValidated(storage.USER_DATA_KEY, storage.userDataSchema)
    }
    const readable = {
      courses: lists.courses.filter((course) =>
        isReadable(course, storage.tmcLocalCourseDataSchema),
      ),
      mooc_courses: lists.mooc_courses.filter((course) =>
        isReadable(course, storage.moocLocalCourseDataSchema),
      ),
    }
    const skipped =
      lists.courses.length +
      lists.mooc_courses.length -
      readable.courses.length -
      readable.mooc_courses.length
    if (skipped > 0) {
      this._hasUnreadableCourses = true
      Logger.error(`${skipped} stored courses could not be read; they are kept as they are.`)
    }
    // The stored value's other keys too: a newer version may have added some.
    return { ...(stored as object), ...readable } as storage.UserData
  }

  /** Whether any course may be stored, readable by this version or not. */
  public hasStoredCourses(): boolean {
    const stored = this._memento.get<unknown>(storage.USER_DATA_KEY)
    if (stored === undefined) {
      return false
    }
    const lists = storedCourseLists(stored)
    return lists === undefined || lists.courses.length + lists.mooc_courses.length > 0
  }

  /** @throws {CorruptStoredDataError} if the stored value does not match the current schema. */
  public getSessionState(): storage.SessionState | undefined {
    return this._readValidated(storage.SESSION_STATE_KEY, storage.sessionStateSchema)
  }

  /**
   * Also mirrors the tmc courses to `user-data-v1`, which a downgrade to 3.x reads.
   *
   * @param isMoocOnlyChange The change since the last write touched only mooc courses, so the
   * mirror needs no work.
   */
  public async updateUserData(
    written: storage.UserData | undefined,
    { isMoocOnlyChange = false }: { isMoocOnlyChange?: boolean } = {},
  ): Promise<void> {
    const memento = this._memento
    const userData =
      written && this._hasUnreadableCourses
        ? withUnreadableCourses(written, memento.get<unknown>(storage.USER_DATA_KEY))
        : written
    if (isMoocOnlyChange && this._isLegacyMirrorSynced) {
      await memento.update(storage.USER_DATA_KEY, userData)
      return
    }
    this._isLegacyMirrorSynced = false
    await writeUserData(memento, userData)
    this._isLegacyMirrorSynced = true
  }

  /** The recorded migration runs as text, for logs and error details. */
  public getMigrationLog(): string {
    return formatMigrationLog(readMigrationLog(this._memento))
  }

  public async updateSessionState(sessionState: storage.SessionState | undefined): Promise<void> {
    await this._memento.update(storage.SESSION_STATE_KEY, sessionState)
  }

  private _readValidated<T>(key: string, schema: z.ZodType<T>): T | undefined {
    const stored = this._memento.get<unknown>(key)
    if (stored === undefined) {
      return undefined
    }

    const validation = schema.safeParse(stored)
    if (!validation.success) {
      Logger.error(
        `Stored data under "${key}" does not match its schema:`,
        z.prettifyError(validation.error),
      )
      throw new CorruptStoredDataError(
        `Stored extension data under "${key}" could not be read. It has been left untouched.`,
      )
    }

    // The stored value, not zod's copy: a newer extension version may have
    // persisted extra keys that have to survive a read/write round trip.
    return stored as T
  }

  public async wipeStorage(): Promise<void> {
    await this.updateSessionState(undefined)
    await this.updateUserData(undefined)
  }

  /**
   * Brings every stored key up to the current schema, backing up the legacy keys before the
   * first write and recording the run in the migration log.
   *
   * A window whose workspace still lives in the pre-2.0 data folder cannot be migrated in
   * place: with `langs` this writes nothing and reports `needsReload` with the workspace to
   * reopen; the caller reopens the window.
   *
   * Without `langs`, pre-2.0 exercises stay where they are until an activation that has it.
   */
  public async migrateToLatest(
    dialog: Dialog,
    langs: Langs | undefined,
    settings: vscode.WorkspaceConfiguration,
  ): Promise<MigrationOutcome> {
    // Without langs the exercises cannot move, so the reopened workspace would be empty.
    const activeOldWorkspaceName = langs && getActiveOldWorkspaceName(this._memento)
    if (activeOldWorkspaceName) {
      return {
        kind: "needsReload",
        workspaceName: activeOldWorkspaceName,
        hasMigratedUserData: this._memento.get(storage.USER_DATA_KEY) !== undefined,
      }
    }

    const fromVersion = lastSeenVersion(this._memento)
    const memento = new RecordingMemento(this._memento, () =>
      backUpLegacyData(this._memento, fromVersion, EXTENSION_VERSION),
    )
    let migratedUserData: UserDataMigration | undefined
    let hasMigratedUserData = false
    let failure: Error | undefined
    try {
      migratedUserData = migrateUserDataToLatest(memento)
      for (const { key, entry, reason } of migratedUserData.dropped) {
        Logger.warn(`Dropped ${entry} stored under "${key}": ${reason}`)
      }
      await keepUnreadableLegacyValues(memento, migratedUserData.unreadable)
      // First, so a later step failing leaves the courses readable.
      if (migratedUserData.data) {
        await writeUserData(memento, migratedUserData.data)
      }
      hasMigratedUserData = true
      if (migratedUserData.isLegacyMirrorStale) {
        await syncLegacyMirror(memento, memento.get<storage.UserData>(storage.USER_DATA_KEY))
      }

      const migratedExtensionSettings = await migrateExtensionSettingsToLatest(memento, settings)
      const migratedSessionState = migrateSessionState(memento)
      // `undefined` means nothing was stored, not "delete what is there".
      if (migratedSessionState.data) {
        await memento.update(storage.SESSION_STATE_KEY, migratedSessionState.data)
      }
      await retire(memento, [migratedSessionState, migratedUserData])

      // Last, since it reads the pre-2.0 settings for where exercises used to live.
      if (langs) {
        const migratedExerciseData = await migrateExerciseDataToLatest(memento, dialog, langs)
        if (migratedExerciseData.destinationKey) {
          await memento.update(migratedExerciseData.destinationKey, migratedExerciseData.data)
        }
        await retire(memento, [migratedExerciseData, migratedExtensionSettings])
      }
    } catch (e) {
      failure = e instanceof Error ? e : new Error(String(e))
    }

    const droppedEntries = migratedUserData?.dropped.length ?? 0
    const changed =
      memento.keysWritten.size > 0 || memento.keysRetired.size > 0 || droppedEntries > 0
    if (failure || changed) {
      await this._recordRun({
        at: new Date().toISOString(),
        fromVersion,
        toVersion: EXTENSION_VERSION,
        outcome: failure ? "failed" : "migrated",
        ...(failure ? { error: failure.message } : {}),
        keysRead: [...memento.keysRead],
        keysWritten: [...memento.keysWritten],
        keysRetired: [...memento.keysRetired],
        droppedEntries,
      })
    }
    if (failure) {
      return {
        kind: "failed",
        error: new StoredDataMigrationError(failure, this.getMigrationLog()),
        hasMigratedUserData,
      }
    }
    return { kind: "done" }
  }

  private async _recordRun(run: storage.MigrationRun): Promise<void> {
    const line = formatMigrationLog([run])
    if (run.outcome === "failed") {
      Logger.error(`Migration of stored data failed: ${line}`)
    } else {
      Logger.info(`Migrated stored data: ${line}`)
    }
    try {
      await appendMigrationRun(this._memento, run)
    } catch (e) {
      Logger.warn("Could not record the migration run", e)
    }
  }
}

async function writeUserData(
  memento: vscode.Memento,
  userData: storage.UserData | undefined,
): Promise<void> {
  await syncLegacyMirror(memento, userData, async () => {
    await memento.update(storage.USER_DATA_KEY, userData)
  })
}

/** Deletes the keys `migrations` made obsolete; a delete of an absent key is not recorded. */
async function retire(
  memento: RecordingMemento,
  migrations: MigratedData<unknown>[],
): Promise<void> {
  for (const key of obsoleteKeys(migrations)) {
    await memento.update(key, undefined)
  }
}

/** What {@link Storage.migrateToLatest} settled on; see its doc for `needsReload`. */
export type MigrationOutcome =
  | { kind: "done" }
  /**
   * In `needsReload` and `failed`, `hasMigratedUserData` false means the stored courses were left
   * unmigrated, so reading them now would show none.
   */
  | { kind: "needsReload"; workspaceName: string; hasMigratedUserData: boolean }
  | { kind: "failed"; error: StoredDataMigrationError; hasMigratedUserData: boolean }

function getActiveOldWorkspaceName(memento: vscode.Memento): string | undefined {
  interface ExtensionSettingsPartial {
    dataPath: string
  }

  const workspaceFile = vscode.workspace.workspaceFile
  const dataPath = memento.get<ExtensionSettingsPartial>(v0.EXTENSION_SETTINGS_KEY)?.dataPath

  if (!workspaceFile || !dataPath) {
    return undefined
  }

  return path.relative(workspaceFile.fsPath, vscode.Uri.file(dataPath).fsPath) ===
    path.join("..", "..")
    ? last(workspaceFile?.fsPath.split(path.sep))
    : undefined
}

/** The two course lists of a stored user data value, unchecked; `undefined` if it has none. */
function storedCourseLists(
  stored: unknown,
): { courses: unknown[]; mooc_courses: unknown[] } | undefined {
  if (typeof stored !== "object" || stored === null) {
    return undefined
  }
  const { courses, mooc_courses } = stored as { courses?: unknown; mooc_courses?: unknown }
  return Array.isArray(courses) && Array.isArray(mooc_courses)
    ? { courses, mooc_courses }
    : undefined
}

function isReadable(course: unknown, schema: z.ZodType): boolean {
  return schema.safeParse(course).success
}

/** `written` with the stored courses this version could not read put back as they were. */
function withUnreadableCourses(written: storage.UserData, stored: unknown): storage.UserData {
  const lists = storedCourseLists(stored)
  if (!lists) {
    return written
  }
  const unreadable = <T>(list: unknown[], schema: z.ZodType, kept: { id: T }[]): unknown[] => {
    const keptIds = new Set(kept.map((course) => course.id))
    return list.filter(
      (course) =>
        !isReadable(course, schema) && !keptIds.has((course as { id?: T } | null)?.id as T),
    )
  }
  return {
    courses: [
      ...written.courses,
      ...unreadable(lists.courses, storage.tmcLocalCourseDataSchema, written.courses),
    ],
    mooc_courses: [
      ...written.mooc_courses,
      ...unreadable(lists.mooc_courses, storage.moocLocalCourseDataSchema, written.mooc_courses),
    ],
  } as storage.UserData
}
