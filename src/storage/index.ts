import * as path from "path"

import * as fs from "fs-extra"
import { last } from "lodash"
import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import * as vscode from "vscode"
import { z } from "zod"

// All access to VSCode's storage should be done through this module.
import type Dialog from "../api/dialog"
import type Langs from "../api/langs"
import {
  WORKSPACE_ROOT_FILE_NAME,
  WORKSPACE_ROOT_FILE_TEXT,
  WORKSPACE_ROOT_FOLDER_NAME,
  WORKSPACE_SETTINGS,
} from "../config/constants"
import { CorruptStoredDataError, HaltForReloadError } from "../errors"
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

  /**
   * @throws {CorruptStoredDataError} if the stored value does not match the current schema.
   * @deprecated Extension Settings will be stored in VSCode, remove on major 3.0 release.
   */
  public getExtensionSettings(): storage.ExtensionSettings | undefined {
    return this._readValidated(storage.EXTENSION_SETTINGS_KEY, storage.extensionSettingsSchema)
  }

  /** @throws {CorruptStoredDataError} if the stored value does not match the current schema. */
  public getSessionState(): storage.SessionState | undefined {
    return this._readValidated(storage.SESSION_STATE_KEY, storage.sessionStateSchema)
  }

  public async updateUserData(userData: storage.UserData | undefined): Promise<void> {
    await this._context.globalState.update(storage.USER_DATA_KEY, userData)
  }

  public async updateExtensionSettings(
    settings: storage.ExtensionSettings | undefined,
  ): Promise<void> {
    await this._context.globalState.update(storage.EXTENSION_SETTINGS_KEY, settings)
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
    await this.updateExtensionSettings(undefined)
    await this.updateSessionState(undefined)
    await this.updateUserData(undefined)
  }

  public async migrateToLatest(
    context: vscode.ExtensionContext,
    dialog: Dialog,
    tmc: Langs,
    settings: vscode.WorkspaceConfiguration,
  ): Promise<Result<void, Error>> {
    const memento = context.globalState

    const activeOldWorkspaceName = getActiveOldWorkspaceName(context.globalState)
    if (activeOldWorkspaceName) {
      const workspaceFileFolder = path.join(context.globalStoragePath, "workspaces")
      createInitializationFiles(workspaceFileFolder, activeOldWorkspaceName)
      await vscode.commands.executeCommand(
        "vscode.openFolder",
        vscode.Uri.file(path.join(workspaceFileFolder, activeOldWorkspaceName)),
      )
      return Err(new HaltForReloadError("Restart to start migration."))
    }

    try {
      const migratedExtensionSettings = await migrateExtensionSettingsToLatest(memento, settings)
      const migratedSessionState = migrateSessionState(memento)
      const migratedUserData = migrateUserDataToLatest(memento)

      // Workspace data migration - this one is a bit more tricky so do it last.
      const migratedExerciseData = await migrateExerciseDataToLatest(memento, dialog, tmc)

      // A migration yields `undefined` when nothing was stored under any of its
      // keys; that means "nothing to migrate", not "delete what is there".
      if (migratedExtensionSettings.data) {
        await this.updateExtensionSettings(migratedExtensionSettings.data)
      }
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
      return Err(e as Error)
    }

    return Ok.EMPTY
  }
}

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

// Copypaste code from resource initialization because that code isn't accessed yet.
function createInitializationFiles(workspaceFileFolder: string, workspaceName: string): void {
  fs.ensureDirSync(workspaceFileFolder)

  const workspaceFile = path.join(workspaceFileFolder, workspaceName)
  fs.writeFileSync(workspaceFile, JSON.stringify(WORKSPACE_SETTINGS))

  const rootFolder = path.join(workspaceFileFolder, WORKSPACE_ROOT_FOLDER_NAME)
  fs.ensureDirSync(rootFolder)

  const rootFile = path.join(rootFolder, WORKSPACE_ROOT_FILE_NAME)
  fs.writeFileSync(rootFile, WORKSPACE_ROOT_FILE_TEXT)
}
