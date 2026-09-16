import * as path from "path"

import { last } from "lodash"
import * as vscode from "vscode"
import { z } from "zod"

// All access to VSCode's storage should be done through this module.
import type Dialog from "../api/dialog"
import type Langs from "../api/langs"
import { CorruptStoredDataError } from "../errors"
import { Logger } from "../utilities"
import * as storage from "./data"
import { v0 } from "./data"
import { obsoleteKeys } from "./migration"
import migrateBackendNamespacing from "./migration/backendNamespacing"
import migrateExerciseDataToLatest from "./migration/exerciseData"
import migrateExtensionSettingsToLatest from "./migration/extensionSettings"
import migrateSessionState from "./migration/sessionState"
import migrateUserDataToLatest from "./migration/userData"

/**
 * Interface class for accessing stored TMC configuration and data.
 */
export default class Storage {
  private _context: vscode.ExtensionContext

  /**
   * Creates new instance of the TMC storage access object.
   * @param context context of the extension where all data is stored
   */
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

  public async updateUserData(userData: storage.UserData | undefined): Promise<void> {
    await this._context.globalState.update(storage.USER_DATA_KEY, userData)
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
   * Brings every stored key up to the current schema.
   *
   * A window whose workspace still lives in the pre-2.0 data folder cannot be
   * migrated in place, so this reports `needsReload` with the workspace to
   * reopen and writes nothing; the caller owns reopening the window.
   */
  public async migrateToLatest(
    context: vscode.ExtensionContext,
    dialog: Dialog,
    tmc: Langs,
    settings: vscode.WorkspaceConfiguration,
  ): Promise<MigrationOutcome> {
    const memento = context.globalState

    const activeOldWorkspaceName = getActiveOldWorkspaceName(context.globalState)
    if (activeOldWorkspaceName) {
      return { kind: "needsReload", workspaceName: activeOldWorkspaceName }
    }

    try {
      const migratedExtensionSettings = await migrateExtensionSettingsToLatest(memento, settings)
      const migratedSessionState = migrateSessionState(memento)
      const migratedUserData = migrateUserDataToLatest(memento)

      // Workspace data migration - this one is a bit more tricky so do it last.
      const migratedExerciseData = await migrateExerciseDataToLatest(memento, dialog, tmc)

      // A migration yields `undefined` when nothing was stored under any of its
      // keys; that means "nothing to migrate", not "delete what is there".
      if (migratedSessionState.data) {
        await this.updateSessionState(migratedSessionState.data)
      }
      if (migratedUserData.data) {
        await this.updateUserData(migratedUserData.data)
      }

      // Runs after userData is settled so it can enumerate the user's courses.
      // Idempotent and flag-gated (see backendNamespacing.ts).
      const workspaceFileFolder = path.join(context.globalStoragePath, "workspaces")
      await migrateBackendNamespacing(memento, tmc, workspaceFileFolder, migratedUserData.data)

      const keysToRemove = obsoleteKeys([
        migratedExerciseData,
        migratedExtensionSettings,
        migratedSessionState,
        migratedUserData,
      ])
      for (const key of keysToRemove) {
        await memento.update(key, undefined)
      }
    } catch (e) {
      // Typing change from update
      return { kind: "failed", error: e as Error }
    }

    return { kind: "done" }
  }
}

/** What {@link Storage.migrateToLatest} settled on; see its doc for `needsReload`. */
export type MigrationOutcome =
  | { kind: "done" }
  | { kind: "needsReload"; workspaceName: string }
  | { kind: "failed"; error: Error }

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
