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
import migrateUserDataToLatest, {
  writeLegacyMirror,
  writeLegacyMirrorRecord,
} from "./migration/userData"

/** The only access to VS Code's storage; nothing else reads or writes mementos or settings. */
export default class Storage {
  private _context: vscode.ExtensionContext

  public constructor(context: vscode.ExtensionContext) {
    this._context = context
  }

  /** @throws {CorruptStoredDataError} if the stored value does not match the current schema. */
  public getUserData(): storage.UserData | undefined {
    return this._readValidated(storage.USER_DATA_KEY, storage.userDataSchema)
  }

  /** @throws {CorruptStoredDataError} if the stored value does not match the current schema. */
  public getSessionState(): storage.SessionState | undefined {
    return this._readValidated(storage.SESSION_STATE_KEY, storage.sessionStateSchema)
  }

  /** Also mirrors the tmc courses to `user-data-v1`, which a downgrade to 3.x reads. */
  public async updateUserData(userData: storage.UserData | undefined): Promise<void> {
    await writeUserData(this._context.globalState, userData)
  }

  /** The recorded migration runs as text, for logs and error details. */
  public getMigrationLog(): string {
    return formatMigrationLog(readMigrationLog(this._context.globalState))
  }

  public async updateSessionState(sessionState: storage.SessionState | undefined): Promise<void> {
    await this._context.globalState.update(storage.SESSION_STATE_KEY, sessionState)
  }

  private _readValidated<T>(key: string, schema: z.ZodType<T>): T | undefined {
    const stored = this._context.globalState.get<unknown>(key)
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
   * A window whose workspace still lives in the pre-2.0 data folder cannot be
   * migrated in place, so with `langs` this reports `needsReload` with the workspace to
   * reopen and writes nothing; the caller owns reopening the window.
   *
   * Without `langs`, pre-2.0 exercises stay where they are until an activation that has it.
   */
  public async migrateToLatest(
    context: vscode.ExtensionContext,
    dialog: Dialog,
    langs: Langs | undefined,
    settings: vscode.WorkspaceConfiguration,
  ): Promise<MigrationOutcome> {
    // Without langs the exercises cannot move, so the reopened workspace would be empty.
    const activeOldWorkspaceName = langs && getActiveOldWorkspaceName(context.globalState)
    if (activeOldWorkspaceName) {
      return {
        kind: "needsReload",
        workspaceName: activeOldWorkspaceName,
        hasMigratedUserData: context.globalState.get(storage.USER_DATA_KEY) !== undefined,
      }
    }

    const fromVersion = lastSeenVersion(context.globalState)
    const memento = new RecordingMemento(context.globalState, () =>
      backUpLegacyData(context.globalState, fromVersion, EXTENSION_VERSION),
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
        const current = memento.get<storage.UserData>(storage.USER_DATA_KEY)
        await writeLegacyMirror(memento, current)
        await writeLegacyMirrorRecord(memento, current)
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

    const changed =
      memento.keysWritten.size > 0 ||
      memento.keysRetired.size > 0 ||
      (migratedUserData?.dropped.length ?? 0) > 0
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
        droppedEntries: migratedUserData?.dropped.length ?? 0,
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
      await appendMigrationRun(this._context.globalState, run)
    } catch (e) {
      Logger.warn("Could not record the migration run", e)
    }
  }
}

async function writeUserData(
  memento: vscode.Memento,
  userData: storage.UserData | undefined,
): Promise<void> {
  // Mirror first: if the v3 write then fails, the next activation merges the change back from it.
  await writeLegacyMirror(memento, userData)
  await memento.update(storage.USER_DATA_KEY, userData)
  await writeLegacyMirrorRecord(memento, userData)
}

async function retire(memento: vscode.Memento, migrations: MigratedData<unknown>[]): Promise<void> {
  for (const key of obsoleteKeys(migrations)) {
    if (memento.get(key) !== undefined) {
      await memento.update(key, undefined)
    }
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
