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

export default function migrateSessionState(
  memento: vscode.Memento,
): MigratedData<data.v1.SessionState> {
  const obsoleteKeys: string[] = []

  let dataV1 = validateData(
    memento.get<data.v1.SessionState>(data.v1.SESSION_STATE_KEY),
    data.v1.sessionStateSchema,
  )
  if (!dataV1) {
    const oldVersionData = v0_getVersion(memento)
    dataV1 = v1_migrateFromV0(oldVersionData)
  }

  return { data: dataV1, obsoleteKeys }
}
