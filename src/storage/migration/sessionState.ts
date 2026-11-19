import type * as vscode from "vscode"
import { z } from "zod"

import type { MigratedData } from "."
import validateData from "."
import * as data from "../data"

export function v0_getVersion(memento: vscode.Memento): string | undefined {
  return validateData(memento.get<string>(data.v0.EXTENSION_VERSION_KEY), z.string())
}

export function v1_migrateFromV0(version: string | undefined): data.v1.SessionState {
  return {
    extensionVersion: version,
  }
}

/** Every key session state has ever been stored under; one left out survives to shadow the migrated value. */
const SESSION_STATE_KEYS = [data.v0.EXTENSION_VERSION_KEY, data.v3.SESSION_STATE_KEY]

/** Brings pre-2.0 session state forward; `data` is `undefined` when there is nothing to change. */
export default function migrateSessionState(
  memento: vscode.Memento,
): MigratedData<data.v1.SessionState> {
  const current = validateData(
    memento.get<data.v1.SessionState>(data.v1.SESSION_STATE_KEY),
    data.v1.sessionStateSchema,
  )
  const oldVersion = current ? undefined : v0_getVersion(memento)
  return {
    data: oldVersion === undefined ? undefined : v1_migrateFromV0(oldVersion),
    supersededKeys: SESSION_STATE_KEYS,
    destinationKey: data.v3.SESSION_STATE_KEY,
  }
}
