import type * as vscode from "vscode"

import type { MigratedData } from "."
import validateData from "."
import { semVerCompare } from "../../utilities"
import * as data from "../data"

function v1_logLevelFromV0(logLevel: data.v0.LogLevel): data.v1.LogLevel {
  switch (logLevel) {
    case data.v0.LogLevel.Debug:
    case data.v0.LogLevel.Verbose:
      return "verbose"
    case data.v0.LogLevel.Errors:
      return "errors"
    case data.v0.LogLevel.None:
      return "none"
  }
}

export async function v1_migrateFromV0(
  unstableData: data.v0.ExtensionSettings,
): Promise<data.v1.ExtensionSettings> {
  const logLevel = unstableData.logLevel ? v1_logLevelFromV0(unstableData.logLevel) : "errors"

  return {
    downloadOldSubmission: unstableData.downloadOldSubmission ?? true,
    hideMetaFiles: unstableData.hideMetaFiles ?? true,
    insiderVersion: unstableData.insiderVersion ?? false,
    logLevel,
    updateExercisesAutomatically: unstableData.updateExercisesAutomatically ?? true,
  }
}

interface V1SessionStatePartial {
  extensionVersion: string | undefined
}

/** Lifts settings a pre-2.1 install kept in storage into the VS Code settings API, which owns them from 2.1 on. */
export async function vscodeapi_migrateFromV1(
  memento: vscode.Memento,
  storageSettings: data.v1.ExtensionSettings,
  settings: vscode.WorkspaceConfiguration,
): Promise<void> {
  let version = memento.get<string>(data.v0.EXTENSION_VERSION_KEY)
  if (!version) {
    version = memento.get<V1SessionStatePartial>(data.v1.SESSION_STATE_KEY)?.extensionVersion
  }
  // A version that will not parse counts as older: the lift is idempotent, so
  // attempting it is the safe side of the guess.
  const versionDiff = semVerCompare(version ?? "0.0.0", "2.1.0", "minor")
  if (versionDiff !== undefined && versionDiff > 0) {
    return
  }

  await settings.update(
    data.v2.TMC_DOWNLOAD_OLD_SUBMISSION_KEY,
    storageSettings.downloadOldSubmission,
    true,
  )
  await settings.update(data.v2.TMC_HIDE_META_FILES_KEY, storageSettings.hideMetaFiles, true)
  await settings.update(
    data.v2.TMC_UPDATE_EXERCISES_AUTOMATICALLY_KEY,
    storageSettings.updateExercisesAutomatically,
    true,
  )
  await settings.update(data.v2.TMC_INSIDER_VERSION_KEY, storageSettings.insiderVersion, true)
  await settings.update(data.v2.TMC_LOG_LEVEL_KEY, storageSettings.logLevel, true)
}

/** The last key extension settings were persisted under; no storage version declares it any more. */
const RETIRED_V3_SETTINGS_KEY = "extension-settings-v3"

/** Every key extension settings have ever been stored under; one left out survives as a stale copy. */
const EXTENSION_SETTINGS_KEYS = [
  data.v0.EXTENSION_SETTINGS_KEY,
  data.v1.EXTENSION_SETTINGS_KEY,
  data.v2.EXTENSION_SETTINGS_KEY,
  RETIRED_V3_SETTINGS_KEY,
]

/**
 * Moves extension settings out of storage and into the VS Code settings API,
 * which is where they are read from.
 *
 * Persists nothing: the result carries only the keys to retire.
 */
export default async function migrateExtensionSettingsToLatest(
  memento: vscode.Memento,
  settings: vscode.WorkspaceConfiguration,
): Promise<MigratedData<never>> {
  const dataV0 = validateData(
    memento.get(data.v0.EXTENSION_SETTINGS_KEY),
    data.v0.extensionSettingsSchema,
  )

  const dataV1 = dataV0
    ? await v1_migrateFromV0(dataV0)
    : validateData(memento.get(data.v1.EXTENSION_SETTINGS_KEY), data.v1.extensionSettingsSchema)

  if (dataV1) {
    await vscodeapi_migrateFromV1(memento, dataV1, settings)
  }

  return {
    data: undefined,
    supersededKeys: EXTENSION_SETTINGS_KEYS,
    destinationKey: undefined,
  }
}
