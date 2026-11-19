import { isEqual } from "lodash"
import type * as vscode from "vscode"
import { z } from "zod"

import { Logger } from "../../utilities/logger"
import * as data from "../data"
import type { UnreadableValue } from "./userData"

const KEPT_RUNS = 10
const KEPT_UNREADABLE_VALUES = 20

/** Every key a pre-4.0 version stored data under. */
const LEGACY_KEYS = [
  data.v0.USER_DATA_KEY,
  data.v0.EXERCISE_DATA_KEY,
  data.v0.EXTENSION_SETTINGS_KEY,
  data.v0.EXTENSION_VERSION_KEY,
  data.v1.USER_DATA_KEY,
  data.v1.EXTENSION_SETTINGS_KEY,
  data.v1.SESSION_STATE_KEY,
]

/**
 * A memento that notes which keys a migration run read, wrote and deleted, and that has
 * {@link backUpLegacyData} run before its first write.
 */
export class RecordingMemento implements vscode.Memento {
  public readonly keysRead = new Set<string>()
  public readonly keysWritten = new Set<string>()
  public readonly keysRetired = new Set<string>()
  private _beforeFirstWrite: (() => Promise<void>) | undefined

  public constructor(
    private readonly _memento: vscode.Memento,
    beforeFirstWrite: () => Promise<void>,
  ) {
    this._beforeFirstWrite = beforeFirstWrite
  }

  public keys(): readonly string[] {
    return this._memento.keys()
  }

  public get<T>(key: string): T | undefined
  public get<T>(key: string, defaultValue: T): T
  public get<T>(key: string, defaultValue?: T): T | undefined {
    const value = this._memento.get<T>(key)
    if (value !== undefined) {
      this.keysRead.add(key)
    }
    return value ?? defaultValue
  }

  public async update(key: string, value: unknown): Promise<void> {
    const beforeFirstWrite = this._beforeFirstWrite
    this._beforeFirstWrite = undefined
    await beforeFirstWrite?.()
    await this._memento.update(key, value)
    if (value === undefined) {
      this.keysWritten.delete(key)
      this.keysRetired.add(key)
    } else {
      this.keysRetired.delete(key)
      this.keysWritten.add(key)
    }
  }
}

/** The extension version that ran before this activation, as session state recorded it. */
export function lastSeenVersion(memento: vscode.Memento): string | null {
  const session = data.v1.sessionStateSchema.safeParse(memento.get(data.v1.SESSION_STATE_KEY))
  const v0Version = z.string().safeParse(memento.get(data.v0.EXTENSION_VERSION_KEY))
  return (
    (session.success ? session.data.extensionVersion : undefined) ??
    (v0Version.success ? v0Version.data : null)
  )
}

/** Copies every legacy key's raw value to {@link data.v3.LEGACY_DATA_BACKUP_KEY}, unless a backup exists. */
export async function backUpLegacyData(
  memento: vscode.Memento,
  fromVersion: string | null,
  toVersion: string,
): Promise<void> {
  if (memento.get(data.v3.LEGACY_DATA_BACKUP_KEY) !== undefined) {
    return
  }
  const values = Object.fromEntries(
    LEGACY_KEYS.flatMap((key) => {
      const value = memento.get<unknown>(key)
      return value === undefined ? [] : [[key, value]]
    }),
  )
  if (Object.keys(values).length === 0) {
    return
  }
  const backup: data.v3.LegacyDataBackup = {
    createdAt: new Date().toISOString(),
    fromVersion,
    toVersion,
    values,
  }
  await memento.update(data.v3.LEGACY_DATA_BACKUP_KEY, backup)
  Logger.info(`Backed up ${Object.keys(values).join(", ")} before migrating them.`)
}

/** Adds `values` to {@link data.v3.UNREADABLE_LEGACY_DATA_KEY}, keeping only the latest few. */
export async function keepUnreadableLegacyValues(
  memento: vscode.Memento,
  values: UnreadableValue[],
): Promise<void> {
  if (values.length === 0) {
    return
  }
  const stored = z
    .array(data.v3.unreadableLegacyValueSchema)
    .safeParse(memento.get(data.v3.UNREADABLE_LEGACY_DATA_KEY))
  const kept = stored.success ? stored.data : []
  const keptAt = new Date().toISOString()
  const added = values
    .filter(({ key, value }) => !kept.some((old) => old.key === key && isEqual(old.value, value)))
    .map(({ key, value }) => ({ keptAt, key, value }))
  if (added.length > 0) {
    await memento.update(
      data.v3.UNREADABLE_LEGACY_DATA_KEY,
      [...kept, ...added].slice(-KEPT_UNREADABLE_VALUES),
    )
  }
}

/** The recorded migration runs, oldest first; an unreadable record reads as none. */
export function readMigrationLog(memento: vscode.Memento): data.v3.MigrationRun[] {
  const log = z.array(data.v3.migrationRunSchema).safeParse(memento.get(data.v3.MIGRATION_LOG_KEY))
  return log.success ? log.data : []
}

/** Records `run`, keeping only the latest few. */
export async function appendMigrationRun(
  memento: vscode.Memento,
  run: data.v3.MigrationRun,
): Promise<void> {
  const log = [...readMigrationLog(memento), run].slice(-KEPT_RUNS)
  await memento.update(data.v3.MIGRATION_LOG_KEY, log)
}

function listKeys(keys: string[]): string {
  return keys.length > 0 ? keys.join(", ") : "none"
}

/** `runs` as text for logs and error details, one line per run. */
export function formatMigrationLog(runs: data.v3.MigrationRun[]): string {
  if (runs.length === 0) {
    return "No migration runs recorded."
  }
  return runs
    .map(
      (run) =>
        `${run.at} ${run.fromVersion ?? "unknown"} -> ${run.toVersion}: ${run.outcome}` +
        `${run.error ? ` (${run.error})` : ""}; read ${listKeys(run.keysRead)}; ` +
        `wrote ${listKeys(run.keysWritten)}; retired ${listKeys(run.keysRetired)}; ` +
        `dropped ${run.droppedEntries}`,
    )
    .join("\n")
}
